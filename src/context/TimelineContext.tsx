// CutFlow AI — Timeline Context
// Provides global state for the EDL, playback position,
// and real-time sync from the Tauri IPC bridge.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  useMemo,
} from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { TimelineTrack, BRollTrack, AudioTrack } from '@/lib/types/Track';

// ─────────────────────────────────────────────────────────────
// Data Contracts — mirror the Rust structs exactly
// ─────────────────────────────────────────────────────────────

export type SegmentType = 'keep' | 'silence' | 'user-deleted';
export type TransitionType = 'none' | 'crossfade' | 'dip_black' | 'wipe' | 'flash' | 'zoom';
export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '21:9';

export interface EdlSegment {
  id: string;
  start: number;
  end: number;
  segment_type: SegmentType;
}

export interface AudioSegment {
  id: string;
  path: string;
  start: number;
  duration: number;
  type: 'sfx' | 'music' | 'voice';
}

export interface SpatialProperties {
  scale: number;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
}

export interface BRollSegment {
  id: string;
  path: string;
  name: string;
  start: number;
  duration: number;
  spatial?: SpatialProperties;
}

export interface TimelineState {
  source_video_path: string;
  edl: EdlSegment[];
  tracks: TimelineTrack[];
  transitionType: TransitionType;
  transitionDuration: number;
  current_time: number;
  is_silence_skip_enabled: boolean;
  transcript_json?: any;
  aspectRatio: AspectRatio;
}

// ─────────────────────────────────────────────────────────────
// Reducer Actions
// ─────────────────────────────────────────────────────────────

type Sensitivity = 'minimal' | 'balanced' | 'action' | 'aggressive';

type TimelineAction =
  | { type: 'REPLACE_STATE'; payload: TimelineState }
  | { type: 'SET_CURRENT_TIME'; payload: number }
  | { type: 'SET_SILENCE_SKIP'; payload: boolean }
  | { type: 'SET_SOURCE_VIDEO'; payload: { path: string; duration: number } }
  | { type: 'MARK_SEGMENT'; payload: { id: string; segmentType: SegmentType } }
  | { type: 'SET_TRANSITION'; payload: { type: TransitionType; duration: number } }
  | { type: 'ADD_TRACK'; payload: TimelineTrack }
  | { type: 'REMOVE_TRACK'; payload: string }
  | { type: 'UPDATE_TRACK'; payload: { id: string; partial: Partial<TimelineTrack> } }
  | { type: 'SET_ASPECT_RATIO'; payload: AspectRatio }
  | { type: 'SET_TRANSCRIPT_JSON'; payload: { text: string; start: number; end: number }[] };

const initialState: TimelineState = {
  source_video_path: '',
  edl: [],
  tracks: [],
  transitionType: 'none',
  transitionDuration: 0.3,
  current_time: 0,
  is_silence_skip_enabled: true,
  aspectRatio: '16:9',
};

function timelineReducer(
  state: TimelineState,
  action: TimelineAction
): TimelineState {
  switch (action.type) {
    case 'REPLACE_STATE':
      return { ...action.payload };

    case 'SET_CURRENT_TIME':
      return { ...state, current_time: action.payload };

    case 'SET_SILENCE_SKIP':
      return { ...state, is_silence_skip_enabled: action.payload };

    case 'SET_SOURCE_VIDEO':
      return {
        ...state,
        source_video_path: action.payload.path,
        current_time: 0,
        edl: [
          {
            id: crypto.randomUUID(),
            start: 0,
            end: action.payload.duration,
            segment_type: 'keep',
          },
        ],
      };

    case 'MARK_SEGMENT':
      return {
        ...state,
        edl: state.edl.map((seg) =>
          seg.id === action.payload.id
            ? { ...seg, segment_type: action.payload.segmentType }
            : seg
        ),
      };

    case 'SET_TRANSITION':
      return {
        ...state,
        transitionType: action.payload.type,
        transitionDuration: action.payload.duration,
      };

    case 'ADD_TRACK':
      return { ...state, tracks: [...state.tracks, action.payload] };

    case 'REMOVE_TRACK':
      return {
        ...state,
        tracks: state.tracks.filter((t) => t.id !== action.payload),
      };

    case 'UPDATE_TRACK':
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.payload.id ? { ...t, ...action.payload.partial } as TimelineTrack : t
        ),
      };

    case 'SET_ASPECT_RATIO':
      return { ...state, aspectRatio: action.payload };

    case 'SET_TRANSCRIPT_JSON':
      return { ...state, transcript_json: action.payload };

    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────
