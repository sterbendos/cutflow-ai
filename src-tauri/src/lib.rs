// CutFlow AI — Tauri v2 Backend Entry Point
// Native Windows host: MSVC toolchain, paths normalized via std::fs::canonicalize

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod server;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Manager};

// ─────────────────────────────────────────────────────────────
// Data Contracts (mirrors TypeScript interfaces on the frontend)
// ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EdlSegment {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub segment_type: String, // "keep" | "silence" | "user-deleted"
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TimelineState {
    pub source_video_path: String, // Windows-native path, canonicalized
    pub edl: Vec<EdlSegment>,
    pub current_time: f64,
    pub is_silence_skip_enabled: bool,
}

impl Default for TimelineState {
    fn default() -> Self {
        TimelineState {
            source_video_path: String::new(),
            edl: Vec::new(),
            current_time: 0.0,
            is_silence_skip_enabled: true,
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Global Shared State — Arc<RwLock<TimelineState>>
// Shared between the Tauri command handlers and the Axum HTTP server
// ─────────────────────────────────────────────────────────────

pub static TIMELINE_STATE: Lazy<Arc<RwLock<TimelineState>>> =
    Lazy::new(|| Arc::new(RwLock::new(TimelineState::default())));

// ─────────────────────────────────────────────────────────────
// Windows Path Normalization
// Uses std::fs::canonicalize for UNC prefix stripping and slash normalization.
// Falls through gracefully if the path does not yet exist on disk.
// ─────────────────────────────────────────────────────────────

pub fn normalize_windows_path(raw: &str) -> String {
    let path = Path::new(raw);
    match std::fs::canonicalize(path) {
        Ok(canonical) => {
            // canonicalize on Windows returns \\?\ UNC extended paths.
            // Strip the \\?\ prefix so the path is usable by ffmpeg.exe and std::fs APIs.
            let lossy = canonical.to_string_lossy();
            let normalized = if lossy.starts_with(r"\\?\") {
                lossy[4..].to_string()
            } else {
                lossy.to_string()
            };
            // Normalize remaining backslashes to forward slashes for cross-API compatibility
            normalized.replace('\\', "/")
        }
        Err(_) => {
            // Path may not exist yet (e.g., output path). Do a best-effort backslash→slash pass.
            raw.replace('\\', "/")
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Tauri Command: get_timeline_state
// ─────────────────────────────────────────────────────────────

#[tauri::command]
fn get_timeline_state() -> Result<TimelineState, String> {
    let state = TIMELINE_STATE
        .read()
        .map_err(|e| format!("Lock poisoned: {e}"))?;
    Ok(state.clone())
}

// ─────────────────────────────────────────────────────────────
// Tauri Command: set_source_video
// Accepts a raw Windows path from the file picker dialog, normalizes it,
// and re-initializes the EDL with a single "keep" segment covering [0, duration].
// ─────────────────────────────────────────────────────────────

#[tauri::command]
fn set_source_video(
    app: AppHandle,
    raw_path: String,
    duration: f64,
) -> Result<TimelineState, String> {
    let normalized = normalize_windows_path(&raw_path);

    let mut state = TIMELINE_STATE
        .write()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    state.source_video_path = normalized;
    state.current_time = 0.0;
    state.edl = vec![EdlSegment {
        id: uuid::Uuid::new_v4().to_string(),
        start: 0.0,
        end: duration,
        segment_type: "keep".to_string(),
    }];

    let snapshot = state.clone();

    // Broadcast update to all frontend windows
    app.emit("timeline-external-update", &snapshot)
        .map_err(|e| format!("Emit failed: {e}"))?;

    Ok(snapshot)
}

// ─────────────────────────────────────────────────────────────
// Tauri Command: update_segment
// Mutates a single segment's type by ID.
// ─────────────────────────────────────────────────────────────

#[tauri::command]
fn update_segment(
    app: AppHandle,
    segment_id: String,
    new_type: String,
) -> Result<TimelineState, String> {
    let mut state = TIMELINE_STATE
        .write()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    for seg in state.edl.iter_mut() {
        if seg.id == segment_id {
            seg.segment_type = new_type.clone();
            break;
        }
    }

    let snapshot = state.clone();
    app.emit("timeline-external-update", &snapshot)
        .map_err(|e| format!("Emit failed: {e}"))?;

    Ok(snapshot)
}

// ─────────────────────────────────────────────────────────────
// Tauri Command: toggle_silence_skip
// ─────────────────────────────────────────────────────────────

#[tauri::command]
fn toggle_silence_skip(app: AppHandle) -> Result<TimelineState, String> {
    let mut state = TIMELINE_STATE
        .write()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    state.is_silence_skip_enabled = !state.is_silence_skip_enabled;
    let snapshot = state.clone();

    app.emit("timeline-external-update", &snapshot)
        .map_err(|e| format!("Emit failed: {e}"))?;

    Ok(snapshot)
}

// ─────────────────────────────────────────────────────────────
// Tauri Command: generate_ffmpeg_command
//
// Builds a Windows-native ffmpeg.exe command string from the active EDL.
// Only "keep" segments are included in the filtergraph.
// Chains an ASS subtitle overlay for caption burn-in.
//
// Example output filtergraph (2 keep segments):
//   [0:v]select='between(t,0.0,12.5)+between(t,20.1,45.0)',setpts=N/25/TB[v_cut];
//   [v_cut]ass=captions.ass[final_v]
// ─────────────────────────────────────────────────────────────

#[tauri::command]
fn generate_ffmpeg_command(output_path: String) -> Result<String, String> {
    let state = TIMELINE_STATE
        .read()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    if state.source_video_path.is_empty() {
        return Err("No source video loaded".to_string());
    }

    let keep_segments: Vec<&EdlSegment> = state
        .edl
        .iter()
        .filter(|s| s.segment_type == "keep")
        .collect();

    if keep_segments.is_empty() {
        return Err("No segments marked as 'keep'".to_string());
    }

    // Build the select= expression
    let between_clauses: Vec<String> = keep_segments
        .iter()
        .map(|s| format!("between(t,{:.6},{:.6})", s.start, s.end))
        .collect();
    let select_expr = between_clauses.join("+");

    // Full filtergraph: select → setpts → ASS subtitle burn-in
    let filtergraph = format!(
        "[0:v]select='{select_expr}',setpts=N/25/TB[v_cut];\
         [0:a]aselect='{select_expr}',asetpts=N/SR/TB[a_cut];\
         [v_cut]ass=captions.ass[final_v]"
    );

    let normalized_input = normalize_windows_path(&state.source_video_path);
    let normalized_output = normalize_windows_path(&output_path);

    let cmd = format!(
        r#"ffmpeg.exe -i "{normalized_input}" -filter_complex "{filtergraph}" -map "[final_v]" -map "[a_cut]" -c:v libx264 -preset fast -crf 18 -c:a aac -b:a 192k -movflags +faststart "{normalized_output}""#
    );

    Ok(cmd)
}

// ─────────────────────────────────────────────────────────────
// Tauri Command: execute_export
// Runs the generated ffmpeg.exe command as a Windows subprocess.
// ─────────────────────────────────────────────────────────────

#[tauri::command]
fn execute_export(app: AppHandle, output_path: String) -> Result<String, String> {
    let cmd_str = generate_ffmpeg_command(output_path)?;

    // Spawn ffmpeg.exe via cmd.exe on Windows so PATH resolution works correctly
    let output = Command::new("cmd")
        .args(["/C", &cmd_str])
        .output()
        .map_err(|e| format!("Failed to spawn ffmpeg: {e}"))?;

    if output.status.success() {
        let msg = "Export completed successfully.".to_string();
        app.emit("export-complete", &msg)
            .map_err(|e| format!("Emit failed: {e}"))?;
        Ok(msg)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("ffmpeg failed:\n{stderr}"))
    }
}

// ─────────────────────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Clone the shared state Arc so the Axum server thread can own a reference
    let axum_state = Arc::clone(&TIMELINE_STATE);

    // Spawn the Axum HTTP server on port 14220 in a background Tokio thread
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("Failed to build Tokio runtime");
        rt.block_on(async move {
            server::start_axum_server(axum_state).await;
        });
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_timeline_state,
            set_source_video,
            update_segment,
            toggle_silence_skip,
            generate_ffmpeg_command,
            execute_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CutFlow AI");
}
