// CutFlow AI — Tauri v2 Backend Entry Point
// Native Windows host: MSVC toolchain, paths normalized via std::fs::canonicalize

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod server;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Manager, Emitter};
use tauri_plugin_shell::ShellExt;

// ─────────────────────────────────────────────────────────────
// Data Contracts (mirrors TypeScript interfaces on the frontend)
// ─────────────────────────────────────────────────────────────

// (AutoEditor Structs Removed)

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

    // Full filtergraph: select → setpts
    let filtergraph = format!(
        "[0:v]select='{select_expr}',setpts=N/FRAME_RATE/TB[v_cut];\
         [0:a]aselect='{select_expr}',asetpts=N/SR/TB[a_cut]"
    );

    let normalized_input = normalize_windows_path(&state.source_video_path);
    let normalized_output = normalize_windows_path(&output_path);

    // Provide the arguments to the sidecar, not the full command string
    // because `tauri_plugin_shell::Command::new_sidecar` takes args iteratively
    // We will serialize them as JSON string to easily parse back in execute_export
    let args = serde_json::json!([
        "-y",
        "-i",
        normalized_input,
        "-filter_complex",
        filtergraph,
        "-map",
        "[v_cut]",
        "-map",
        "[a_cut]",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        normalized_output
    ]);

    Ok(serde_json::to_string(&args).unwrap())
}

// ─────────────────────────────────────────────────────────────
// Tauri Command: execute_export
// Runs the generated ffmpeg.exe command as a Tauri sidecar subprocess.
// ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn execute_export(app: AppHandle, output_path: String) -> Result<String, String> {
    let args_json = generate_ffmpeg_command(output_path)?;
    let args: Vec<String> = serde_json::from_str(&args_json).unwrap();

    let output = app.shell().sidecar("ffmpeg")
        .map_err(|e| format!("Failed to create sidecar command: {e}"))?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Failed to spawn ffmpeg sidecar: {e}"))?;

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
// Tauri Command: analyze_video
// Runs FFmpeg silencedetect and updates the timeline state natively.
// ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn analyze_video(app: AppHandle, sensitivity: String) -> Result<TimelineState, String> {
    let (source_video_path, duration) = {
        let state_read = TIMELINE_STATE
            .read()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        
        let path = state_read.source_video_path.clone();
        let dur = state_read.edl.iter().map(|s| s.end).fold(0.0, f64::max);
        (path, dur)
    };

    if source_video_path.is_empty() {
        return Err("No source video loaded".to_string());
    }

    let min_duration = match sensitivity.as_str() {
        "minimal" => "1.0",
        "balanced" => "0.4",
        "action" => "0.25",
        "aggressive" => "0.15",
        _ => "0.4",
    };

    let normalized_input = normalize_windows_path(&source_video_path);
    let filter = format!("silencedetect=noise=-30dB:d={}", min_duration);

    let output = app.shell().sidecar("ffmpeg")
        .map_err(|e| format!("Failed to create sidecar command: {e}"))?
        .args(["-i", &normalized_input, "-af", &filter, "-f", "null", "-"])
        .output()
        .await
        .map_err(|e| format!("Failed to run ffmpeg silencedetect: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    
    // Parse silence_start and silence_end from stderr
    // Lines look like: 
    // [silencedetect @ 00000] silence_start: 12.34
    // [silencedetect @ 00000] silence_end: 14.56 | silence_duration: 2.22

    let mut silence_ranges: Vec<(f64, f64)> = Vec::new();
    let mut current_start = None;

    for line in stderr.lines() {
        if line.contains("silence_start:") {
            if let Some(pos) = line.find("silence_start: ") {
                let val_str = &line[pos + 15..];
                if let Ok(val) = val_str.trim().parse::<f64>() {
                    current_start = Some(val);
                }
            }
        } else if line.contains("silence_end:") {
            if let Some(pos) = line.find("silence_end: ") {
                let rest = &line[pos + 13..];
                let val_str = rest.split('|').next().unwrap_or("").trim();
                if let Ok(end_val) = val_str.parse::<f64>() {
                    if let Some(start_val) = current_start.take() {
                        silence_ranges.push((start_val, end_val));
                    }
                }
            }
        }
    }

    let mut edl = Vec::new();
    let mut current_time = 0.0;

    for (silence_start, silence_end) in silence_ranges {
        // If there's a gap before the silence, that's a keep segment
        if silence_start > current_time {
            edl.push(EdlSegment {
                id: uuid::Uuid::new_v4().to_string(),
                start: current_time,
                end: silence_start,
                segment_type: "keep".to_string(),
            });
        }
        
        // Add the silence segment
        edl.push(EdlSegment {
            id: uuid::Uuid::new_v4().to_string(),
            start: silence_start,
            end: silence_end,
            segment_type: "silence".to_string(),
        });

        current_time = silence_end;
    }

    // Add trailing keep segment if needed
    if current_time < duration {
         edl.push(EdlSegment {
             id: uuid::Uuid::new_v4().to_string(),
             start: current_time,
             end: duration,
             segment_type: "keep".to_string(),
         });
    }

    if edl.is_empty() {
        edl = vec![EdlSegment {
             id: uuid::Uuid::new_v4().to_string(),
             start: 0.0,
             end: duration,
             segment_type: "keep".to_string(),
         }];
    }

    let mut state_write = TIMELINE_STATE
        .write()
        .map_err(|e| format!("Lock poisoned: {e}"))?;
        
    state_write.edl = edl;
    let snapshot = state_write.clone();
    drop(state_write);

    app.emit("timeline-external-update", &snapshot)
        .map_err(|e| format!("Emit failed: {e}"))?;

    Ok(snapshot)
}

// ─────────────────────────────────────────────────────────────
// Tauri Command: extract_audio_for_transcription
// Uses FFmpeg to extract a 16kHz mono WAV file for Whisper AI
// ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn extract_audio_for_transcription(app: AppHandle, video_path: String) -> Result<String, String> {
    let normalized_input = normalize_windows_path(&video_path);
    let output_path = std::env::temp_dir().join(format!("cutflow_audio_{}.wav", uuid::Uuid::new_v4()));
    let output_str = output_path.to_string_lossy().to_string();

    let output = app.shell().sidecar("ffmpeg")
        .map_err(|e| format!("Failed to create sidecar command: {e}"))?
        .args([
            "-y",
            "-i",
            &normalized_input,
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            &output_str,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run ffmpeg audio extraction: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg failed to extract audio: {stderr}"));
    }

    Ok(output_str)
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
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_timeline_state,
            set_source_video,
            update_segment,
            toggle_silence_skip,
            generate_ffmpeg_command,
            execute_export,
            analyze_video,
            extract_audio_for_transcription,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CutFlow AI");
}
