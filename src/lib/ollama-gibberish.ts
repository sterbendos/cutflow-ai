// CutFlow AI — Ollama Gibberish Subtitle Filter
// Analyzes transcript chunks to detect unexplainable words (e.g. bad Arabic translations)
// and hides the entire sentence if 3+ such words are found.

import { TranscriptWord } from '@/hooks/useWhisper';

const OLLAMA_API = 'http://127.0.0.1:11434/api/generate';

export async function filterGibberishSubtitles(
  words: TranscriptWord[],
  onProgress?: (progress: number) => void
): Promise<TranscriptWord[]> {
  if (words.length === 0) return [];

  const chunkSize = 15;
  const maxChunksPerRequest = 25;
  const filtered: TranscriptWord[] = [];

  const allChunks: TranscriptWord[][] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    allChunks.push(words.slice(i, i + chunkSize));
  }

  let processedChunks = 0;

  for (let batchStart = 0; batchStart < allChunks.length; batchStart += maxChunksPerRequest) {
    const batch = allChunks.slice(batchStart, batchStart + maxChunksPerRequest);
    
    let snippetsText = "";
    batch.forEach((chunk, idx) => {
      snippetsText += `[${idx}] "${chunk.map(w => w.text).join(' ')}"\n`;
    });

    const prompt = `You are a strict linguistic validator.
Analyze the following numbered sentence snippets:
${snippetsText}
For EACH snippet, count how many words are completely gibberish, severely hallucinated, or unexplainable.
Reply ONLY with a valid JSON array of integers representing the count for each snippet in order. 
Example: [0, 1, 0, 3]
Do not output any markdown formatting, backticks, or other text. ONLY the JSON array.`;

    try {
      const res = await fetch(OLLAMA_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gemma4-claude',
          prompt: prompt,
          stream: false,
          options: { temperature: 0.1 }
        })
      });

      if (!res.ok) {
        batch.forEach(chunk => filtered.push(...chunk));
        processedChunks += batch.length;
        if (onProgress) onProgress(Math.min(100, Math.round((processedChunks / allChunks.length) * 100)));
        continue;
      }

      const data = await res.json();
      let responseText = data.response.trim();
      
      if (responseText.startsWith('```json')) {
         responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      } else if (responseText.startsWith('```')) {
         responseText = responseText.replace(/```/g, '').trim();
      }

      let counts: number[];
      try {
        counts = JSON.parse(responseText);
        if (!Array.isArray(counts)) throw new Error("Not an array");
      } catch (e) {
        console.warn('[Ollama] Failed to parse JSON:', responseText);
        batch.forEach(chunk => filtered.push(...chunk));
        processedChunks += batch.length;
        continue;
      }

      batch.forEach((chunk, idx) => {
        const count = typeof counts[idx] === 'number' ? counts[idx] : 0;
        if (count < 3) {
          filtered.push(...chunk);
        } else {
          console.log(`[Ollama] Removed gibberish sentence (${count} bad words): ${chunk.map(w => w.text).join(' ')}`);
        }
      });
      
    } catch (err) {
      console.error('[Ollama] Gibberish batch filter failed:', err);
      batch.forEach(chunk => filtered.push(...chunk));
    }

    processedChunks += batch.length;
    if (onProgress) {
      onProgress(Math.min(100, Math.round((processedChunks / allChunks.length) * 100)));
    }
  }

  return filtered;
}
