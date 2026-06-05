// CutFlow AI — useWhisper hook
// Manages the full transcription pipeline:
//   1. Rust/FFmpeg extracts 16 kHz mono WAV
//   2. Web Audio API decodes the WAV to Float32Array
//   3. Whisper Web Worker runs ONNX inference
// All errors surface as `transcriptError` so the UI can show them.

import { useState, useRef, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { filterGibberishSubtitles } from '../lib/ollama-gibberish';

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  importance?: number;
}

export type TranscriptStatus =
  | 'idle'
  | 'extracting'
  | 'decoding'
  | 'loading'
  | 'transcribing'
  | 'complete'
  | 'error';

export function useWhisper() {
  const [transcript, setTranscript]           = useState<TranscriptWord[]>([]);
  const [isTranscribing, setIsTranscribing]   = useState(false);
  const [transcriptStatus, setTranscriptStatus] = useState<TranscriptStatus>('idle');
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [transcriptProgress, setTranscriptProgress] = useState<number>(0);
  const [language, setLanguage]               = useState<string>('');

  const workerRef = useRef<Worker | null>(null);
  // Keep a ref so the worker postMessage always sees the current language
  // even when called from inside a stale closure.
  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  // Lazily create the worker exactly once
  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../workers/whisper.worker.ts', import.meta.url),
        { type: 'module' }
      );
    }
    return workerRef.current;
  }, []);

  // Reset the whisper singleton whenever language changes so the
  // model is re-run with the new language on next transcription.
  useEffect(() => {
    const worker = workerRef.current;
    if (worker) {
      worker.postMessage({ type: 'reset' });
    }
  }, [language]);

  // Terminate worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const transcribeVideo = useCallback(async (videoPath: string, lang?: string) => {
    if (!videoPath) return;

    setIsTranscribing(true);
    setTranscript([]);
    setTranscriptError(null);
    setTranscriptProgress(0);

    try {
      // ── Step 1: Extract audio via FFmpeg (Rust command) ──────────────
      setTranscriptStatus('extracting');
      console.log('[whisper] extracting audio from:', videoPath);

      let wavPath: string;
      try {
        wavPath = await invoke<string>('extract_audio_for_transcription', {
          videoPath,
        });
      } catch (err: any) {
        throw new Error(`Audio extraction failed: ${err?.message ?? String(err)}`);
      }

      console.log('[whisper] WAV written to:', wavPath);

      // ── Step 2: Fetch & decode WAV ───────────────────────────────────
      setTranscriptStatus('decoding');

      // Normalize Windows path separators for the asset:// protocol
      const normalizedWav = wavPath.replace(/\\/g, '/');
      const assetUrl = convertFileSrc(normalizedWav);
      console.log('[whisper] fetching asset:', assetUrl);

      const response = await fetch(assetUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch WAV (${response.status}): ${assetUrl}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      console.log('[whisper] WAV size:', arrayBuffer.byteLength, 'bytes');

      // Decode at 16 000 Hz (mono) — exact format Whisper expects
      const audioCtx = new AudioContext({ sampleRate: 16_000 });
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const audioData = audioBuffer.getChannelData(0); // Float32Array, channel 0
      await audioCtx.close();

      console.log('[whisper] audio decoded, samples:', audioData.length);

      // ── Step 3: Run Whisper in worker ────────────────────────────────
      setTranscriptStatus('loading');

      const worker = getWorker();

      await new Promise<void>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent) => {
          const msg = event.data as {
            status: string;
            transcript?: TranscriptWord[];
            error?: string;
            progress?: any;
            message?: string;
          };

          console.log('[whisper] worker →', msg.status, msg.message ?? '');

          switch (msg.status) {
            case 'loading':
              setTranscriptStatus('loading');
              break;

            case 'progress':
              if (typeof msg.progress?.progress === 'number') {
                setTranscriptProgress(Math.round(msg.progress.progress * 100));
              }
              break;

            case 'transcribing':
              setTranscriptStatus('transcribing');
              break;

            case 'complete': {
              const rawWords = msg.transcript ?? [];
              if (rawWords.length === 0) {
                setTranscript([]);
                setTranscriptStatus('complete');
                resolve();
                break;
              }
              setTranscriptStatus('transcribing'); // keep transcribing status while filtering
              
              filterGibberishSubtitles(rawWords, (p) => setTranscriptProgress(p)).then(cleanedWords => {
                // Flatten phrases into individual words with linearly interpolated timestamps
                const allWords: TranscriptWord[] = [];
                for (const phrase of cleanedWords) {
                  const subwords = phrase.text.trim().split(/\s+/).filter(w => w.length > 0);
                  if (subwords.length === 0) continue;
                  
                  const duration = phrase.end - phrase.start;
                  const wordDuration = duration / subwords.length;
                  
                  subwords.forEach((w, idx) => {
                    allWords.push({
                      text: w,
                      start: phrase.start + idx * wordDuration,
                      end: phrase.start + (idx + 1) * wordDuration,
                      importance: phrase.importance
                    });
                  });
                }

                const chunks: TranscriptWord[] = [];
                for (let i = 0; i < allWords.length; i += 5) {
                  const chunk = allWords.slice(i, i + 5);
                  if (chunk.length === 0) continue;

                  let subChunk = [chunk[0]];
                  for (let j = 1; j < chunk.length; j++) {
                    if (chunk[j].start - chunk[j-1].end > 1.5) {
                      break;
                    }
                    subChunk.push(chunk[j]);
                  }
                  if (subChunk.length < chunk.length) {
                    i -= (chunk.length - subChunk.length);
                  }

                  const start = subChunk[0].start;
                  const end = subChunk[subChunk.length - 1].end;
                  const text = subChunk.map(c => c.text).join(' ');
                  const importance = Math.max(...subChunk.map(c => c.importance ?? 0));
                  
                  chunks.push({ text, start, end, importance });
                }
                setTranscript(chunks);
                setTranscriptStatus('complete');
                resolve();
              });
              break;
            }

            case 'error':
              reject(new Error(msg.error ?? 'Unknown worker error'));
              break;
          }
        };

        worker.onerror = (err) => {
          console.error('[whisper] worker onerror:', err);
          reject(new Error(`Worker crashed: ${err.message}`));
        };

        // Always read from ref to avoid stale closure — languageRef.current
        // reflects whatever was selected in the dropdown at call time.
        worker.postMessage({ type: 'transcribe', audioData, language: lang || languageRef.current || undefined, task: 'transcribe' });
      });

    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.error('[whisper] pipeline error:', message);
      setTranscriptError(message);
      setTranscriptStatus('error');
    } finally {
      setIsTranscribing(false);
    }
  }, [getWorker]);

  return {
    transcript,
    isTranscribing,
    transcriptStatus,
    transcriptError,
    transcriptProgress,
    transcribeVideo,
    language,
    setLanguage,
  };
}
