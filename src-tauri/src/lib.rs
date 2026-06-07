// CutFlow AI � Tauri v2 Backend Entry Point
// Native Windows host: MSVC toolchain, paths normalized via std::fs::canonicalize

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod server;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::Path;
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;

// -------------------------------------------------------------
// Data Contracts (mirrors TypeScript interfaces on the frontend)
// -------------------------------------------------------------

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
pub struct SpatialProperties {
    pub scale: f64,
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
    pub opacity: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BRollSegment {
    pub id: String,
    pub path: String,
    pub name: String,
    pub start: f64,
    pub duration: f64,
    pub spatial: Option<SpatialProperties>,
}


#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum TimelineTrack {
    #[serde(rename = "video")]
    Video {
        id: String,
        name: String,
        isMuted: bool,
        isHidden: bool,
        opacity: f64,
        order: i32,
    },
    #[serde(rename = "audio")]
    Audio {
        id: String,
        name: String,
        isMuted: bool,
        isHidden: bool,
        opacity: f64,
        order: i32,
        segments: Vec<AudioSegment>,
    },
    #[serde(rename = "b-roll")]
    BRoll {
        id: String,
        name: String,
        isMuted: bool,
        isHidden: bool,
        opacity: f64,
        order: i32,
        segments: Vec<BRollSegment>,
    },
    #[serde(rename = "text")]
    Text {
        id: String,
        name: String,
        isMuted: bool,
        isHidden: bool,
        opacity: f64,
        order: i32,
    },
    #[serde(rename = "adjustment")]
    Adjustment {
        id: String,
        name: String,
        isMuted: bool,
        isHidden: bool,
        opacity: f64,
        order: i32,
    },
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
    pub tracks: Vec<TimelineTrack>,
    pub transitionType: String,
    pub transitionDuration: f64,
    pub current_time: f64,
    pub is_silence_skip_enabled: bool,
    pub aspectRatio: String,
    #[serde(default)]
    pub transcript_json: Option<serde_json::Value>,
}

impl Default for TimelineState {
    fn default() -> Self {
        TimelineState {
            source_video_path: String::new(),
            edl: Vec::new(),
            tracks: Vec::new(),
            transitionType: "none".to_string(),
            transitionDuration: 0.3,
            current_time: 0.0,
            is_silence_skip_enabled: true,
            aspectRatio: "16:9".to_string(),
            transcript_json: None,
        }
    }
}

// -------------------------------------------------------------
// Global Shared State � Arc<RwLock<TimelineState>>
// Shared between the Tauri command handlers and the Axum HTTP server
// -------------------------------------------------------------

pub static TIMELINE_STATE: Lazy<Arc<RwLock<TimelineState>>> =
    Lazy::new(|| Arc::new(RwLock::new(TimelineState::default())));

// -------------------------------------------------------------
// Windows Path Normalization
// Uses std::fs::canonicalize for UNC prefix stripping and slash normalization.
// Falls through gracefully if the path does not yet exist on disk.
// -------------------------------------------------------------

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
            // Path may not exist yet (e.g., output path). Do a best-effort backslash?slash pass.
            raw.replace('\\', "/")
        }
    }
}

#[allow(dead_code)]
fn escape_ffmpeg_subtitle_filename(raw: &str) -> String {
    normalize_windows_path(raw)
        .replace('\'', "\\'")
        .replace(':', "\\:")
}

#[allow(dead_code)]
fn escape_ffmpeg_filter_text(raw: &str) -> String {
    raw.replace('\\', "\\\\").replace('\'', "\\'")
}

// -------------------------------------------------------------
// Tauri Command: get_timeline_state
// -------------------------------------------------------------

#[tauri::command]
fn get_timeline_state() -> Result<TimelineState, String> {
    let state = TIMELINE_STATE
        .read()
        .map_err(|e| format!("Lock poisoned: {e}"))?;
    Ok(state.clone())
}



// -------------------------------------------------------------
// Tauri Command: set_source_video
// Accepts a raw Windows path from the file picker dialog, normalizes it,
// and re-initializes the EDL with a single "keep" segment covering [0, duration].
// -------------------------------------------------------------

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

// -------------------------------------------------------------
// Tauri Command: update_segment
// Mutates a single segment's type by ID.
// -------------------------------------------------------------

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

// -------------------------------------------------------------
// Tauri Command: split_segment
// -------------------------------------------------------------

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

// -------------------------------------------------------------
// Tauri Command: toggle_silence_skip
// -------------------------------------------------------------

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


// -------------------------------------------------------------
// Tauri Command: analyze_video
// Runs FFmpeg silencedetect and updates the timeline state natively.
// -------------------------------------------------------------

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

// -------------------------------------------------------------
// Tauri Command: extract_audio_for_transcription
// Uses FFmpeg to extract a 16kHz mono WAV file for Whisper AI
// -------------------------------------------------------------

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

// -------------------------------------------------------------
// Tauri Command: export_frames_to_mp4
// Encodes a sequence of PNG frames produced by the frontend compositor
// into a final MP4 using the FFmpeg sidecar. Optionally maps audio from
// the source video and applies ASS subtitles if present in the temp dir.
// -------------------------------------------------------------

