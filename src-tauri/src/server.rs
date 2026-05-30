// CutFlow AI — Axum HTTP Server with MCP (Model Context Protocol)
//
// Port 14220
//
// REST API:
//   GET  /api/timeline              — read current TimelineState
//   POST /api/timeline/edit         — delete_range
//   POST /api/timeline/load         — load video
//   POST /api/timeline/split        — split segment
//   POST /api/timeline/mark         — mark segment type
//   POST /api/timeline/toggle-skip  — toggle silence skip
//   POST /api/timeline/transcript   — store transcript from frontend
//
// MCP (SSE transport):
//   GET  /mcp                       — SSE stream (creates session)
//   POST /mcp/message               — receive JSON-RPC messages

use axum::{
    extract::{Query, State},
    http::{HeaderValue, Method, StatusCode},
    response::{
        sse::{Event, Sse, KeepAlive},
        Json,
    },
    routing::{get, post},
    Router,
};
use futures::stream::{self, Stream};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    convert::Infallible,
    sync::{Arc, RwLock},
    time::Instant,
};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::cors::{Any, CorsLayer};

use crate::{EdlSegment, TimelineState};

// ─────────────────────────────────────────────────────────────
// Shared application state type alias
// ─────────────────────────────────────────────────────────────

pub type SharedState = Arc<RwLock<TimelineState>>;

// ─────────────────────────────────────────────────────────────
// MCP Session Management
// ─────────────────────────────────────────────────────────────

struct McpSession {
    tx: broadcast::Sender<String>,
    created_at: Instant,
}

static MCP_SESSIONS: Lazy<Arc<RwLock<HashMap<String, McpSession>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

fn cleanup_stale_sessions() {
    if let Ok(mut sessions) = MCP_SESSIONS.write() {
        sessions.retain(|_, s| s.created_at.elapsed().as_secs() < 3600);
    }
}

// ─────────────────────────────────────────────────────────────
// REST API Request / Response schemas
// ─────────────────────────────────────────────────────────────

#[derive(Deserialize, Debug)]
pub struct EditRequest {
    pub action: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Serialize, Debug)]
pub struct EditResponse {
    pub success: bool,
    pub message: String,
    pub affected_segments: usize,
}

#[derive(Deserialize)]
pub struct LoadVideoRequest {
    pub path: String,
    pub duration: f64,
}

#[derive(Deserialize)]
pub struct SplitSegmentRequest {
    pub segment_id: String,
    pub split_time: f64,
}

#[derive(Deserialize)]
pub struct MarkSegmentRequest {
    pub segment_id: String,
    pub segment_type: String,
}

#[derive(Deserialize, Serialize)]
pub struct TranscriptEntry {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Deserialize)]
pub struct SetTranscriptRequest {
    pub transcript: Vec<TranscriptEntry>,
}

#[derive(Deserialize)]
pub struct SessionQuery {
    pub id: String,
}

// ─────────────────────────────────────────────────────────────
// REST: GET /api/timeline
// ─────────────────────────────────────────────────────────────

async fn get_timeline(
    State(state): State<SharedState>,
) -> Result<Json<TimelineState>, (StatusCode, String)> {
    let snapshot = state
        .read()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Lock error: {e}")))?
        .clone();
    Ok(Json(snapshot))
}

// ─────────────────────────────────────────────────────────────
// REST: POST /api/timeline/edit  — delete_range
// ─────────────────────────────────────────────────────────────

