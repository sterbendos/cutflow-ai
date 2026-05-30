// CutFlow AI — Timeline Component
// 200px footer multitrack deck with ruler, segment blocks,
// draggable playhead, and per-segment type color coding.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EdlSegment, useTimeline } from '@/context/TimelineContext';

// ─── Constants ────────────────────────────────────────────────

const RULER_TICK_COUNT = 10;
const MIN_SEGMENT_WIDTH_PX = 2;

// ─── Helpers ──────────────────────────────────────────────────

function formatRulerTime(secs: number): string {
  if (secs < 60) return `${secs.toFixed(0)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getSegmentClass(type: EdlSegment['segment_type']): string {
  return `segment-block ${type}`;
}

function getSegmentTitle(seg: EdlSegment): string {
  const typeLabel =
    seg.segment_type === 'keep'
      ? '✓ Keep'
      : seg.segment_type === 'silence'
      ? '🔇 Silence'
      : '✗ Deleted';
  return `${typeLabel}  ${seg.start.toFixed(2)}s → ${seg.end.toFixed(2)}s`;
}

// ─────────────────────────────────────────────────────────────

export default function Timeline() {
  const { state, markSegment, splitSegment, removeAudioSegment } = useTimeline();
  const railRef = useRef<HTMLDivElement>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [localTime, setLocalTime] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);

  // ── Total duration derived from EDL ──────────────────────
  const duration = useMemo(() => {
    if (state.edl.length === 0) return 60;
    return Math.max(...state.edl.map((s) => s.end));
  }, [state.edl]);

  // ── Display time: dragging overrides context time ─────────
  const displayTime = isDraggingPlayhead ? localTime : state.current_time;

  // ── Convert time → percentage ─────────────────────────────
  const timeToPct = useCallback(
    (t: number) => Math.max(0, Math.min(100, (t / duration) * 100)),
    [duration]
  );

  // ── Convert rail x-position → time ───────────────────────
  const xToTime = useCallback(
    (clientX: number): number => {
      const rail = railRef.current;
      if (!rail) return 0;
      const rect = rail.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration]
  );

  // ── Ruler ticks ───────────────────────────────────────────
  const rulerTicks = useMemo(() => {
    const ticks = [];
    for (let i = 0; i <= RULER_TICK_COUNT; i++) {
      const t = (i / RULER_TICK_COUNT) * duration;
      const pct = timeToPct(t);
      ticks.push({ t, pct });
    }
    return ticks;
  }, [duration, timeToPct]);

  // ── Playhead drag ─────────────────────────────────────────
  const handleRailMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const t = xToTime(e.clientX);
      setLocalTime(t);
      setIsDraggingPlayhead(true);

      // Seek the actual video element directly for low-latency feel
      const video = document.getElementById('main-video') as HTMLVideoElement | null;
      if (video) video.currentTime = t;
    },
    [xToTime]
  );

  useEffect(() => {
    if (!isDraggingPlayhead) return;

    function onMouseMove(e: MouseEvent) {
      const t = xToTime(e.clientX);
      setLocalTime(t);
      const video = document.getElementById('main-video') as HTMLVideoElement | null;
      if (video) video.currentTime = t;
    }

    function onMouseUp(e: MouseEvent) {
      const t = xToTime(e.clientX);
      setLocalTime(t);
      const video = document.getElementById('main-video') as HTMLVideoElement | null;
      if (video) video.currentTime = t;
      setIsDraggingPlayhead(false);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDraggingPlayhead, xToTime]);

  // ── Segment click: cycle type keep → silence → user-deleted → keep ──
  async function handleSegmentClick(
    e: React.MouseEvent,
    seg: EdlSegment
  ) {
    e.stopPropagation();
    if (e.shiftKey) {
       // Razor tool: split at exact click position
       const t = xToTime(e.clientX);
       await splitSegment(t);
       return;
    }
    const nextType: EdlSegment['segment_type'] =
      seg.segment_type === 'keep'
        ? 'user-deleted'
        : seg.segment_type === 'user-deleted'
        ? 'silence'
        : 'keep';
    await markSegment(seg.id, nextType);
  }

  // ── Segment counts for the legend ─────────────────────────
  const counts = useMemo(
    () => ({
      keep: state.edl.filter((s) => s.segment_type === 'keep').length,
      silence: state.edl.filter((s) => s.segment_type === 'silence').length,
      deleted: state.edl.filter((s) => s.segment_type === 'user-deleted').length,
    }),
    [state.edl]
  );

  return (
    <footer
      className="timeline-panel"
      id="timeline-panel"
      aria-label="Timeline editor"
    >
      {/* Top row: label + legend + time display */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
          }}
        >
          Timeline
        </span>

        {/* Zoom Control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Zoom</span>
          <input
            type="range"
            min="1"
            max="20"
            step="0.5"
            value={zoomLevel}
            onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
            style={{ width: 70, cursor: 'pointer' }}
          />
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <LegendItem color="#2d5a8e" label={`Keep (${counts.keep})`} />
          <LegendItem color="rgba(180,120,20,0.7)" label={`Silence (${counts.silence})`} />
          <LegendItem color="rgba(200,50,50,0.6)" label={`Cut (${counts.deleted})`} dashed />
        </div>

        {/* Current time readout */}
        <span
          style={{
            fontSize: 11,
            color: 'var(--teal-primary)',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 500,
          }}
          aria-live="polite"
        >
          {displayTime.toFixed(3)}s / {duration.toFixed(1)}s
        </span>
      </div>

      <div style={{ overflowX: 'auto', overflowY: 'hidden', paddingBottom: 4, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ width: `${zoomLevel * 100}%`, minWidth: '100%', position: 'relative', flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Ruler */}
          <div className="timeline-ruler" style={{ marginBottom: 4 }}>
            {rulerTicks.map(({ t, pct }) => (
              <React.Fragment key={t}>
                <div
                  className="timeline-ruler__tick"
                  style={{ left: `${pct}%` }}
                  aria-hidden="true"
                />
                <div
                  className="timeline-ruler__label"
                  style={{ left: `${pct}%` }}
                  aria-hidden="true"
                >
                  {formatRulerTime(t)}
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* Tracks */}
          <div className="timeline-tracks">
            {/* Video track */}
            <div className="timeline-track">
              <span className="timeline-track__label" aria-label="Video track" style={{ position: 'sticky', left: 0, zIndex: 10 }}>
                VIDEO
              </span>
              <div
                ref={railRef}
                id="timeline-video-rail"
                className="timeline-track__rail"
                role="slider"
                aria-label="Video timeline"
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(displayTime)}
                onMouseDown={handleRailMouseDown}
                style={{ cursor: 'crosshair', userSelect: 'none' }}
              >
                {/* Segment blocks */}
                {state.edl.map((seg) => {
                  const leftPct = timeToPct(seg.start);
                  const widthPct = timeToPct(seg.end) - leftPct;
                  const widthPx = (widthPct / 100) * (railRef.current?.offsetWidth ?? 800);
                  if (widthPx < MIN_SEGMENT_WIDTH_PX) return null;

                  return (
                    <div
                      key={seg.id}
                      id={`seg-${seg.id}`}
                      className={getSegmentClass(seg.segment_type)}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                      }}
                      title={getSegmentTitle(seg)}
                      role="button"
                      tabIndex={0}
                      aria-label={getSegmentTitle(seg)}
                      onClick={(e) => handleSegmentClick(e, seg)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          handleSegmentClick(e as unknown as React.MouseEvent, seg);
                        }
                      }}
                    />
                  );
                })}

                {/* Playhead */}
                <div
                  className="timeline-playhead"
                  id="timeline-playhead"
                  style={{ left: `${timeToPct(displayTime)}%` }}
                  aria-hidden="true"
                />
              </div>
            </div>

            {/* Audio track (mirrors video EDL for now) */}
            <div className="timeline-track">
              <span className="timeline-track__label" aria-label="Audio track" style={{ position: 'sticky', left: 0, zIndex: 10 }}>
                AUDIO
              </span>
              <div
                id="timeline-audio-rail"
                className="timeline-track__rail"
                style={{ cursor: 'default' }}
                aria-label="Audio timeline (mirrors video)"
              >
                {state.edl.map((seg) => {
                  const leftPct = timeToPct(seg.start);
                  const widthPct = timeToPct(seg.end) - leftPct;
                  return (
                    <div
                      key={seg.id}
                      className={getSegmentClass(seg.segment_type)}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        opacity: 0.6,
                        height: '60%',
                        top: '20%',
                      }}
                      aria-hidden="true"
                    />
                  );
                })}
                <div
                  className="timeline-playhead"
                  style={{ left: `${timeToPct(displayTime)}%`, opacity: 0.5 }}
                  aria-hidden="true"
                />
              </div>
            </div>

            {/* Extra Audio (Music/SFX) track */}
            <div className="timeline-track">
              <span className="timeline-track__label" aria-label="Audio FX track" style={{ position: 'sticky', left: 0, zIndex: 10 }}>
                FX
              </span>
              <div
                id="timeline-audio-fx-rail"
                className="timeline-track__rail"
                style={{ cursor: 'default' }}
                aria-label="Audio FX timeline"
              >
                {state.audioEdl.map((seg) => {
                  const leftPct = timeToPct(seg.start);
                  const widthPct = timeToPct(seg.start + seg.duration) - leftPct;
                  const color = seg.type === 'music' ? '#8b5cf6' : seg.type === 'voice' ? '#ec4899' : '#14b8a6';
                  return (
                    <div
                      key={seg.id}
                      style={{
                        position: 'absolute',
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        background: color,
                        border: '1px solid rgba(0,0,0,0.3)',
                        borderRadius: '3px',
                        height: '80%',
                        top: '10%',
                        opacity: 0.8,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 4px',
                        fontSize: '10px',
                        color: '#fff',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap'
                      }}
                      title="Double-click to delete"
                      onDoubleClick={() => removeAudioSegment(seg.id)}
                    >
                       {seg.type.toUpperCase()}
                    </div>
                  );
                })}
                <div
                  className="timeline-playhead"
                  style={{ left: `${timeToPct(displayTime)}%`, opacity: 0.5 }}
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Empty state hint */}
      {state.edl.length === 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 11,
            color: 'var(--text-subtle)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Load a video to populate the timeline
        </div>
      )}
    </footer>
  );
}

// ─── Legend Item ──────────────────────────────────────────────

function LegendItem({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div
        style={{
          width: 12,
          height: 8,
          borderRadius: 2,
          background: color,
          border: dashed ? '1px dashed rgba(200,50,50,0.6)' : '1px solid transparent',
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );
}
