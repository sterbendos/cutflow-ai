// CutFlow AI — useFaceDetection Hook
// Periodically samples the current video frame, sends it to the
// faceDetection.worker, and returns a stable 'top' | 'bottom' position
// decision for subtitle placement.
//
// Logic:
//   - Face center Y in top 50% of frame  → subtitles go BOTTOM
//   - Face center Y in bottom 50% of frame → subtitles go TOP
//   - No face detected                    → returns null (caller uses style default)
//
// Position is debounced with a 1-second stability window to prevent
// subtitles from jumping rapidly between positions.

import { useEffect, useRef, useState, useCallback, RefObject } from 'react';

export type SubtitlePlacement = 'top' | 'bottom' | null;

interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

interface UseFaceDetectionOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** How often to run inference in ms. Default 250ms. */
  intervalMs?: number;
  /** Enabled flag — when false, returns null immediately. Default true. */
  enabled?: boolean;
}

export function useFaceDetection({
  videoRef,
  intervalMs = 250,
  enabled = true,
}: UseFaceDetectionOptions): SubtitlePlacement {
  const workerRef = useRef<Worker | null>(null);
  const canvasRef = useRef<OffscreenCanvas | null>(null);
  const ctxRef = useRef<OffscreenCanvasRenderingContext2D | null>(null);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const modelReadyRef = useRef(false);

  // Committed position with 1-second debounce
  const [placement, setPlacement] = useState<SubtitlePlacement>(null);
  const pendingPlacementRef = useRef<SubtitlePlacement>(null);
  const stableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const STABILITY_MS = 1000;

  const commitPlacement = useCallback((next: SubtitlePlacement) => {
    if (next === pendingPlacementRef.current) return;
    pendingPlacementRef.current = next;

    // Clear any previous pending commit
    if (stableTimerRef.current) clearTimeout(stableTimerRef.current);

    stableTimerRef.current = setTimeout(() => {
      setPlacement(next);
    }, STABILITY_MS);
  }, []);

  // Handle messages from the worker
  const handleWorkerMessage = useCallback((e: MessageEvent) => {
    const { type, boxes, message } = e.data as {
      type: string;
      boxes?: FaceBox[];
      message?: string;
    };

    if (type === 'ready') {
      modelReadyRef.current = true;
      return;
    }

    if (type === 'error') {
      console.warn('[FaceDetection] Worker error:', message);
      pendingRef.current = false;
      return;
    }

    if (type === 'result') {
      pendingRef.current = false;

      if (!boxes || boxes.length === 0) {
        // No face detected — let caller fall back
        commitPlacement(null);
        return;
      }

      // Pick the most confident detection
      const best = boxes.reduce((a, b) => (b.confidence > a.confidence ? b : a));

      // Face center Y in normalized coords (0 = top, 1 = bottom)
      const faceCenterY = best.y + best.h / 2;

      // If face is in the top half → put subtitle at bottom, and vice versa
      const next: SubtitlePlacement = faceCenterY < 0.5 ? 'bottom' : 'top';
      commitPlacement(next);
    }
  }, [commitPlacement]);

  // Initialize worker
  useEffect(() => {
    if (!enabled) {
      setPlacement(null);
      return;
    }

    const worker = new Worker(
      new URL('../workers/faceDetection.worker.ts', import.meta.url),
      { type: 'module' }
    );
    worker.addEventListener('message', handleWorkerMessage);
    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
      modelReadyRef.current = false;
    };
  }, [enabled, handleWorkerMessage]);

  // Polling loop — sample video frame and send to worker
  useEffect(() => {
    if (!enabled) return;

    const sample = () => {
      const video = videoRef.current;
      const worker = workerRef.current;

      if (!video || !worker || !modelReadyRef.current || pendingRef.current) return;
      if (video.paused && video.currentTime === 0) return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      // Reuse / resize OffscreenCanvas
      const vw = video.videoWidth;
      const vh = video.videoHeight;

      if (!canvasRef.current || canvasRef.current.width !== vw || canvasRef.current.height !== vh) {
        canvasRef.current = new OffscreenCanvas(vw, vh);
        ctxRef.current = canvasRef.current.getContext('2d') as OffscreenCanvasRenderingContext2D;
      }

      const ctx = ctxRef.current;
      if (!ctx) return;

      try {
        ctx.drawImage(video, 0, 0, vw, vh);
        const imageData = ctx.getImageData(0, 0, vw, vh);
        pendingRef.current = true;
        worker.postMessage({ type: 'detect', imageData }, [imageData.data.buffer]);
      } catch (err) {
        console.error('[FaceDetection] Canvas draw error:', err);
      }
    };

    timerRef.current = setInterval(sample, intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [enabled, intervalMs, videoRef]);

  // Cleanup stability timer on unmount
  useEffect(() => {
    return () => {
      if (stableTimerRef.current) clearTimeout(stableTimerRef.current);
    };
  }, []);

  return enabled ? placement : null;
}