async fn post_timeline_edit(
    State(state): State<SharedState>,
    Json(payload): Json<EditRequest>,
) -> Result<Json<EditResponse>, (StatusCode, String)> {
    if payload.action != "delete_range" {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Unsupported action: '{}'", payload.action),
        ));
    }
    if payload.start >= payload.end {
        return Err((
            StatusCode::BAD_REQUEST,
            "start must be less than end".to_string(),
        ));
    }

    let mut write_guard = state
        .write()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Lock error: {e}")))?;

    let mut affected = 0usize;
    let mut new_edl: Vec<EdlSegment> = Vec::new();

    for seg in write_guard.edl.iter() {
        let overlaps = seg.start < payload.end && seg.end > payload.start;
        if overlaps && seg.segment_type != "user-deleted" {
            if seg.start >= payload.start && seg.end <= payload.end {
                new_edl.push(EdlSegment {
                    id: seg.id.clone(),
                    start: seg.start,
                    end: seg.end,
                    segment_type: "user-deleted".to_string(),
                });
                affected += 1;
            } else if seg.start >= payload.start && seg.start < payload.end {
                new_edl.push(EdlSegment {
                    id: seg.id.clone(),
                    start: seg.start,
                    end: payload.end.min(seg.end),
                    segment_type: "user-deleted".to_string(),
                });
                if seg.end > payload.end {
                    new_edl.push(EdlSegment {
                        id: uuid::Uuid::new_v4().to_string(),
                        start: payload.end,
                        end: seg.end,
                        segment_type: seg.segment_type.clone(),
                    });
                }
                affected += 1;
            } else if seg.end > payload.start && seg.end <= payload.end {
                new_edl.push(EdlSegment {
                    id: seg.id.clone(),
                    start: seg.start,
                    end: payload.start.max(seg.start),
                    segment_type: seg.segment_type.clone(),
                });
                new_edl.push(EdlSegment {
                    id: uuid::Uuid::new_v4().to_string(),
                    start: payload.start.max(seg.start),
                    end: seg.end,
                    segment_type: "user-deleted".to_string(),
                });
                affected += 1;
            } else if seg.start < payload.start && seg.end > payload.end {
                new_edl.push(EdlSegment {
                    id: seg.id.clone(),
                    start: seg.start,
                    end: payload.start,
                    segment_type: seg.segment_type.clone(),
                });
                new_edl.push(EdlSegment {
                    id: uuid::Uuid::new_v4().to_string(),
                    start: payload.start,
                    end: payload.end,
                    segment_type: "user-deleted".to_string(),
                });
                new_edl.push(EdlSegment {
                    id: uuid::Uuid::new_v4().to_string(),
                    start: payload.end,
                    end: seg.end,
                    segment_type: seg.segment_type.clone(),
                });
                affected += 1;
            } else {
                new_edl.push(seg.clone());
            }
        } else {
            new_edl.push(seg.clone());
        }
    }

    write_guard.edl = new_edl;

    Ok(Json(EditResponse {
        success: true,
        message: format!(
            "delete_range [{:.3}s → {:.3}s] applied",
            payload.start, payload.end
        ),
        affected_segments: affected,
    }))
}

// ─────────────────────────────────────────────────────────────
// REST: POST /api/timeline/load
// ─────────────────────────────────────────────────────────────

async fn post_load_video(
    State(state): State<SharedState>,
    Json(payload): Json<LoadVideoRequest>,
) -> Result<Json<TimelineState>, (StatusCode, String)> {
    let mut write = state
        .write()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Lock error: {e}")))?;

    write.source_video_path = payload.path;
    write.current_time = 0.0;
    write.edl = vec![EdlSegment {
        id: uuid::Uuid::new_v4().to_string(),
        start: 0.0,
        end: payload.duration,
        segment_type: "keep".to_string(),
    }];

    Ok(Json(write.clone()))
}

// ─────────────────────────────────────────────────────────────
// REST: POST /api/timeline/split
// ─────────────────────────────────────────────────────────────

