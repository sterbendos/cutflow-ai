import { expect, test, describe, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { TimelineProvider, useTimeline } from '@/context/TimelineContext';

// Mock all Tauri APIs - return rejected promise by default (graceful fallback in dev mode)
const mockInvoke = vi.fn().mockRejectedValue(new Error('Tauri not available in test'));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

// Mock useWhisper to avoid Worker creation and real audio processing
vi.mock('../hooks/useWhisper', () => ({
  useWhisper: () => ({
    transcript: [],
    isTranscribing: false,
    transcribeVideo: vi.fn(),
    language: '',
    setLanguage: vi.fn(),
  }),
}));

describe('TimelineContext', () => {
  test('should initialize with default state', () => {
    const { result } = renderHook(() => useTimeline(), {
      wrapper: TimelineProvider,
    });

    expect(result.current.state.source_video_path).toBe('');
    expect(result.current.state.edl).toHaveLength(0);
  });

  test('should set source video and create initial segment', async () => {
    const { result } = renderHook(() => useTimeline(), {
      wrapper: TimelineProvider,
    });

    const path = '/mock/path/video.mp4';
    const duration = 120.5;

    await act(async () => {
      await result.current.loadVideo(path, duration);
    });

    expect(result.current.state.source_video_path).toBe(path);
    expect(result.current.state.edl[0].start).toBe(0);
    expect(result.current.state.edl[0].end).toBe(duration);
    expect(result.current.state.edl[0].segment_type).toBe('keep');
  });

  test('should split segment correctly', async () => {
    const { result } = renderHook(() => useTimeline(), {
      wrapper: TimelineProvider,
    });

    // Initialize with a video
    await act(async () => {
      await result.current.loadVideo('/mock/video.mp4', 100);
    });

    const splitTime = 50.0;

    await act(async () => {
      await result.current.splitSegment(splitTime);
    });

    expect(result.current.state.edl).toHaveLength(2);
    expect(result.current.state.edl[0].end).toBe(50);
    expect(result.current.state.edl[1].start).toBe(50);
  });
});