// Context Shape
// ─────────────────────────────────────────────────────────────

import { useWhisper, TranscriptWord } from '../hooks/useWhisper';
import type { SubtitlePlacement } from '@/hooks/useFaceDetection';
import type { TranscriptStatus } from '../hooks/useWhisper';

interface TimelineContextValue {
  state: TimelineState;
  dispatch: React.Dispatch<TimelineAction>;
  setCurrentTime: (t: number) => void;
  loadVideo: (path: string, duration: number) => Promise<void>;
  toggleSilenceSkip: () => Promise<void>;
  deleteRange: (start: number, end: number) => Promise<void>;
  markSegment: (id: string, segmentType: SegmentType) => Promise<void>;
  analyzeVideo: (sensitivity: Sensitivity) => Promise<void>;
  isAnalyzing: boolean;
  transcript: TranscriptWord[];
  isTranscribing: boolean;
  splitSegment: (time: number) => Promise<void>;
  splitTrackSegment: (trackId: string, segmentId: string, time: number) => void;
  setTransition: (type: TransitionType, duration: number) => void;
  // Track actions
  addTrack: (track: TimelineTrack) => void;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, partial: Partial<TimelineTrack>) => void;
  // Compatibility wrappers
  bRolls: BRollSegment[];
  audioEdl: AudioSegment[];
  addAudioSegment: (segment: AudioSegment) => void;
  removeAudioSegment: (id: string) => void;
  addBRollSegment: (segment: BRollSegment) => void;
  updateBRollSegment: (id: string, partial: Partial<BRollSegment>) => void;
  removeBRollSegment: (id: string) => void;
  setAspectRatio: (ratio: AspectRatio) => void;
  language: string;
  setLanguage: (lang: string) => void;
  retranscribe: (langOverride?: string) => void;
  transcriptStatus: TranscriptStatus;
  transcriptError: string | null;
  transcriptProgress: number;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saveHistory: () => void;
  // Face-aware subtitle placement (transient UI-only state)
  faceSubtitlePlacement: SubtitlePlacement | null;
  setFaceSubtitlePlacement: (p: SubtitlePlacement | null) => void;
}

const TimelineContext = createContext<TimelineContextValue | null>(null);

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────