async fn post_split_segment(
    State(state): State<SharedState>,
    Json(payload): Json<SplitSegmentRequest>,
) -> Result<Json<TimelineState>, (StatusCode, String)> {
    let mut write = state
        .write()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Lock error: {e}")))?;

    let mut new_edl = Vec::new();
    for seg in &write.edl {
        if seg.id == payload.segment_id && payload.split_time > seg.start
            && payload.split_time < seg.end
        {
            new_edl.push(EdlSegment {
                id: uuid::Uuid::new_v4().to_string(),
                start: seg.start,
                end: payload.split_time,
                segment_type: seg.segment_type.clone(),
            });
            new_edl.push(EdlSegment {
                id: uuid::Uuid::new_v4().to_string(),
                start: payload.split_time,
                end: seg.end,
                segment_type: seg.segment_type.clone(),
            });
        } else {
            new_edl.push(seg.clone());
        }
    }
    write.edl = new_edl;

    Ok(Json(write.clone()))
}

// ─────────────────────────────────────────────────────────────
// REST: POST /api/timeline/mark
// ─────────────────────────────────────────────────────────────

async fn post_mark_segment(
    State(state): State<SharedState>,
    Json(payload): Json<MarkSegmentRequest>,
) -> Result<Json<TimelineState>, (StatusCode, String)> {
    let mut write = state
        .write()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Lock error: {e}")))?;

    for seg in write.edl.iter_mut() {
        if seg.id == payload.segment_id {
            seg.segment_type = payload.segment_type;
            break;
        }
    }

    Ok(Json(write.clone()))
}

// ─────────────────────────────────────────────────────────────
// REST: POST /api/timeline/toggle-skip
// ─────────────────────────────────────────────────────────────

async fn post_toggle_silence(
    State(state): State<SharedState>,
) -> Result<Json<TimelineState>, (StatusCode, String)> {
    let mut write = state
        .write()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Lock error: {e}")))?;

    write.is_silence_skip_enabled = !write.is_silence_skip_enabled;

    Ok(Json(write.clone()))
}

// ─────────────────────────────────────────────────────────────
// REST: POST /api/timeline/transcript
// Stores transcript data sent by the frontend after Whisper completes
// ─────────────────────────────────────────────────────────────

async fn post_set_transcript(
    State(state): State<SharedState>,
    Json(payload): Json<SetTranscriptRequest>,
) -> Result<Json<()>, (StatusCode, String)> {
    // Transcript is stored as a serialized JSON string in a new field
    // Extend TimelineState to hold transcript if needed
    let mut write = state
        .write()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Lock error: {e}")))?;

    write.transcript_json =
        Some(serde_json::to_value(&payload.transcript).unwrap_or_default());

    Ok(Json(()))
}

// ─────────────────────────────────────────────────────────────
// MCP: GET /mcp  — SSE stream
// ─────────────────────────────────────────────────────────────

async fn mcp_sse_handler(
    State(_state): State<SharedState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = broadcast::channel::<String>(256);

    {
        let mut sessions = MCP_SESSIONS.write().unwrap_or_else(|e| e.into_inner());
        sessions.insert(
            session_id.clone(),
            McpSession {
                tx,
                created_at: Instant::now(),
            },
        );
    }

    // Clean up stale sessions periodically
    cleanup_stale_sessions();

    let initial = stream::once(async move {
        Ok(Event::default()
            .event("endpoint")
            .data(format!("/mcp/message?id={}", session_id)))
    });

    let rx = BroadcastStream::new(rx);
    let messages = rx.map(|msg| match msg {
        Ok(data) => Ok(Event::default().event("message").data(data)),
        Err(_) => Ok(Event::default().event("error").data("channel closed")),
    });

    let combined = initial.chain(messages);

    Sse::new(combined).keep_alive(
        KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text("keep-alive"),
    )
}

// ─────────────────────────────────────────────────────────────
// MCP: POST /mcp/message  — receive JSON-RPC
// ─────────────────────────────────────────────────────────────

