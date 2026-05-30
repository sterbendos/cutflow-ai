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
export type TransitionType = 'none' | 'crossfade' | 'dip_black' | 'wipe';
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

export interface TimelineState {
  source_video_path: string;
  edl: EdlSegment[];
  audioEdl: AudioSegment[];
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
  | { type: 'ADD_AUDIO_SEGMENT'; payload: AudioSegment }
  | { type: 'REMOVE_AUDIO_SEGMENT'; payload: string }
  | { type: 'SET_ASPECT_RATIO'; payload: AspectRatio };

const initialState: TimelineState = {
  source_video_path: '',
  edl: [],
  audioEdl: [],
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

    case 'ADD_AUDIO_SEGMENT':
      return { ...state, audioEdl: [...state.audioEdl, action.payload] };

    case 'REMOVE_AUDIO_SEGMENT':
      return {
        ...state,
        audioEdl: state.audioEdl.filter((s) => s.id !== action.payload),
      };

    case 'SET_ASPECT_RATIO':
      return { ...state, aspectRatio: action.payload };

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
  splitSegment: (time: number) => Promise<void>;
  setTransition: (type: TransitionType, duration: number) => void;
  addAudioSegment: (segment: AudioSegment) => void;
  removeAudioSegment: (id: string) => void;
  setAspectRatio: (ratio: AspectRatio) => void;
  language: string;
  setLanguage: (lang: string) => void;
  retranscribe: () => void;
}

const TimelineContext = createContext<TimelineContextValue | null>(null);

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────

export function TimelineProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(timelineReducer, initialState);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { transcript, isTranscribing, transcribeVideo, language, setLanguage } = useWhisper();
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

  // ── Sync transcript to Axum backend (for MCP access) ──
  useEffect(() => {
    if (transcript.length === 0) return;
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
        
        const newEdl = [...stateRef.current.edl];
        newEdl.splice(segIndex, 1, ...newSegments);
        dispatch({
          type: 'REPLACE_STATE',
          payload: { ...stateRef.current, edl: newEdl },
        });
      }
    }
  }, []);

  const setTransition = useCallback((type: TransitionType, duration: number) => {
    dispatch({ type: 'SET_TRANSITION', payload: { type, duration } });
  }, []);

  const addAudioSegment = useCallback((segment: AudioSegment) => {
    dispatch({ type: 'ADD_AUDIO_SEGMENT', payload: segment });
  }, []);

  const removeAudioSegment = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_AUDIO_SEGMENT', payload: id });
  }, []);

  const setAspectRatio = useCallback((ratio: AspectRatio) => {
    dispatch({ type: 'SET_ASPECT_RATIO', payload: ratio });
  }, []);

  const retranscribe = useCallback(() => {
    if (state.source_video_path) {
      transcribeVideo(state.source_video_path, language || undefined);
    }
  }, [state.source_video_path, transcribeVideo, language]);

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
        setTransition,
        addAudioSegment,
        removeAudioSegment,
        setAspectRatio,
        language,
        setLanguage,
        retranscribe,
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
