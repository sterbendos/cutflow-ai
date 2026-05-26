// CutFlow AI — VideoPlayer Component
// Flex-1 black viewport with rAF-driven playback pipeline,
// floating status capsule, and bottom playback controls.

import { useCallback, useEffect, useRef } from 'react';
import { useTimeline } from '@/context/TimelineContext';
import { usePlaybackPipeline } from '@/hooks/usePlaybackPipeline';

// ─── Icon helpers ─────────────────────────────────────────────

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function StepBackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="19 20 9 12 19 4 19 20" />
      <line x1="5" y1="19" x2="5" y2="5" />
    </svg>
  );
}

function StepForwardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 4 15 12 5 20 5 4" />
      <line x1="19" y1="5" x2="19" y2="19" />
    </svg>
  );
}

function VolumeMidIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function SkipIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ color: active ? 'var(--teal-primary)' : undefined }}>
      <polygon points="5 4 15 12 5 20 5 4" />
      <polygon points="13 4 23 12 13 20 13 4" />
      <line x1="1" y1="4" x2="1" y2="20" />
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function formatTime(secs: number): string {
  if (!isFinite(secs)) return '0:00.000';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  const ms = Math.floor((secs % 1) * 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

// ─────────────────────────────────────────────────────────────

export default function VideoPlayer() {
  const { state, setCurrentTime, toggleSilenceSkip } = useTimeline();
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoUrlRef = useRef<string | null>(null);

  const {
    currentTime,
    activeSegment,
    isPlaying,
    togglePlay,
    seekTo,
    stepBack,
    stepForward,
  } = usePlaybackPipeline({
    videoRef,
    edl: state.edl,
    isSilenceSkipEnabled: state.is_silence_skip_enabled,
    onTimeUpdate: setCurrentTime,
  });

  // ── Load video source when path changes ───────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !state.source_video_path) return;

    // Revoke previous object URL if any
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
    }

    // Use Tauri's asset protocol to load a local file
    const normalizedPath = state.source_video_path.replace(/\\/g, '/');
    // Tauri v2 asset protocol: https://asset.localhost/<path>
    video.src = `https://asset.localhost/${normalizedPath}`;
    video.load();
    video.currentTime = 0;
  }, [state.source_video_path]);

  // ── Keyboard shortcuts ────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Only capture when focus is not in an input
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      )
        return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          stepBack(e.shiftKey ? 1 : 5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          stepForward(e.shiftKey ? 1 : 5);
          break;
        case 'j':
          stepBack(10);
          break;
        case 'l':
          stepForward(10);
          break;
        case 'k':
          togglePlay();
          break;
      }
    },
    [togglePlay, stepBack, stepForward]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Derive status capsule label ───────────────────────────
  const capsuleLabel = () => {
    if (!state.source_video_path) return 'No media loaded';
    if (!state.is_silence_skip_enabled) return 'Silence skip: OFF';
    if (activeSegment?.segment_type === 'silence') return 'Skipping silence…';
    if (activeSegment?.segment_type === 'user-deleted') return 'Skipping cut…';
    return 'Silence skip: ON';
  };

  const capsuleActive =
    state.is_silence_skip_enabled && Boolean(state.source_video_path);

  // ── Video duration for progress bar ──────────────────────
  const duration = videoRef.current?.duration ?? 0;
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <section
      className="video-stage"
      id="video-stage"
      aria-label="Video player"
    >
      {/* Empty state */}
      {!state.source_video_path && (
        <div className="video-stage__empty animate-fade-in">
          <svg
            className="video-stage__empty-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="2" width="20" height="20" rx="2.18" />
            <line x1="7" y1="2" x2="7" y2="22" />
            <line x1="17" y1="2" x2="17" y2="22" />
            <line x1="2" y1="12" x2="22" y2="12" />
          </svg>
          <p className="video-stage__empty-text">
            Drop a video in the sidebar to get started
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
            Space · J/K/L · ← →
          </p>
        </div>
      )}

      {/* Video element */}
      <video
        ref={videoRef}
        id="main-video"
        playsInline
        preload="metadata"
        aria-label="Video preview"
        style={{
          display: state.source_video_path ? 'block' : 'none',
          maxHeight: 'calc(100% - 80px)',
          width: 'auto',
          maxWidth: '100%',
        }}
        onClick={togglePlay}
      />

      {/* Status Capsule — top right */}
      <div
        className="status-capsule"
        id="status-capsule"
        aria-live="polite"
        aria-label={capsuleLabel()}
      >
        <span
          className={`status-capsule__dot${capsuleActive ? '' : ' inactive'}`}
          aria-hidden="true"
        />
        {capsuleLabel()}
      </div>

      {/* Progress bar */}
      {state.source_video_path && (
        <div
          id="progress-bar-container"
          style={{
            position: 'absolute',
            bottom: 68,
            left: 12,
            right: 12,
            height: 3,
            background: 'rgba(255,255,255,0.08)',
            borderRadius: 2,
            cursor: 'pointer',
          }}
          role="slider"
          aria-label="Video progress"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            seekTo(ratio * duration);
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progressPct}%`,
              background: 'linear-gradient(90deg, var(--teal-primary), var(--teal-light))',
              borderRadius: 2,
              transition: 'width 0.05s linear',
            }}
          />
        </div>
      )}

      {/* Playback Controls — bottom center */}
      {state.source_video_path && (
        <div className="playback-controls" id="playback-controls">
          <button
            id="btn-step-back"
            className="playback-btn"
            onClick={() => stepBack(5)}
            title="Step back 5s (←)"
            aria-label="Step back 5 seconds"
          >
            <StepBackIcon />
          </button>

          <button
            id="btn-play-pause"
            className="playback-btn primary"
            onClick={togglePlay}
            title="Play / Pause (Space)"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>

          <button
            id="btn-step-forward"
            className="playback-btn"
            onClick={() => stepForward(5)}
            title="Step forward 5s (→)"
            aria-label="Step forward 5 seconds"
          >
            <StepForwardIcon />
          </button>

          <span
            className="playback-time"
            aria-label={`Current time: ${formatTime(currentTime)}`}
          >
            {formatTime(currentTime)}
            <span style={{ color: 'var(--text-subtle)' }}>
              {' '}/ {formatTime(duration)}
            </span>
          </span>

          {/* Volume — static for now, placeholder for future */}
          <button
            id="btn-volume"
            className="playback-btn"
            title="Volume"
            aria-label="Volume"
            onClick={() => {
              if (videoRef.current) {
                videoRef.current.muted = !videoRef.current.muted;
              }
            }}
          >
            <VolumeMidIcon />
          </button>

          {/* Silence skip toggle */}
          <button
            id="btn-silence-skip"
            className="playback-btn"
            onClick={toggleSilenceSkip}
            title={`Silence skip: ${state.is_silence_skip_enabled ? 'ON' : 'OFF'}`}
            aria-label={`Toggle silence skip (currently ${state.is_silence_skip_enabled ? 'on' : 'off'})`}
            style={{
              color: state.is_silence_skip_enabled
                ? 'var(--teal-primary)'
                : 'var(--text-muted)',
            }}
          >
            <SkipIcon active={state.is_silence_skip_enabled} />
          </button>
        </div>
      )}
    </section>
  );
}