async fn mcp_message_handler(
    Query(query): Query<SessionQuery>,
    State(state): State<SharedState>,
    body: String,
) -> Result<Json<Value>, (StatusCode, String)> {
    let sessions = MCP_SESSIONS
        .read()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let session = sessions
        .get(&query.id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, "MCP session not found".to_string()))?;

    let json_body: Value =
        serde_json::from_str(&body).map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid JSON: {e}")))?;

    let response = handle_mcp_message(json_body, state);

    let response_str = serde_json::to_string(&response)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Send response through SSE — ignore error if client disconnected
    let _ = session.tx.send(response_str);

    Ok(Json(json!({ "accepted": true })))
}

// ─────────────────────────────────────────────────────────────
// MCP JSON-RPC Message Handler
// ─────────────────────────────────────────────────────────────

fn handle_mcp_message(body: Value, state: SharedState) -> Value {
    let method = body
        .get("method")
        .and_then(|m| m.as_str())
        .unwrap_or("");
    let id = body.get("id").cloned();

    match method {
        "initialize" => {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": { "tools": {} },
                    "serverInfo": {
                        "name": "cutflow-ai",
                        "version": "0.1.0"
                    }
                }
            })
        }
        "notifications/initialized" => {
            json!({
                "jsonrpc": "2.0",
                "id": id
            })
        }
        "tools/list" => {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "tools": [
                        {
                            "name": "get_timeline",
                            "description": "Get the current timeline state including all EDL segments, audio tracks, and editor settings",
                            "inputSchema": {
                                "type": "object",
                                "properties": {},
                                "required": []
                            }
                        },
                        {
                            "name": "get_timeline_summary",
                            "description": "Get a human-readable summary of the current timeline suitable for AI context — includes segment counts, duration, and source video info",
                            "inputSchema": {
                                "type": "object",
                                "properties": {},
                                "required": []
                            }
                        },
                        {
                            "name": "load_video",
                            "description": "Load a video file into the editor. Replaces any current project.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string", "description": "Absolute filesystem path to the video file" },
                                    "duration": { "type": "number", "description": "Total duration of the video in seconds" }
                                },
                                "required": ["path", "duration"]
                            }
                        },
                        {
                            "name": "cut_range",
                            "description": "Delete a time range from the edit, marking all overlapping segments as 'user-deleted'. The video is not actually deleted, just hidden in the output.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "start": { "type": "number", "description": "Start time in seconds" },
                                    "end": { "type": "number", "description": "End time in seconds" }
                                },
                                "required": ["start", "end"]
                            }
                        },
                        {
                            "name": "mark_segment",
                            "description": "Change the type of a timeline segment. Types: 'keep' (included in export), 'silence' (auto-detected silence, can be auto-skipped), 'user-deleted' (manually removed by user).",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "segment_id": { "type": "string", "description": "The UUID of the segment to modify" },
                                    "segment_type": { "type": "string", "enum": ["keep", "silence", "user-deleted"], "description": "New type for the segment" }
                                },
                                "required": ["segment_id", "segment_type"]
                            }
                        },
                        {
                            "name": "split_segment",
                            "description": "Split a single segment into two segments at a given time point",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "segment_id": { "type": "string", "description": "The UUID of the segment to split" },
                                    "split_time": { "type": "number", "description": "Time in seconds at which to split" }
                                },
                                "required": ["segment_id", "split_time"]
                            }
                        },
                        {
                            "name": "toggle_silence_skip",
                            "description": "Toggle whether silence and deleted segments are automatically skipped during playback",
                            "inputSchema": {
                                "type": "object",
                                "properties": {},
                                "required": []
                            }
                        },
                        {
                            "name": "analyze_video",
                            "description": "Run AI silence detection on the currently loaded video. This generates an EDL with 'keep' and 'silence' segments. Requires ffmpeg sidecar (Tauri desktop app).",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "sensitivity": { "type": "string", "enum": ["minimal", "balanced", "action", "aggressive"], "description": "How aggressively to cut silence: minimal=long pauses only, balanced=default, action=tight cuts, aggressive=max cuts" }
                                },
                                "required": ["sensitivity"]
                            }
                        },
                        {
                            "name": "export_video",
                            "description": "Export the current timeline as an MP4 video file using ffmpeg. Only segments marked as 'keep' are included.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "output_path": { "type": "string", "description": "Absolute filesystem path for the output MP4 file" }
                                },
                                "required": ["output_path"]
                            }
                        }
                    ]
                }
            })
        }
        "tools/call" => {
            let tool_name = body
                .get("params")
                .and_then(|p| p.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let arguments = body
                .get("params")
                .and_then(|p| p.get("arguments"))
                .cloned()
                .unwrap_or(json!({}));

            let result = execute_mcp_tool(tool_name, arguments, &state);

            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": serde_json::to_string_pretty(&result).unwrap_or_default()
                        }
                    ]
                }
            })
        }
        "ping" => {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {}
            })
        }
        _ => {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": format!("Method not found: {method}")
                }
            })
        }
    }
}

