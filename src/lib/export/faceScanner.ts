import { convertFileSrc } from '@tauri-apps/api/core';
import type { SubtitleWord } from './subtitles';
import type { SubtitlePlacement } from '@/hooks/useFaceDetection';

interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

export type FacePlacements = Map<number, SubtitlePlacement>;

export async function scanFacesForExport(
  videoPath: string,
  words: SubtitleWord[],
  onProgress?: (progress: number) => void
): Promise<FacePlacements> {
  const placements: FacePlacements = new Map();
  if (words.length === 0 || !videoPath) return placements;

  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('../../workers/faceDetection.worker.ts', import.meta.url),
      { type: 'module' }
    );

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.muted = true;
    
    let canvas: OffscreenCanvas | null = null;
    let ctx: OffscreenCanvasRenderingContext2D | null = null;

    let workerReady = false;
    let currentWordIndex = 0;
    
    // Worker message handler
    const handleWorkerMessage = (e: MessageEvent) => {
      const { type, boxes, message } = e.data;
      
      if (type === 'error') {
        cleanup();
        reject(new Error(`Face detection worker error: ${message}`));
        return;
      }

      if (type === 'ready') {
        workerReady = true;
        // Start scanning once worker and video are both ready
        if (video.readyState >= 2) processNextFrame();
        return;
      }

      if (type === 'result') {
        let placement: SubtitlePlacement = null; // Default

        if (boxes && boxes.length > 0) {
          const best = (boxes as FaceBox[]).reduce((a, b) => (b.confidence > a.confidence ? b : a));
          const faceCenterY = best.y + best.h / 2;
          placement = faceCenterY < 0.5 ? 'bottom' : 'top';
        }

        placements.set(currentWordIndex, placement);
        currentWordIndex++;

        if (onProgress) {
          onProgress((currentWordIndex / words.length) * 100);
        }

        processNextFrame();
      }
    };

    worker.addEventListener('message', handleWorkerMessage);

    const cleanup = () => {
      worker.terminate();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };

    const processNextFrame = () => {
      if (currentWordIndex >= words.length) {
        cleanup();
        resolve(placements);
        return;
      }

      const word = words[currentWordIndex];
      const midpoint = (word.start + word.end) / 2;
      
      // If we are already near the midpoint (e.g. within 0.1s), don't seek again
      if (Math.abs(video.currentTime - midpoint) < 0.1) {
        extractAndSendFrame();
      } else {
        // Wait for seeked event before extracting
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          extractAndSendFrame();
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = midpoint;
      }
    };

    const extractAndSendFrame = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;

      if (!canvas || canvas.width !== vw || canvas.height !== vh) {
        canvas = new OffscreenCanvas(vw, vh);
        ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
      }

      if (!ctx) {
        cleanup();
        reject(new Error('Failed to get 2D context for offscreen canvas'));
        return;
      }

      try {
        ctx.drawImage(video, 0, 0, vw, vh);
        const imageData = ctx.getImageData(0, 0, vw, vh);
        worker.postMessage({ type: 'detect', imageData }, [imageData.data.buffer]);
      } catch (err) {
        console.error('[FaceScanner] Frame grab error:', err);
        // Fallback to null placement and continue
        placements.set(currentWordIndex, null);
        currentWordIndex++;
        processNextFrame();
      }
    };

    video.addEventListener('loadedmetadata', () => {
      if (workerReady) {
        processNextFrame();
      }
    });

    video.addEventListener('error', () => {
      cleanup();
      reject(new Error('Failed to load video for face scanning'));
    });

    // Start loading video
    video.src = convertFileSrc(videoPath);
  });
}
