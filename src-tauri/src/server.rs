// CutFlow AI — Axum HTTP Server (port 14220)
//
// Provides an external REST API so third-party tools or scripts can
// push timeline edits into the running application without going through
// the Tauri IPC bridge directly.
//
// Routes:
//   POST /api/timeline/edit  — delete_range action
//   GET  /api/timeline       — read current state snapshot

use axum::{
    extract::State,
    http::{HeaderValue, Method, StatusCode},
    response::Json,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};
use tower_http::cors::{Any, CorsLayer};

use crate::{EdlSegment, TimelineState};

// ─────────────────────────────────────────────────────────────
// Shared application state type alias
// ─────────────────────────────────────────────────────────────

pub type SharedState = Arc<RwLock<TimelineState>>;

// ─────────────────────────────────────────────────────────────
// Request / Response schemas
// ─────────────────────────────────────────────────────────────

#[derive(Deserialize, Debug)]
pub struct EditRequest {
    pub action: String, // Only "delete_range" is supported currently
    pub start: f64,
    pub end: f64,
}

#[derive(Serialize, Debug)]
pub struct EditResponse {
    pub success: bool,
    pub message: String,
    pub affected_segments: usize,
}

// ─────────────────────────────────────────────────────────────
// Route: GET /api/timeline
// Returns the current TimelineState snapshot as JSON
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
// Route: POST /api/timeline/edit
//
// Payload: { "action": "delete_range", "start": f64, "end": f64 }
//
// Logic:
//   1. Acquire write lock on the shared TimelineState
//   2. Iterate over EDL segments
//   3. Any segment whose time range overlaps [start, end] is marked "user-deleted"
//   4. Return count of affected segments
//
// Note: Because the Axum server runs in a separate OS thread from the Tauri
// runtime, we cannot call app.emit() directly here. Instead, the frontend
// polls GET /api/timeline or the Tauri command layer re-reads on a timer.
// For full real-time push, the frontend should poll this endpoint or use
// a WebSocket upgrade (future enhancement).
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
        // Overlap check: segments that are fully or partially within [start, end]
        let overlaps = seg.start < payload.end && seg.end > payload.start;

        if overlaps && seg.segment_type != "user-deleted" {
            // Case 1: segment is entirely within the delete range — mark the whole segment
            if seg.start >= payload.start && seg.end <= payload.end {
                new_edl.push(EdlSegment {
                    id: seg.id.clone(),
                    start: seg.start,
                    end: seg.end,
                    segment_type: "user-deleted".to_string(),
                });
                affected += 1;
            }
            // Case 2: delete range cuts through the start of the segment
            else if seg.start >= payload.start && seg.start < payload.end {
                // Keep the portion after the delete range
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
            }
            // Case 3: delete range cuts through the end of the segment
            else if seg.end > payload.start && seg.end <= payload.end {
                // Keep the portion before the delete range
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
            }
            // Case 4: delete range is entirely inside a larger segment — split it
            else if seg.start < payload.start && seg.end > payload.end {
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
// Server Bootstrap
// Called from lib.rs in a dedicated OS thread with its own Tokio runtime
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
        .route("/api/timeline", get(get_timeline))
        .route("/api/timeline/edit", post(post_timeline_edit))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:14220")
        .await
        .expect("Failed to bind Axum server on port 14220");

    println!("[CutFlow AI] Axum server running on http://127.0.0.1:14220");

    axum::serve(listener, app)
        .await
        .expect("Axum server crashed");
}