export function TimelineProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(timelineReducer, initialState);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { transcript, isTranscribing, transcribeVideo, language, setLanguage,
          transcriptStatus, transcriptError, transcriptProgress } = useWhisper();
  
  // History Stack
  const [past, setPast] = useState<TimelineState[]>([]);
  const [future, setFuture] = useState<TimelineState[]>([]);
  // Face-aware subtitle placement (transient UI-only state)
  const [faceSubtitlePlacement, setFaceSubtitlePlacement] = useState<SubtitlePlacement | null>(null);

  const stateRef = useRef(state);
  
  // Push to history when we make significant changes
  const saveHistory = useCallback(() => {
    setPast((p) => [...p, stateRef.current]);
    setFuture([]);
  }, []);

  // Update stateRef
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // ── Boot: hydrate from backend state on mount ──
  useEffect(() => {
    invoke<TimelineState>('get_timeline_state')
      .then((s) => dispatch({ type: 'REPLACE_STATE', payload: s }))
      .catch(() => {
        // Backend not available in pure web dev mode — use local initial state
      });
  }, []);

  // ── Listen to Tauri IPC events (from Axum server edits or other Tauri commands) ──
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<TimelineState>('timeline-external-update', (event) => {
      dispatch({ type: 'REPLACE_STATE', payload: event.payload });
    })
      .then((fn) => { unlisten = fn; })
      .catch(() => {
        // Not in a Tauri context (e.g., browser dev) — listener is a no-op
      });

    return () => { unlisten?.(); };
  }, []);

  // ── Sync transcript to Axum backend (for MCP access) and into local state ──
  useEffect(() => {
    if (transcript.length === 0) return;
    // Write into the reducer so ExportDialog (and any other consumer) gets
    // real word-level timestamps for SRT generation.
    dispatch({ type: 'SET_TRANSCRIPT_JSON', payload: transcript });
    // Also push to the Axum REST server so the MCP agent can read it.
    fetch('http://127.0.0.1:14220/api/timeline/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    }).catch(() => {
      // Backend not available in dev mode
    });
  }, [transcript]);

  // ── setCurrentTime: local-only, high-frequency update from rAF loop ──
  const setCurrentTime = useCallback((t: number) => {
    dispatch({ type: 'SET_CURRENT_TIME', payload: t });
  }, []);

  // ── loadVideo: calls Rust to set source path and initialize EDL ──
  const loadVideo = useCallback(async (path: string, duration: number) => {
    try {
      const newState = await invoke<TimelineState>('set_source_video', {
        rawPath: path,
        duration,
      });
      dispatch({ type: 'REPLACE_STATE', payload: newState });
    } catch {
      // Fallback: update local state only
      dispatch({
        type: 'SET_SOURCE_VIDEO',
        payload: { path, duration },
      });
    }
    // Kick off background transcription with selected language
    transcribeVideo(path, language || undefined);
  }, [transcribeVideo, language]);

  // ── toggleSilenceSkip: calls Rust command ──
  const toggleSilenceSkip = useCallback(async () => {
    try {
      const newState = await invoke<TimelineState>('toggle_silence_skip');
      dispatch({ type: 'REPLACE_STATE', payload: newState });
    } catch {
      dispatch({
        type: 'SET_SILENCE_SKIP',
        payload: !stateRef.current.is_silence_skip_enabled,
      });
    }
  }, []);

  // ── deleteRange: hits the Axum REST endpoint ──
  const deleteRange = useCallback(async (start: number, end: number) => {
    try {
      await fetch('http://127.0.0.1:14220/api/timeline/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_range', start, end }),
      });
      // Refresh state from backend after edit
      const updated = await fetch('http://127.0.0.1:14220/api/timeline');
      const newState: TimelineState = await updated.json();
      dispatch({ type: 'REPLACE_STATE', payload: newState });
    } catch {
      // Fallback: mark overlapping segments locally
      saveHistory();
      const updated = stateRef.current.edl.map((seg) => {
        const overlaps = seg.start < end && seg.end > start;
        return overlaps ? { ...seg, segment_type: 'user-deleted' as SegmentType } : seg;
      });
      dispatch({
        type: 'REPLACE_STATE',
        payload: { ...stateRef.current, edl: updated },
      });
    }
  }, []);

  // ── markSegment: calls Rust command ──
  const markSegment = useCallback(
    async (id: string, segmentType: SegmentType) => {
      try {
        const newState = await invoke<TimelineState>('update_segment', {
          segmentId: id,
          newType: segmentType,
        });
        dispatch({ type: 'REPLACE_STATE', payload: newState });
      } catch {
        saveHistory();
        dispatch({ type: 'MARK_SEGMENT', payload: { id, segmentType } });
      }
    },
    []
  );

  // ── analyzeVideo: runs auto-editor via Rust backend ──
  const analyzeVideo = useCallback(
    async (sensitivity: Sensitivity) => {
      if (!stateRef.current.source_video_path) return;
      setIsAnalyzing(true);
      try {
        const newState = await invoke<TimelineState>('analyze_video', {
          sensitivity,
        });
        dispatch({ type: 'REPLACE_STATE', payload: newState });
      } catch (err) {
        console.error('Auto-editor analysis failed:', err);
      } finally {
        setIsAnalyzing(false);
      }
    },
    []
  );

  // ── splitSegment: manual splitting of a segment ──
  const splitSegment = useCallback(async (time: number) => {
    // Find the 'keep' segment that contains this time
    const segIndex = stateRef.current.edl.findIndex(
      (s) => s.start < time && s.end > time && s.segment_type === 'keep'
    );
    
    if (segIndex !== -1) {
      const seg = stateRef.current.edl[segIndex];
      try {
        const newState = await invoke<TimelineState>('split_segment', {
          segmentId: seg.id,
          splitTime: time,
        });
        dispatch({ type: 'REPLACE_STATE', payload: newState });
      } catch (e) {
        console.error("Failed to split segment on backend:", e);
        // Fallback: split locally
        const newSegments: EdlSegment[] = [
          { id: crypto.randomUUID(), start: seg.start, end: time, segment_type: 'keep' },
          { id: crypto.randomUUID(), start: time, end: seg.end, segment_type: 'keep' },
        ];
        
        saveHistory();
        const newEdl = [...stateRef.current.edl];
        newEdl.splice(segIndex, 1, ...newSegments);
        dispatch({
          type: 'REPLACE_STATE',
          payload: { ...stateRef.current, edl: newEdl },
        });
      }
    }
  }, []);

  const splitTrackSegment = useCallback((trackId: string, segmentId: string, time: number) => {
    saveHistory();
    const track = stateRef.current.tracks.find(t => t.id === trackId);
    if (!track) return;

    if (track.type === 'b-roll') {
      const bTrack = track as BRollTrack;
      const segIndex = bTrack.segments.findIndex(
        s => s.id === segmentId && s.start < time && (s.start + s.duration) > time
      );
      if (segIndex !== -1) {
        const seg = bTrack.segments[segIndex];
        const duration1 = time - seg.start;
        const duration2 = (seg.start + seg.duration) - time;

        const seg1: BRollSegment = {
          ...seg,
          duration: duration1
        };
        const seg2: BRollSegment = {
          ...seg,
          id: crypto.randomUUID(),
          start: time,
          duration: duration2
        };

        const newSegments = [...bTrack.segments];
        newSegments.splice(segIndex, 1, seg1, seg2);
        dispatch({
          type: 'UPDATE_TRACK',
          payload: { id: trackId, partial: { segments: newSegments } as any }
        });
      }
    } else if (track.type === 'audio') {
      const aTrack = track as AudioTrack;
      const segIndex = aTrack.segments.findIndex(
        s => s.id === segmentId && s.start < time && (s.start + s.duration) > time
      );
      if (segIndex !== -1) {
        const seg = aTrack.segments[segIndex];
        const duration1 = time - seg.start;
        const duration2 = (seg.start + seg.duration) - time;

        const seg1: AudioSegment = {
          ...seg,
          duration: duration1
        };
        const seg2: AudioSegment = {
          ...seg,
          id: crypto.randomUUID(),
          start: time,
          duration: duration2
        };

        const newSegments = [...aTrack.segments];
        newSegments.splice(segIndex, 1, seg1, seg2);
        dispatch({
          type: 'UPDATE_TRACK',
          payload: { id: trackId, partial: { segments: newSegments } as any }
        });
      }
    }
  }, [saveHistory]);

  const setTransition = useCallback((type: TransitionType, duration: number) => {
    saveHistory();
    dispatch({ type: 'SET_TRANSITION', payload: { type, duration } });
  }, [saveHistory]);

  const addTrack = useCallback((track: TimelineTrack) => {
    saveHistory();
    dispatch({ type: 'ADD_TRACK', payload: track });
  }, [saveHistory]);

  const removeTrack = useCallback((id: string) => {
    saveHistory();
    dispatch({ type: 'REMOVE_TRACK', payload: id });
  }, [saveHistory]);

  const updateTrack = useCallback((id: string, partial: Partial<TimelineTrack>) => {
    dispatch({ type: 'UPDATE_TRACK', payload: { id, partial } });
  }, []);

  // Compute backward-compatible arrays
  const bRolls = useMemo(() => {
    const track = state.tracks.find(t => t.type === 'b-roll');
    return track?.type === 'b-roll' ? track.segments : [];
  }, [state.tracks]);

  const audioEdl = useMemo(() => {
    const track = state.tracks.find(t => t.type === 'audio');
    return track?.type === 'audio' ? track.segments : [];
  }, [state.tracks]);

  // Backward compatible actions that modify tracks
  const addAudioSegment = useCallback((segment: AudioSegment) => {
    saveHistory();
    const track = stateRef.current.tracks.find(t => t.type === 'audio');
    if (track && track.type === 'audio') {
      dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, partial: { segments: [...track.segments, segment] } as any } });
    } else {
      dispatch({ type: 'ADD_TRACK', payload: { type: 'audio', id: crypto.randomUUID(), name: 'Audio', isMuted: false, isHidden: false, opacity: 1, order: 2, segments: [segment] } });
    }
  }, [saveHistory]);

  const removeAudioSegment = useCallback((id: string) => {
    saveHistory();
    const track = stateRef.current.tracks.find(t => t.type === 'audio');
    if (track && track.type === 'audio') {
      dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, partial: { segments: track.segments.filter(s => s.id !== id) } as any } });
    }
  }, [saveHistory]);

  const addBRollSegment = useCallback((segment: BRollSegment) => {
    saveHistory();
    const track = stateRef.current.tracks.find(t => t.type === 'b-roll');
    if (track && track.type === 'b-roll') {
      dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, partial: { segments: [...track.segments, segment] } as any } });
    } else {
      dispatch({ type: 'ADD_TRACK', payload: { type: 'b-roll', id: crypto.randomUUID(), name: 'B-Roll', isMuted: false, isHidden: false, opacity: 1, order: 1, segments: [segment] } });
    }
  }, [saveHistory]);

  const updateBRollSegment = useCallback((id: string, partial: Partial<BRollSegment>) => {
    const track = stateRef.current.tracks.find(t => t.type === 'b-roll');
    if (track && track.type === 'b-roll') {
      dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, partial: { segments: track.segments.map(s => s.id === id ? { ...s, ...partial } : s) } as any } });
    }
  }, []);

  const removeBRollSegment = useCallback((id: string) => {
    saveHistory();
    const track = stateRef.current.tracks.find(t => t.type === 'b-roll');
    if (track && track.type === 'b-roll') {
      dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, partial: { segments: track.segments.filter(s => s.id !== id) } as any } });
    }
  }, [saveHistory]);

  const setAspectRatio = useCallback((ratio: AspectRatio) => {
    saveHistory();
    dispatch({ type: 'SET_ASPECT_RATIO', payload: ratio });
  }, [saveHistory]);

  const retranscribe = useCallback((langOverride?: string) => {
    // Always read from stateRef so we get the latest path even if called
    // from an old closure. Language is handled internally by useWhisper's ref,
    // but we can pass an explicit override if we want an immediate re-run.
    const path = stateRef.current.source_video_path;
    if (path) {
      transcribeVideo(path, langOverride !== undefined ? langOverride : (language || undefined));
    }
  }, [transcribeVideo, language]);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([stateRef.current, ...future]);
    dispatch({ type: 'REPLACE_STATE', payload: previous });
  }, [past, future]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast([...past, stateRef.current]);
    dispatch({ type: 'REPLACE_STATE', payload: next });
  }, [past, future]);

  // Global Keyboard Shortcuts for Undo / Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return (
    <TimelineContext.Provider
      value={{
        state,
        dispatch,
        setCurrentTime,
        loadVideo,
        toggleSilenceSkip,
        deleteRange,
        markSegment,
        analyzeVideo,
        isAnalyzing,
        transcript,
        isTranscribing,
        splitSegment,
        splitTrackSegment,
        setTransition,
        addTrack,
        removeTrack,
        updateTrack,
        bRolls,
        audioEdl,
        addAudioSegment,
        removeAudioSegment,
        addBRollSegment,
        updateBRollSegment,
        removeBRollSegment,
        setAspectRatio,
        language,
        setLanguage,
        retranscribe,
        transcriptStatus,
        transcriptError,
        transcriptProgress,
        undo,
        redo,
        canUndo: past.length > 0,
        canRedo: future.length > 0,
        saveHistory,
        faceSubtitlePlacement,
        setFaceSubtitlePlacement,
      }}
    >
      {children}
    </TimelineContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useTimeline(): TimelineContextValue {
  const ctx = useContext(TimelineContext);
  if (!ctx) {
    throw new Error('useTimeline must be used inside <TimelineProvider>');
  }
  return ctx;
}