#[tauri::command]
async fn export_frames_to_mp4(
    app: AppHandle,
    temp_dir: String,
    output_path: String,
    fps: u32,
    source_video_path: Option<String>,
    audio_path: Option<String>,
) -> Result<String, String> {
    let tmp_dir = std::path::Path::new(&temp_dir).to_path_buf();
    if !tmp_dir.exists() {
        return Err(format!("Temp frames dir not found: {}", tmp_dir.to_string_lossy()));
    }

    let frames_pattern = tmp_dir.join("frame_%05d.png").to_string_lossy().to_string();
    let normalized_frames = normalize_windows_path(&frames_pattern);
    let normalized_output = normalize_windows_path(&output_path);

    // Check for subtitles
    let ass_path = tmp_dir.join("subtitles.ass");
    let has_ass = ass_path.exists();
    let ass_escaped = if has_ass {
        Some(escape_ffmpeg_subtitle_filename(&ass_path.to_string_lossy()))
    } else {
        None
    };

    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-framerate".to_string(),
        fps.to_string(),
        "-i".to_string(),
        normalized_frames.clone(),
    ];

    let audio_source = audio_path.as_ref().or(source_video_path.as_ref());
    let audio_mapping = if let Some(src) = audio_source {
        // If an explicit audio_path was supplied, ensure the file exists before invoking ffmpeg
        if let Some(a) = audio_path.as_ref() {
            let audio_path_obj = std::path::Path::new(a);
            if !audio_path_obj.exists() {
                return Err(format!("Provided audio file not found: {}", a));
            }
        }

        let normalized_input = normalize_windows_path(src);
        args.push("-i".to_string());
        args.push(normalized_input.clone());
        // map video from first input, audio from second input
        args.push("-map".to_string());
        args.push("0:v:0".to_string());
        args.push("-map".to_string());
        args.push("1:a:0".to_string());
        true
    } else {
        false
    };

    if let Some(ass) = ass_escaped {
        // Use ass subtitle filter
        args.push("-vf".to_string());
        args.push(format!("ass='{}'", ass));
    }

    // Video codec + encoding settings
    args.extend(vec![
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "fast".to_string(),
        "-crf".to_string(),
        "18".to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
    ]);

    if audio_mapping {
        args.extend(vec![
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "192k".to_string(),
            "-shortest".to_string(),
        ]);
    }

    args.push(normalized_output.clone());

    // Emit start event
    app.emit("export-progress", &json!({"progress": 0.85, "message": "Starting FFmpeg encoding..."})).ok();

    let out = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("Failed to create sidecar command: {e}"))?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("FFmpeg failed to encode frames: {stderr}"));
    }

    // Emit completion event
    app.emit("export-progress", &json!({"progress": 0.99, "message": "FFmpeg finished encoding"})).ok();

    // Best-effort cleanup of temp frames
    let _ = std::fs::remove_dir_all(&tmp_dir);

    Ok(format!("Exported to: {}", normalized_output))
}


// -------------------------------------------------------------
// Tauri Command: convert_audio_to_wav
// Converts a recorded webm/ogg audio file to WAV via FFmpeg
// -------------------------------------------------------------

#[tauri::command]
async fn convert_audio_to_wav(app: AppHandle, input_path: String, output_path: String) -> Result<(), String> {
    let args = vec![
        "-y".to_string(),
        "-i".to_string(), input_path.clone(),
        "-ar".to_string(), "44100".to_string(),
        "-ac".to_string(), "2".to_string(),
        "-f".to_string(), "wav".to_string(),
        output_path,
    ];

    let out = app.shell().sidecar("ffmpeg")
        .map_err(|e| format!("FFmpeg sidecar error: {e}"))?
        .args(args)
        .output()
        .await
        .map_err(|e| format!("FFmpeg audio convert spawn failed: {e}"))?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(format!("FFmpeg audio conversion failed:\n{stderr}"));
    }
    Ok(())
}

// -------------------------------------------------------------
// Tauri Command: check_ffmpeg
// Verifies that the ffmpeg sidecar is available and runnable.
// -------------------------------------------------------------

#[tauri::command]
async fn check_ffmpeg(app: AppHandle) -> Result<bool, String> {
    match app.shell().sidecar("ffmpeg") {
        Ok(cmd) => {
            let out = cmd.args(["-version"]).output().await.map_err(|e| format!("FFmpeg test failed: {e}"))?;
            Ok(out.status.success())
        }
        Err(_) => Ok(false),
    }
}

// -------------------------------------------------------------
// Tauri Command: delete_file
// Deletes a file from disk (used to clean up temp files)
// -------------------------------------------------------------

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete {path}: {e}"))
}

// -------------------------------------------------------------
// Main Entry Point
// -------------------------------------------------------------

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
                analyze_video,
                extract_audio_for_transcription,
                convert_audio_to_wav,
                export_frames_to_mp4,
                check_ffmpeg,
                delete_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CutFlow AI");
}
