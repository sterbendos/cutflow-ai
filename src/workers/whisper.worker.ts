import { pipeline, env, AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

// Ensure transformers.js uses local browser cache
env.allowLocalModels = false;

// We use Xenova/whisper-large-v3-turbo to get the performance of large without instantly crashing WebAssembly memory limit
const MODEL_ID = 'onnx-community/whisper-large-v3-turbo';

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;

const STOPWORDS = new Set(['the', 'is', 'at', 'which', 'on', 'and', 'a', 'to', 'in', 'that', 'it', 'of', 'for', 'with', 'as', 'are', 'this', 'but', 'not', 'we', 'you', 'i', 'they', 'be', 'have', 'do', 'will', 'an', 'my']);

function scoreImportance(words: any[]): any[] {
  if (words.length === 0) return words;
  
  const tf = new Map<string, number>();
  words.forEach(w => {
    const cleanWord = w.text.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanWord.length > 2 && !STOPWORDS.has(cleanWord)) {
      tf.set(cleanWord, (tf.get(cleanWord) || 0) + 1);
    }
  });

  const maxFreq = Math.max(...Array.from(tf.values()), 1);
  
  return words.map(w => {
    const cleanWord = w.text.toLowerCase().replace(/[^a-z0-9]/g, '');
    let importance = 0;
    if (cleanWord.length > 2 && !STOPWORDS.has(cleanWord)) {
       importance = (tf.get(cleanWord) || 0) / maxFreq;
       importance = Math.min(1.0, importance + (cleanWord.length > 6 ? 0.2 : 0));
    }
    return { ...w, importance };
  });
}

self.addEventListener('message', async (e) => {
  const { type, audioData, language } = e.data;

  if (type === 'transcribe') {
    try {
      if (!transcriber) {
        self.postMessage({ status: 'loading', message: 'Loading model...' });
        transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
          progress_callback: (progress: any) => {
            self.postMessage({ status: 'progress', progress });
          },
        });
      }

      self.postMessage({ status: 'transcribing', message: 'Transcribing audio...', language });

      // Using return_timestamps: true gives phrase-level timestamps reliably.
      const output = await transcriber(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
        language: language || undefined,
      });

      if (output && Array.isArray((output as any).chunks)) {
        let words = (output as any).chunks.map((chunk: any) => ({
          text: chunk.text,
          start: chunk.timestamp[0],
          end: chunk.timestamp[1] || chunk.timestamp[0] + 2.0,
        }));
        
        words = scoreImportance(words);
        self.postMessage({ status: 'complete', transcript: words });
      } else {
        self.postMessage({ status: 'complete', transcript: [] });
      }
    } catch (error: any) {
      console.error(error);
      self.postMessage({ status: 'error', error: error.message });
    }
  }
});
