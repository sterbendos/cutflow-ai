import { useState, useRef, useCallback } from 'react';
import { pipeline, env, AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { invoke } from '@tauri-apps/api/core';

// Ensure transformers.js uses local browser cache and doesn't crash on WASM loading
env.allowLocalModels = false; // We use HuggingFace Hub directly to cache it in browser

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

export function useWhisper() {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptWord[]>([]);
  const transcriberRef = useRef<AutomaticSpeechRecognitionPipeline | null>(null);

  const initTranscriber = async () => {
    if (!transcriberRef.current) {
      transcriberRef.current = await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-tiny.en',
        {
          progress_callback: (progress: any) => {
            console.log('Downloading Whisper model:', progress);
          },
        }
      );
    }
    return transcriberRef.current;
  };

  const transcribeVideo = useCallback(async (videoPath: string) => {
    if (!videoPath) return;
    setIsTranscribing(true);
    setTranscript([]);

    try {
      // 1. Extract audio via Tauri backend (returns absolute path to temp wav)
      const wavPath = await invoke<string>('extract_audio_for_transcription', { videoPath });

      // 2. Fetch the local wav file from Tauri asset protocol
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      const assetUrl = convertFileSrc(wavPath);
      
      const response = await fetch(assetUrl);
      const arrayBuffer = await response.arrayBuffer();
      
      // 3. Decode audio data
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const audioData = audioBuffer.getChannelData(0); // Float32Array

      // 4. Initialize AI
      const transcriber = await initTranscriber();

      // 5. Transcribe
      const output = await transcriber(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: 'word',
      });

      if (output && Array.isArray((output as any).chunks)) {
        const words = (output as any).chunks.map((chunk: any) => ({
          text: chunk.text,
          start: chunk.timestamp[0],
          end: chunk.timestamp[1] || chunk.timestamp[0] + 0.5,
        }));
        setTranscript(words);
      }
    } catch (err) {
      console.error('Transcription failed:', err);
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  return { transcript, isTranscribing, transcribeVideo };
}
