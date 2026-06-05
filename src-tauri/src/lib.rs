// CutFlow AI — Tauri v2 Backend Entry Point
// Native Windows host: MSVC toolchain, paths normalized via std::fs::canonicalize

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod server;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;

// ─────────────────────────────────────────────────────────────
// Data Contracts (mirrors TypeScript interfaces on the frontend)
// ─────────────────────────────────────────────────────────────

// (AutoEditor Structs Removed)

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AudioSegment {
    pub id: String,
    pub path: String,
    pub start: f64,
    pub duration: f64,
    pub r#type: String, // "sfx" | "music" | "voice"
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EdlSegment {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub segment_type: String, // "keep" | "silence" | "user-deleted"
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TimelineState {
    pub source_video_path: String,
    pub edl: Vec<EdlSegment>,
    pub audioEdl: Vec<AudioSegment>,
    pub transitionType: String,
    pub transitionDuration: f64,
    pub current_time: f64,
    pub is_silence_skip_enabled: bool,
    #[serde(default)]
    pub transcript_json: Option<serde_json::Value>,
}

impl Default for TimelineState {
    fn default() -> Self {
        TimelineState {
            source_video_path: String::new(),
            edl: Vec::new(),
            audioEdl: Vec::new(),
            transitionType: "none".to_string(),
            transitionDuration: 0.3,
            current_time: 0.0,
            is_silence_skip_enabled: true,
            transcript_json: None,
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

fn escape_ffmpeg_subtitle_filename(raw: &str) -> String {
    normalize_windows_path(raw)
        .replace('\'', "\\'")
        .replace(':', "\\:")
}

fn escape_ffmpeg_filter_text(raw: &str) -> String {
    raw.replace('\\', "\\\\").replace('\'', "\\'")
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
// Tauri Command: split_segment
// ─────────────────────────────────────────────────────────────

#[tauri::command]
fn split_segment(app: AppHandle, segment_id: String, split_time: f64) -> Result<TimelineState, String> {
    let mut state = TIMELINE_STATE.write().map_err(|e| format!("Lock poisoned: {e}"))?;

    let mut new_edl = Vec::new();
    for seg in &state.edl {
        if seg.id == segment_id && split_time > seg.start && split_time < seg.end {
            new_edl.push(EdlSegment {
                id: uuid::Uuid::new_v4().to_string(),
                start: seg.start,
                end: split_time,
                segment_type: seg.segment_type.clone(),
            });
            new_edl.push(EdlSegment {
                id: uuid::Uuid::new_v4().to_string(),
                start: split_time,
                end: seg.end,
                segment_type: seg.segment_type.clone(),
            });
        } else {
            new_edl.push(seg.clone());
        }
    }

    state.edl = new_edl;

    let snapshot = state.clone();
    app.emit("timeline-external-update", &snapshot).map_err(|e| format!("Emit failed: {e}"))?;
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
// Tauri Command: generate_concat_args
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
fn generate_concat_args(
    output_path: String,
) -> Result<String, String> {
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

    // For a complex transition like crossfade/xfade, we would need a much more complex filtergraph.
    // For now, we'll keep the simple select logic if no transitions, and fallback to concat for transitions.
    // Since xfade requires distinct inputs, implementing it purely with select is hard.
    // Given timeline constraints, we will keep the standard export unless a transition is requested.
    // Note: implementing true xfade here would require splitting the input into multiple streams.

    // We will use trim/atrim and concat instead of select/aselect to fix VFR sync issues.
    let mut filtergraph = String::new();
    let mut concat_inputs = String::new();

    for (i, seg) in keep_segments.iter().enumerate() {
        let v_out = format!("[v{}]", i);
        let a_out = format!("[a{}]", i);
        filtergraph.push_str(&format!(
            "[0:v]trim=start={:.6}:end={:.6},setpts=PTS-STARTPTS{};\
             [0:a]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS{};",
            seg.start, seg.end, v_out,
            seg.start, seg.end, a_out
        ));
        concat_inputs.push_str(&format!("{}{}", v_out, a_out));
    }

    let n = keep_segments.len();
    filtergraph.push_str(&format!("{}concat=n={}:v=1:a=1[v_cut][a_cut]", concat_inputs, n));

    let normalized_input = normalize_windows_path(&state.source_video_path);
    let normalized_output = normalize_windows_path(&output_path);

    // Pass 1 args: trim+concat only, no subtitles in filter_complex
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
async fn execute_export(
    app: AppHandle,
    output_path: String,
    srt_path: Option<String>,
    subtitle_style: Option<String>,
) -> Result<String, String> {
    // ── Pass 1: trim + concat ──────────────────────────────────────────────
    // We always write pass-1 output to a temp file so we can do a clean
    // subtitle burn-in as a separate, simple -vf call (no filter_complex
    // path-escaping nightmares on Windows).
    let needs_subtitles = srt_path.as_ref().map_or(false, |p| std::fs::metadata(p).is_ok());

    let pass1_path = if needs_subtitles {
        // Write to a temp file; pass 2 will burn subs onto it → final output
        let tmp = std::env::temp_dir().join("cutflow_pass1.mp4");
        tmp.to_string_lossy().to_string()
    } else {
        output_path.clone()
    };

    let args_json = generate_concat_args(pass1_path.clone())?;
    let args: Vec<String> = serde_json::from_str(&args_json).unwrap();

    let out1 = app.shell().sidecar("ffmpeg")
        .map_err(|e| format!("FFmpeg sidecar error: {e}"))?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("FFmpeg pass-1 spawn failed: {e}"))?;

    if !out1.status.success() {
        let stderr = String::from_utf8_lossy(&out1.stderr).to_string();
        return Err(format!("FFmpeg pass-1 (concat) failed:\n{stderr}"));
    }

    // ── Pass 2: subtitle burn-in (only if SRT provided) ───────────────────
    if needs_subtitles {
        let srt = srt_path.unwrap();

        // Build the subtitle filter value
        // FFmpeg -vf subtitles= on Windows: use forward slashes, escape colon
        let srt_forward = srt.replace('\\', "/");
        // Escape the colon after drive letter: C:/... → C\:/...
        let srt_escaped = if srt_forward.len() > 1 && &srt_forward[1..2] == ":" {
            format!("{}\\:{}", &srt_forward[..1], &srt_forward[2..])
        } else {
            srt_forward.clone()
        };

        let mut vf = format!("subtitles='{}'", srt_escaped);
        if let Some(ref style) = subtitle_style {
            let style_trimmed = style.trim();
            if !style_trimmed.is_empty() {
                vf.push_str(&format!(":force_style='{}'", style_trimmed.replace('\'', "\\'")));
            }
        }

        let normalized_pass1 = normalize_windows_path(&pass1_path);
        let normalized_out   = normalize_windows_path(&output_path);

        let pass2_args: Vec<String> = vec![
            "-y".into(),
            "-i".into(), normalized_pass1,
            "-vf".into(), vf,
            "-c:v".into(), "libx264".into(),
            "-preset".into(), "fast".into(),
            "-crf".into(), "18".into(),
            "-c:a".into(), "copy".into(),
            "-movflags".into(), "+faststart".into(),
            normalized_out,
        ];

        let out2 = app.shell().sidecar("ffmpeg")
            .map_err(|e| format!("FFmpeg sidecar error: {e}"))?
            .args(pass2_args)
            .output()
            .await
            .map_err(|e| format!("FFmpeg pass-2 spawn failed: {e}"))?;

        // Clean up temp file regardless
        let _ = std::fs::remove_file(&pass1_path);

        if !out2.status.success() {
            let stderr = String::from_utf8_lossy(&out2.stderr).to_string();
            return Err(format!("FFmpeg pass-2 (subtitles) failed:\n{stderr}"));
        }
    }

    let msg = "Export completed successfully.".to_string();
    app.emit("export-complete", &msg)
        .map_err(|e| format!("Emit failed: {e}"))?;
    Ok(msg)
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
            split_segment,
            toggle_silence_skip,
            generate_concat_args,
            execute_export,
            analyze_video,
            extract_audio_for_transcription,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CutFlow AI");
}
