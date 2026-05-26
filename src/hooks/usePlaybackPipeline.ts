// CutFlow AI — usePlaybackPipeline
//
// A requestAnimationFrame-driven playback loop that replaces the coarse
// HTML5 `timeupdate` event (which fires only ~4 times/sec) with a
// per-frame polling strategy that tracks currentTime on every monitor
// refresh stroke (~60–144Hz), enabling millisecond-accurate silence
// skipping and UI synchronization.

import { useCallback, useEffect, useRef, useState } from 'react';
import { EdlSegment } from '@/context/TimelineContext';

// ─────────────────────────────────────────────────────────────
// Hook Options
// ─────────────────────────────────────────────────────────────

interface PlaybackPipelineOptions {
  /** The <video> DOM element to control */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Live EDL segments from TimelineContext */
  edl: EdlSegment[];
  /** When true, the loop auto-jumps over silence/user-deleted segments */
  isSilenceSkipEnabled: boolean;
  /** Called on every frame with the new currentTime */
  onTimeUpdate: (time: number) => void;
}

// ─────────────────────────────────────────────────────────────
// Return Value
// ─────────────────────────────────────────────────────────────

interface PlaybackPipelineResult {
  /** Current playback time in seconds (updated every rAF tick) */
  currentTime: number;
  /** The segment the playhead is currently inside, or null */
  activeSegment: EdlSegment | null;
  /** True if the video is currently playing */
  isPlaying: boolean;
  /** Toggle play/pause */
  togglePlay: () => void;
  /** Seek to an absolute time position */
  seekTo: (time: number) => void;
  /** Step back by N seconds */
  stepBack: (seconds?: number) => void;
  /** Step forward by N seconds */
  stepForward: (seconds?: number) => void;
}

// ─────────────────────────────────────────────────────────────
// Helper — find active segment for a given time
// ─────────────────────────────────────────────────────────────

function findActiveSegment(
  time: number,
  edl: EdlSegment[]
): EdlSegment | null {
  for (const seg of edl) {
    if (time >= seg.start && time < seg.end) {
      return seg;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Helper — find the next "keep" segment after a given time
// ─────────────────────────────────────────────────────────────

function findNextKeepSegment(
  afterTime: number,
  edl: EdlSegment[]
): EdlSegment | null {
  const sorted = [...edl].sort((a, b) => a.start - b.start);
  return sorted.find((s) => s.segment_type === 'keep' && s.start > afterTime) ?? null;
}

// ─────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────

export function usePlaybackPipeline({
  videoRef,
  edl,
  isSilenceSkipEnabled,
  onTimeUpdate,
}: PlaybackPipelineOptions): PlaybackPipelineResult {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSegment, setActiveSegment] = useState<EdlSegment | null>(null);

  // Refs to avoid stale closure issues inside the rAF loop
  const rafIdRef = useRef<number | null>(null);
  const edlRef = useRef(edl);
  const silenceSkipRef = useRef(isSilenceSkipEnabled);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const lastJumpRef = useRef<number>(-1); // Debounce repeated jumps

  // Keep refs in sync with the latest props without restarting the loop
  edlRef.current = edl;
  silenceSkipRef.current = isSilenceSkipEnabled;
  onTimeUpdateRef.current = onTimeUpdate;

  // ── Core rAF Loop ──────────────────────────────────────────
  const tick = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      rafIdRef.current = requestAnimationFrame(tick);
      return;
    }

    const t = video.currentTime;

    // Update React state + parent callback
    setCurrentTime(t);
    onTimeUpdateRef.current(t);

    // Find which segment the playhead is in
    const seg = findActiveSegment(t, edlRef.current);
    setActiveSegment(seg);

    // ── Silence Skip Logic ─────────────────────────────────
    if (
      silenceSkipRef.current &&
      seg &&
      (seg.segment_type === 'silence' || seg.segment_type === 'user-deleted')
    ) {
      // Debounce: only jump if we haven't jumped to this segment's end recently
      if (lastJumpRef.current !== seg.end) {
        lastJumpRef.current = seg.end;
        // Jump to segment end — if there's a keep segment after, land at its start
        const nextKeep = findNextKeepSegment(seg.start, edlRef.current);
        const jumpTarget = nextKeep ? nextKeep.start : seg.end;
        video.currentTime = jumpTarget;
      }
    } else {
      // Reset debounce when we're in a valid segment
      if (seg && seg.segment_type === 'keep') {
        lastJumpRef.current = -1;
      }
    }

    rafIdRef.current = requestAnimationFrame(tick);
  }, [videoRef]);

  // ── Start / stop the loop based on video play state ────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      setIsPlaying(true);
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(tick);
      }
    };

    const onPause = () => {
      setIsPlaying(false);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      // Final sync on pause
      setCurrentTime(video.currentTime);
      onTimeUpdateRef.current(video.currentTime);
    };

    const onEnded = () => {
      setIsPlaying(false);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [tick, videoRef]);

  // ── Controls ───────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [videoRef]);

  const seekTo = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      const clamped = Math.max(0, Math.min(time, video.duration || 0));
      video.currentTime = clamped;
      setCurrentTime(clamped);
      onTimeUpdateRef.current(clamped);
      lastJumpRef.current = -1;
    },
    [videoRef]
  );

  const stepBack = useCallback(
    (seconds = 5) => {
      const video = videoRef.current;
      if (!video) return;
      seekTo(video.currentTime - seconds);
    },
    [videoRef, seekTo]
  );

  const stepForward = useCallback(
    (seconds = 5) => {
      const video = videoRef.current;
      if (!video) return;
      seekTo(video.currentTime + seconds);
    },
    [videoRef, seekTo]
  );

  return {
    currentTime,
    activeSegment,
    isPlaying,
    togglePlay,
    seekTo,
    stepBack,
    stepForward,
  };
}
