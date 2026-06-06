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

/// Simplified B-Roll input sent from the ExportDialog for FFmpeg compositing.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BRollInput {
    pub path: String,
    pub start: f64,       // start time in the main video timeline (seconds)
    pub duration: f64,    // how long it overlays (seconds)
    pub scale: f64,       // 1.0 = full width
    pub x: f64,           // -1..1 horizontal offset
    pub y: f64,           // -1..1 vertical offset
    pub rotation: f64,    // rotation in degrees
    pub opacity: f64,     // 0..1
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
    video_filter: Option<String>,
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

    // Build the final video label — optionally pipe through effects filter
    let (v_final, extra_filter) = if let Some(ref vfx) = video_filter {
        if !vfx.is_empty() {
            filtergraph.push_str(&format!("{}concat=n={}:v=1:a=1[v_concat][a_cut];", concat_inputs, n));
            filtergraph.push_str(&format!("[v_concat]{}[v_cut]", vfx));
            ("[v_cut]".to_string(), "".to_string())
        } else {
            filtergraph.push_str(&format!("{}concat=n={}:v=1:a=1[v_cut][a_cut]", concat_inputs, n));
            ("[v_cut]".to_string(), "".to_string())
        }
    } else {
        filtergraph.push_str(&format!("{}concat=n={}:v=1:a=1[v_cut][a_cut]", concat_inputs, n));
        ("[v_cut]".to_string(), "".to_string())
    };
    let _ = extra_filter;

    let normalized_input = normalize_windows_path(&state.source_video_path);
    let normalized_output = normalize_windows_path(&output_path);

    let args = serde_json::json!([
        "-y",
        "-i",
        normalized_input,
        "-filter_complex",
        filtergraph,
        "-map",
        v_final,
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
    _subtitle_style: Option<String>,
    video_filter: Option<String>,
    broll_inputs: Option<Vec<BRollInput>>,
) -> Result<String, String> {
    // Determine which passes we need:
    let needs_subtitles = srt_path.as_ref().map_or(false, |p| std::fs::metadata(p).is_ok());
    let valid_brolls: Vec<BRollInput> = broll_inputs
        .unwrap_or_default()
        .into_iter()
        .filter(|b| !b.path.is_empty() && std::fs::metadata(&b.path).is_ok())
        .collect();
    let needs_broll = !valid_brolls.is_empty();

    // Temp paths
    let tmp_dir = std::env::temp_dir();
    let pass1_path = tmp_dir.join("cutflow_pass1.mp4").to_string_lossy().to_string();
    let pass2_path = tmp_dir.join("cutflow_pass2.mp4").to_string_lossy().to_string();

    // The final destination of pass 1 is a temp file whenever we have more passes
    let concat_out = if needs_broll || needs_subtitles {
        pass1_path.clone()
    } else {
        output_path.clone()
    };

    // ── Pass 1: trim + concat (with optional eq/boxblur/hue filter) ─────────
    let args_json = generate_concat_args(concat_out.clone(), video_filter.clone())?;
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

    // ── Pass 1.5: B-Roll overlay compositing ─────────────────────────────────
    //
    // Strategy:
    //   -  Input 0 is the pass-1 edited video (full length).
    //   -  For each B-roll we use -itsoffset <start> so the B-roll stream is
    //      time-shifted to begin at the correct moment in the output timeline.
    //   -  We trim the B-roll to exactly <duration> seconds with -t.
    //   -  This avoids the PTS arithmetic inside filter_complex that was
    //      causing empty / zero-duration streams.
    //   -  The overlay is always enabled (no `enable=` guard needed because
    //      the stream is already trimmed and time-shifted).
    //   -  Opacity is implemented with the `colorchannelmixer` alpha channel
    //      after converting to yuva420p.
    //   -  Rotation uses the `rotate` filter with `fillcolor=none`.
    let broll_out = if needs_subtitles {
        pass2_path.clone()
    } else {
        output_path.clone()
    };

    if needs_broll {
        // Build the argument list:
        //   -y
        //   -i pass1.mp4
        //   -itsoffset <start_N> -ss 0 -t <duration_N> -i broll_N.mp4
        //   ... (repeated for each B-roll)
        //   -filter_complex ...
        //   -map [vout] -map 0:a  -c:v libx264 ...
        let mut broll_args: Vec<String> = vec![
            "-y".into(),
            "-i".into(), normalize_windows_path(&pass1_path),
        ];

        for br in &valid_brolls {
            // Time-shift: the B-roll will appear in the output at `br.start` seconds.
            broll_args.push("-itsoffset".into());
            broll_args.push(format!("{:.6}", br.start));
            // Trim the B-roll so it doesn't extend past its window
            broll_args.push("-t".into());
            broll_args.push(format!("{:.6}", br.duration));
            broll_args.push("-i".into());
            broll_args.push(normalize_windows_path(&br.path));
        }

        // Build filter_complex
        // Each B-roll input is scaled, optionally rotated, converted to yuva420p
        // (for alpha support), then its alpha multiplied by the desired opacity,
        // then overlaid on top of the running base stream.
        let mut filter = String::new();
        let mut last_label = "[0:v]".to_string();

        for (i, br) in valid_brolls.iter().enumerate() {
            let inp_idx = i + 1; // ffmpeg input index (0 = main video)
            let scaled_label = format!("[sc{}]", i);
            let out_label   = format!("[v{}]", i);

            let scale_factor = br.scale.max(0.01);
            // x_offset: br.x is -1..1 → map to fraction of (W - w)
            let x_expr = format!("(W-w)*{:.6}", (br.x + 1.0) / 2.0);
            let y_expr = format!("(H-h)*{:.6}", (br.y + 1.0) / 2.0);
            let alpha  = br.opacity.clamp(0.0, 1.0);

            // Step 1: scale → yuva420p (gives alpha channel) → optional rotate → opacity
            let rot_part = if br.rotation.abs() > 0.001 {
                format!(",rotate={:.6}*PI/180:ow=hypot(iw\\,ih):oh=ow:fillcolor=none", br.rotation)
            } else {
                String::new()
            };

            filter.push_str(&format!(
                "[{inp}:v]scale=iw*{sc:.6}:ih*{sc:.6},format=yuva420p{rot},colorchannelmixer=aa={al:.6}{sl};",
                inp = inp_idx,
                sc  = scale_factor,
                rot = rot_part,
                al  = alpha,
                sl  = scaled_label,
            ));

            // Step 2: overlay on the running base
            // shortest=0 keeps the base video running after the B-roll ends.
            filter.push_str(&format!(
                "{last}[{sl}]overlay={x}:{y}:shortest=0{ol};",
                last = last_label,
                sl   = &scaled_label[1..scaled_label.len()-1], // strip [ ]
                x    = x_expr,
                y    = y_expr,
                ol   = out_label,
            ));

            last_label = out_label;
        }

        let final_v_label = format!("[v{}]", valid_brolls.len() - 1);
        let filter_trimmed = filter.trim_end_matches(';');

        broll_args.extend([
            "-filter_complex".into(), filter_trimmed.to_string(),
            "-map".into(), final_v_label,
            "-map".into(), "0:a".into(),
            "-c:v".into(), "libx264".into(),
            "-preset".into(), "fast".into(),
            "-crf".into(), "18".into(),
            "-c:a".into(), "copy".into(),
            "-movflags".into(), "+faststart".into(),
            normalize_windows_path(&broll_out),
        ]);

        let out_broll = app.shell().sidecar("ffmpeg")
            .map_err(|e| format!("FFmpeg sidecar error: {e}"))?
            .args(broll_args)
            .output()
            .await
            .map_err(|e| format!("FFmpeg B-roll pass spawn failed: {e}"))?;

        let _ = std::fs::remove_file(&pass1_path);

        if !out_broll.status.success() {
            let stderr = String::from_utf8_lossy(&out_broll.stderr).to_string();
            return Err(format!("FFmpeg B-roll compositing failed:\n{stderr}"));
        }
    }

    // ── Pass 2: subtitle burn-in via ASS filter ───────────────────────────
    //
    // The subtitle file is a self-contained .ass script generated by
    // generateSrtForExport() in subtitles.ts.  It already embeds all style
    // information (font, size, colour, box, alignment, highlights) in its
    // [V4+ Styles] section, so we use the `ass=` filter (not `subtitles=`
    // with force_style) to preserve those styles exactly as authored.
    //
    // Path escaping rules for the ASS filter:
    //   • Backslashes → forward slashes
    //   • Drive colon must be escaped: C:/foo → C\:/foo
    //   • Single quotes must be escaped: '  → \'
    if needs_subtitles {
        let ass_path = srt_path.unwrap();
        let sub_input = if needs_broll { &broll_out } else { &pass1_path };

        // Normalise to forward slashes
        let fwd = ass_path.replace('\\', "/");
        // Escape the drive-letter colon for ffmpeg filter string
        let escaped = if fwd.len() > 1 && &fwd[1..2] == ":" {
            format!("{}\\:{}", &fwd[..1], &fwd[2..])
        } else {
            fwd.clone()
        };
        // Escape any remaining single quotes
        let escaped = escaped.replace('\'', "\\'");

        // Use the `ass` filter — it reads the ASS [V4+ Styles] section natively.
        let vf = format!("ass='{}'", escaped);

        let normalized_sub_input = normalize_windows_path(sub_input);
        let normalized_out = normalize_windows_path(&output_path);

        let pass2_args: Vec<String> = vec![
            "-y".into(),
            "-i".into(), normalized_sub_input,
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
            .map_err(|e| format!("FFmpeg pass-2 (subtitles) spawn failed: {e}"))?;

        // Clean up temp files regardless
        let _ = std::fs::remove_file(sub_input);
        let _ = std::fs::remove_file(&ass_path);

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
// Tauri Command: convert_audio_to_wav
// Converts a recorded webm/ogg audio file to WAV via FFmpeg
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Tauri Command: delete_file
// Deletes a file from disk (used to clean up temp files)
// ─────────────────────────────────────────────────────────────

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete {path}: {e}"))
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
            convert_audio_to_wav,
            delete_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CutFlow AI");
}
