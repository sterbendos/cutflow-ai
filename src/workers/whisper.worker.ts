// CutFlow AI — Whisper Web Worker
// Runs whisper-tiny ONNX inference inside a dedicated worker thread.
// Uses @huggingface/transformers v4 with single-threaded WASM for max compat.

import { pipeline, env } from '@huggingface/transformers';

// ── ONNX / env config ──────────────────────────────────────────────────────
// Must set BEFORE any pipeline() call.
env.allowLocalModels = false;
env.allowRemoteModels = true;

// Force single-threaded WASM for CPU fallback (avoids SharedArrayBuffer atomics issues)
(env as any).backends = (env as any).backends ?? {};
(env as any).backends.onnx = (env as any).backends.onnx ?? {};
(env as any).backends.onnx.wasm = (env as any).backends.onnx.wasm ?? {};
(env as any).backends.onnx.wasm.numThreads = 1;

// Detect WebGPU
const isWebGPUAvailable = !!(navigator as any).gpu;
const DEVICE = isWebGPUAvailable ? 'webgpu' : 'wasm';

// whisper-large-v3-turbo: State-of-the-art accuracy and speed (designed for GPU)
const MODEL_ID = 'onnx-community/whisper-large-v3-turbo';

// ── Singleton pipeline ─────────────────────────────────────────────────────
let transcriber: Awaited<ReturnType<typeof pipeline>> | null = null;

// ── Importance scorer ─────────────────────────────────────────────────────
const STOPWORDS = new Set([
  'the','is','at','which','on','and','a','to','in','that','it','of','for',
  'with','as','are','this','but','not','we','you','i','they','be','have',
  'do','will','an','my','so','if','then','there','was','were','has','had',
]);

function scoreImportance(words: Array<{ text: string; start: number; end: number }>) {
  if (!words.length) return words.map(w => ({ ...w, importance: 0 }));
  const tf = new Map<string, number>();
  words.forEach(w => {
    const clean = w.text.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.length > 2 && !STOPWORDS.has(clean)) {
      tf.set(clean, (tf.get(clean) ?? 0) + 1);
    }
  });
  const maxFreq = Math.max(...Array.from(tf.values()), 1);
  return words.map(w => {
    const clean = w.text.toLowerCase().replace(/[^a-z0-9]/g, '');
    let importance = 0;
    if (clean.length > 2 && !STOPWORDS.has(clean)) {
      importance = (tf.get(clean) ?? 0) / maxFreq;
      if (clean.length > 6) importance = Math.min(1, importance + 0.2);
    }
    return { ...w, importance };
  });
}

// ── Message handler ────────────────────────────────────────────────────────
self.addEventListener('message', async (e: MessageEvent) => {
  const { type, audioData, language, task } = e.data as {
    type: string;
    audioData: Float32Array;
    language?: string;
    task?: string;
  };

  if (type === 'reset') {
    // Force the singleton to reload so next transcribe picks up new language
    transcriber = null;
    return;
  }

  if (type !== 'transcribe') return;

  try {
    // Step 1: load (or reuse) model
    if (!transcriber) {
      const sizeStr = isWebGPUAvailable ? '~800 MB' : '~3.2 GB'; // WebGPU uses q4f16, WASM fallback uses fp32
      self.postMessage({ status: 'loading', message: `Downloading Whisper model (${isWebGPUAvailable ? 'GPU Acceleration Active, ' : 'CPU Fallback, '}${sizeStr})…` });

      transcriber = await pipeline(
        'automatic-speech-recognition',
        MODEL_ID,
        {
          device: DEVICE,
          dtype: isWebGPUAvailable 
             ? { encoder_model: 'fp16', decoder_model_merged: 'q4f16' } // Optimized 4-bit/16-bit for WebGPU VRAM
             : 'fp32', // CPU fallback bypassing QDQ WASM errors
          progress_callback: (p: any) => {
            self.postMessage({ status: 'progress', progress: p });
          },
        } as any
      );
    }

    // Step 2: transcribe
    self.postMessage({ status: 'transcribing', message: 'Running Whisper inference…' });

    const result = await (transcriber as any)(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      language: language || undefined,
      task: task || 'transcribe',
    });

    // Step 3: parse chunks
    const chunks: Array<{ text: string; timestamp: [number, number | null] }> =
      (result as any)?.chunks ?? [];

    if (chunks.length === 0) {
      self.postMessage({ status: 'complete', transcript: [] });
      return;
    }

    const words = chunks.map(c => ({
      text: c.text.trim(),
      start: c.timestamp[0],
      end: c.timestamp[1] ?? c.timestamp[0] + 1.5,
    })).filter(w => w.text.length > 0);

    const scored = scoreImportance(words);
    self.postMessage({ status: 'complete', transcript: scored });

  } catch (err: any) {
    console.error('[whisper-worker] error:', err);
    self.postMessage({
      status: 'error',
      error: err?.message ?? String(err),
    });
    // Reset so next attempt re-downloads the model
    transcriber = null;
  }
});
