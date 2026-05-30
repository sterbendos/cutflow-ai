import { useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  importance?: number;
}

export function useWhisper() {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptWord[]>([]);
  const [language, setLanguage] = useState<string>('');
  const workerRef = useRef<Worker | null>(null);

  const transcribeVideo = useCallback(async (videoPath: string, language?: string) => {
    if (!videoPath) return;
    setIsTranscribing(true);
    setTranscript([]);

    try {
      // 1. Extract audio via Tauri backend
      const wavPath = await invoke<string>('extract_audio_for_transcription', { videoPath });

      // 2. Fetch the local wav file
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      const assetUrl = convertFileSrc(wavPath);
      
      const response = await fetch(assetUrl);
      const arrayBuffer = await response.arrayBuffer();
      
      // 3. Decode audio data
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const audioData = audioBuffer.getChannelData(0); // Float32Array

      // 4. Initialize Worker if not already
      if (!workerRef.current) {
        workerRef.current = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), {
          type: 'module'
        });
      }

      // 5. Send message and wait for completion
      workerRef.current.onmessage = (e) => {
        const { status, transcript, error } = e.data;
        if (status === 'complete') {
          setTranscript(transcript);
          setIsTranscribing(false);
        } else if (status === 'error') {
          console.error('Whisper Worker Error:', error);
          setIsTranscribing(false);
        }
      };

      workerRef.current.postMessage({ type: 'transcribe', audioData, language });

    } catch (err) {
      console.error('Transcription failed:', err);
      setIsTranscribing(false);
    }
  }, []);

  return { transcript, isTranscribing, transcribeVideo, language, setLanguage };
}