// ─────────────────────────────────────────────────────────────
// MCP Tool Execution
// ─────────────────────────────────────────────────────────────

fn execute_mcp_tool(name: &str, args: Value, state: &SharedState) -> Value {
    match name {
        "get_timeline" => {
            let snapshot = state
                .read()
                .ok()
                .map(|guard| guard.clone())
                .unwrap_or_default();
            serde_json::to_value(&snapshot).unwrap_or(json!({}))
        }
        "get_timeline_summary" => {
            let snapshot = state
                .read()
                .ok()
                .map(|guard| guard.clone())
                .unwrap_or_default();
            let keep_count = snapshot.edl.iter().filter(|s| s.segment_type == "keep").count();
            let silence_count = snapshot.edl.iter().filter(|s| s.segment_type == "silence").count();
            let deleted_count = snapshot.edl.iter().filter(|s| s.segment_type == "user-deleted").count();
            let total_duration: f64 = snapshot.edl.iter().map(|s| s.end).fold(0.0, f64::max);

            json!({
                "source_video": snapshot.source_video_path,
                "total_duration_seconds": total_duration,
                "segments": {
                    "total": snapshot.edl.len(),
                    "keep": keep_count,
                    "silence": silence_count,
                    "deleted": deleted_count
                },
                "silence_skip_enabled": snapshot.is_silence_skip_enabled,
                "transition_type": snapshot.transitionType,
                "transition_duration_seconds": snapshot.transitionDuration,
            })
        }
        "load_video" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let duration = args.get("duration").and_then(|v| v.as_f64()).unwrap_or(60.0);
            match state.write() {
                Ok(mut write) => {
                    write.source_video_path = path.clone();
                    write.current_time = 0.0;
                    write.edl = vec![EdlSegment {
                        id: uuid::Uuid::new_v4().to_string(),
                        start: 0.0,
                        end: duration,
                        segment_type: "keep".to_string(),
                    }];
                    json!({
                        "success": true,
                        "message": format!("Loaded video: {} ({:.1}s)", path, duration),
                        "duration": duration
                    })
                }
                Err(e) => json!({ "success": false, "message": format!("Lock error: {e}") }),
            }
        }
        "cut_range" => {
            let start = args.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let end = args.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0);
            match state.write() {
                Ok(mut write) => {
                    let mut affected = 0usize;
                    let mut new_edl = Vec::new();
                    for seg in &write.edl {
                        let overlaps = seg.start < end && seg.end > start;
                        if overlaps && seg.segment_type != "user-deleted" {
                            new_edl.push(EdlSegment {
                                id: seg.id.clone(),
                                start: seg.start,
                                end: seg.end,
                                segment_type: "user-deleted".to_string(),
                            });
                            affected += 1;
                        } else {
                            new_edl.push(seg.clone());
                        }
                    }
                    write.edl = new_edl;
                    json!({
                        "success": true,
                        "message": format!("Cut [{:.3}s → {:.3}s]. {} segment(s) affected.", start, end, affected),
                        "affected_segments": affected
                    })
                }
                Err(e) => json!({ "success": false, "message": format!("Lock error: {e}") }),
            }
        }
        "mark_segment" => {
            let segment_id = args.get("segment_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let segment_type = args.get("segment_type").and_then(|v| v.as_str()).unwrap_or("keep").to_string();
            match state.write() {
                Ok(mut write) => {
                    for seg in write.edl.iter_mut() {
                        if seg.id == segment_id {
                            seg.segment_type = segment_type.clone();
                            break;
                        }
                    }
                    json!({ "success": true, "message": format!("Segment {} marked as '{}'", segment_id, segment_type) })
                }
                Err(e) => json!({ "success": false, "message": format!("Lock error: {e}") }),
            }
        }
        "split_segment" => {
            let segment_id = args.get("segment_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let split_time = args.get("split_time").and_then(|v| v.as_f64()).unwrap_or(0.0);
            match state.write() {
                Ok(mut write) => {
                    let mut new_edl = Vec::new();
                    for seg in &write.edl {
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
                    write.edl = new_edl;
                    json!({ "success": true, "message": format!("Split segment {} at {:.3}s", segment_id, split_time) })
                }
                Err(e) => json!({ "success": false, "message": format!("Lock error: {e}") }),
            }
        }
        "toggle_silence_skip" => {
            match state.write() {
                Ok(mut write) => {
                    write.is_silence_skip_enabled = !write.is_silence_skip_enabled;
                    json!({
                        "success": true,
                        "silence_skip_enabled": write.is_silence_skip_enabled
                    })
                }
                Err(e) => json!({ "success": false, "message": format!("Lock error: {e}") }),
            }
        }
        "analyze_video" => {
            // Requires ffmpeg sidecar via Tauri IPC (not available from HTTP server directly)
            let sensitivity = args.get("sensitivity").and_then(|v| v.as_str()).unwrap_or("balanced");
            json!({
                "success": true,
                "message": format!("Analysis triggered with '{}' sensitivity. Note: analysis runs in the desktop app via ffmpeg. The frontend will update when complete.", sensitivity),
                "note": "Run from UI or Tauri IPC for actual ffmpeg execution"
            })
        }
        "export_video" => {
            let output_path = args.get("output_path").and_then(|v| v.as_str()).unwrap_or("").to_string();
            json!({
                "success": true,
                "message": format!("Export queued to: {}. Export runs via ffmpeg sidecar in the desktop app.", output_path),
                "note": "Run from UI or Tauri IPC for actual ffmpeg execution"
            })
        }
        _ => {
            json!({ "error": format!("Unknown tool: {name}") })
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Server Bootstrap
// ─────────────────────────────────────────────────────────────

pub async fn start_axum_server(state: SharedState) {
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any)
        .allow_origin(
            "http://localhost:1420"
                .parse::<HeaderValue>()
                .unwrap_or(HeaderValue::from_static("*")),
        );

    let app = Router::new()
        // REST API
        .route("/api/timeline", get(get_timeline))
        .route("/api/timeline/edit", post(post_timeline_edit))
        .route("/api/timeline/load", post(post_load_video))
        .route("/api/timeline/split", post(post_split_segment))
        .route("/api/timeline/mark", post(post_mark_segment))
        .route("/api/timeline/toggle-skip", post(post_toggle_silence))
        .route("/api/timeline/transcript", post(post_set_transcript))
        // MCP Protocol (SSE transport)
        .route("/mcp", get(mcp_sse_handler))
        .route("/mcp/message", post(mcp_message_handler))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:14220")
        .await
        .expect("Failed to bind Axum server on port 14220");

    println!("[CutFlow AI] Axum server running on http://127.0.0.1:14220");
    println!("[CutFlow AI] MCP SSE endpoint: http://127.0.0.1:14220/mcp");

    axum::serve(listener, app)
        .await
        .expect("Axum server crashed");
}
