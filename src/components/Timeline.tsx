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
  const { state, markSegment, splitSegment, removeAudioSegment, transcript, removeBRollSegment, updateBRollSegment } = useTimeline();
  const railRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [draggingBRoll, setDraggingBRoll] = useState<{ id: string, startX: number, startTime: number } | null>(null);
  const [localTime, setLocalTime] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [hideCuts, setHideCuts] = useState(true); // Default to streamlined
  // Track display time in a ref for DOM-only playhead updates (avoids re-renders)
  const displayTimeRef = useRef(0);

  // ── Total duration derived from EDL ────────────────────────
  const activeDuration = useMemo(() => {
    if (state.edl.length === 0) return 60;
    if (hideCuts) {
      return state.edl.filter(s => s.segment_type === 'keep').reduce((acc, s) => acc + (s.end - s.start), 0) || 1;
    }
    return Math.max(...state.edl.map((s) => s.end));
  }, [state.edl, hideCuts]);

  // ── Source <-> Visual Time Mapping ───────────────────────
  const sourceToVisualTime = useCallback((t: number) => {
    if (!hideCuts) return t;
    let visualT = 0;
    for (const seg of state.edl) {
      if (seg.start > t) break;
      if (seg.segment_type === 'keep') {
        if (t <= seg.end) {
          visualT += (t - seg.start);
          break;
        } else {
          visualT += (seg.end - seg.start);
        }
      }
    }
    return visualT;
  }, [state.edl, hideCuts]);

  const visualToSourceTime = useCallback((visualT: number) => {
    if (!hideCuts) return visualT;
    let acc = 0;
    for (const seg of state.edl) {
      if (seg.segment_type === 'keep') {
        const dur = seg.end - seg.start;
        if (acc + dur >= visualT) {
          return seg.start + (visualT - acc);
        }
        acc += dur;
      }
    }
    return state.edl.length > 0 ? state.edl[state.edl.length - 1].end : 0;
  }, [state.edl, hideCuts]);

  // ── Direct DOM playhead sync (no React re-render) ──────────────
  // Writes --playhead-pct CSS var on the panel element so playhead
  // moves without touching the React tree at all during playback.
  const durationRef = useRef(activeDuration);
  durationRef.current = activeDuration;

  useEffect(() => {
    const t = isDraggingPlayhead ? localTime : state.current_time;
    displayTimeRef.current = t;
    const visualT = sourceToVisualTime(t);
    const pct = durationRef.current > 0 ? (visualT / durationRef.current) * 100 : 0;
    const panel = panelRef.current;
    if (panel) {
      panel.style.setProperty('--playhead-pct', `${pct}%`);
      // Update time readout directly
      const readout = panel.querySelector<HTMLSpanElement>('.timeline-time-readout');
      if (readout) {
        readout.textContent = `${t.toFixed(3)}s / ${durationRef.current.toFixed(1)}s`;
      }
    }
  });

  // ── Convert source time → percentage ─────────────────────────────
  const timeToPct = useCallback(
    (t: number) => {
      const visualT = sourceToVisualTime(t);
      return Math.max(0, Math.min(100, (visualT / activeDuration) * 100));
    },
    [activeDuration, sourceToVisualTime]
  );

  // ── Convert rail x-position → source time ───────────────────────
  const xToTime = useCallback(
    (clientX: number): number => {
      const rail = railRef.current;
      if (!rail) return 0;
      const rect = rail.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const visualT = ratio * activeDuration;
      return visualToSourceTime(visualT);
    },
    [activeDuration, visualToSourceTime]
  );

  // ── Ruler ticks ───────────────────────────────────────────
  const rulerTicks = useMemo(() => {
    const ticks = [];
    for (let i = 0; i <= RULER_TICK_COUNT; i++) {
      const visualT = (i / RULER_TICK_COUNT) * activeDuration;
      const sourceT = visualToSourceTime(visualT);
      const pct = (i / RULER_TICK_COUNT) * 100;
      ticks.push({ t: sourceT, pct });
    }
    return ticks;
  }, [activeDuration, visualToSourceTime]);

  // ── Playhead drag ───────────────────────────────────────
  const handleRailMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const t = xToTime(e.clientX);
      setLocalTime(t);
      setIsDraggingPlayhead(true);
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

  // ── B-Roll Dragging ──
  useEffect(() => {
    if (!draggingBRoll || !railRef.current) return;

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - draggingBRoll.startX;
      const railWidth = railRef.current!.offsetWidth;
      const timeDelta = (dx / railWidth) * activeDuration;
      let newTime = draggingBRoll.startTime + timeDelta;
      
      // Clamp to boundaries
      if (newTime < 0) newTime = 0;
      
      updateBRollSegment(draggingBRoll.id, { start: newTime });
    };

    const onMouseUp = () => {
      setDraggingBRoll(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [draggingBRoll, activeDuration, updateBRollSegment]);

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
      ref={panelRef}
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

        {/* View Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={hideCuts} 
              onChange={e => setHideCuts(e.target.checked)} 
              style={{ accentColor: 'var(--teal-primary)' }} 
            />
            Hide Cuts
          </label>
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
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <LegendItem color="#2d5a8e" label={`Keep (${counts.keep})`} />
          <LegendItem color="rgba(180,120,20,0.7)" label={`Silence (${counts.silence})`} />
          <LegendItem color="rgba(200,50,50,0.6)" label={`Cut (${counts.deleted})`} dashed />
        </div>

        {/* Current time readout */}
        <span
          className="timeline-time-readout"
          style={{
            fontSize: 11,
            color: 'var(--teal-primary)',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 500,
          }}
          aria-live="polite"
        >
          {state.current_time.toFixed(3)}s / {activeDuration.toFixed(1)}s
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
          <div className="timeline-tracks" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            
            {/* Subtitle track */}
            <div className="timeline-track" style={{ height: 28, background: 'rgba(0,0,0,0.1)' }}>
              <span className="timeline-track__label" aria-label="Subtitle track" style={{ position: 'sticky', left: 0, zIndex: 10, fontSize: 9 }}>
                SUBTITLES
              </span>
              <div
                className="timeline-track__rail"
                style={{ cursor: 'default' }}
                aria-label="Subtitle timeline"
              >
                {transcript.map((word, idx) => {
                  if (hideCuts) {
                    // Check if the word is in a deleted portion
                    const inKeep = state.edl.some(seg => seg.segment_type === 'keep' && word.start >= seg.start && word.start < seg.end);
                    if (!inKeep) return null;
                  }
                  const leftPct = timeToPct(word.start);
                  const widthPct = timeToPct(word.end) - leftPct;
                  if (widthPct <= 0) return null;
                  
                  return (
                    <div
                      key={`word-${idx}`}
                      style={{
                        position: 'absolute',
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        background: '#eab308',
                        borderRadius: '2px',
                        height: '60%',
                        top: '20%',
                        opacity: 0.8,
                        fontSize: '9px',
                        color: '#000',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        padding: '0 2px'
                      }}
                    >
                      {word.text}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* B-Roll track */}
            <div className="timeline-track" style={{ height: 32, background: 'rgba(0,0,0,0.1)' }}>
              <span className="timeline-track__label" aria-label="B-Roll track" style={{ position: 'sticky', left: 0, zIndex: 10, fontSize: 9 }}>
                B-ROLL
              </span>
              <div
                className="timeline-track__rail"
                style={{ cursor: 'default' }}
                aria-label="B-Roll timeline"
              >
                {state.bRolls.map((seg) => {
                  const leftPct = timeToPct(seg.start);
                  const widthPct = timeToPct(seg.start + seg.duration) - leftPct;
                  return (
                    <div
                      key={seg.id}
                      style={{
                        position: 'absolute',
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        background: '#0ea5e9',
                        border: '1px solid rgba(0,0,0,0.3)',
                        borderRadius: '3px',
                        height: '80%',
                        top: '10%',
                        opacity: 0.9,
                        cursor: draggingBRoll?.id === seg.id ? 'grabbing' : 'grab',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 4px',
                        fontSize: '10px',
                        color: '#fff',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        zIndex: draggingBRoll?.id === seg.id ? 20 : 1
                      }}
                      title="Drag to move, double-click to remove"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setDraggingBRoll({ id: seg.id, startX: e.clientX, startTime: seg.start });
                      }}
                      onDoubleClick={() => removeBRollSegment(seg.id)}
                    >
                       {seg.name}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Video track */}
            <div className="timeline-track" style={{ height: 48 }}>
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
                aria-valuemax={Math.round(activeDuration)}
                aria-valuenow={Math.round(displayTimeRef.current)}
                onMouseDown={handleRailMouseDown}
                style={{ cursor: 'crosshair', userSelect: 'none' }}
              >
                {/* Segment blocks */}
                {state.edl.map((seg) => {
                  if (hideCuts && seg.segment_type !== 'keep') return null;

                  const leftPct = timeToPct(seg.start);
                  const widthPct = timeToPct(seg.end) - leftPct;
                  const widthPx = (widthPct / 100) * (railRef.current?.offsetWidth ?? 800);
                  if (widthPx < MIN_SEGMENT_WIDTH_PX && !hideCuts) return null;

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

                {/* Playhead — positioned by CSS var, updated via DOM (no React re-render) */}
                <div
                  className="timeline-playhead"
                  id="timeline-playhead"
                  style={{ left: 'var(--playhead-pct, 0%)' }}
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
                  if (hideCuts && seg.segment_type !== 'keep') return null;
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
                  style={{ left: 'var(--playhead-pct, 0%)', opacity: 0.5 }}
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
                  style={{ left: 'var(--playhead-pct, 0%)', opacity: 0.5 }}
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
