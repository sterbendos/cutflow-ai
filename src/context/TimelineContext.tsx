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
} from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

// ─────────────────────────────────────────────────────────────
// Data Contracts — mirror the Rust structs exactly
// ─────────────────────────────────────────────────────────────

export type SegmentType = 'keep' | 'silence' | 'user-deleted';

export interface EdlSegment {
  id: string;
  start: number;
  end: number;
  segment_type: SegmentType;
}

export interface TimelineState {
  source_video_path: string;
  edl: EdlSegment[];
  current_time: number;
  is_silence_skip_enabled: boolean;
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
  | { type: 'MARK_SEGMENT'; payload: { id: string; segmentType: SegmentType } };

const initialState: TimelineState = {
  source_video_path: '',
  edl: [],
  current_time: 0,
  is_silence_skip_enabled: true,
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

    default:
      return state;
  }
}

// ─────────────────────────────────────────────────────────────
// Context Shape
// ─────────────────────────────────────────────────────────────

import { useWhisper, TranscriptWord } from '../hooks/useWhisper';

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
}

const TimelineContext = createContext<TimelineContextValue | null>(null);

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────

export function TimelineProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(timelineReducer, initialState);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { transcript, isTranscribing, transcribeVideo } = useWhisper();
  const stateRef = useRef(state);
  stateRef.current = state;

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
    // Kick off background transcription
    transcribeVideo(path);
  }, [transcribeVideo]);

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
