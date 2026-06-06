// CutFlow AI — Audio Waveform Cache
// Decodes audio files once, generates peak data, and caches it in memory.
// Prevents decoding the same large video file 50 times for 50 different segments.

import { convertFileSrc } from '@tauri-apps/api/core';

const peakCache = new Map<string, Promise<Float32Array>>();
const SAMPLES_PER_SEC = 100; // Resolution of the waveform

export async function getAudioPeaks(filePath: string): Promise<Float32Array> {
  if (peakCache.has(filePath)) {
    return peakCache.get(filePath)!;
  }

  const promise = (async () => {
    const url = filePath.startsWith('http') ? filePath : convertFileSrc(filePath);
    
    // Fetch the audio file
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    
    // Decode audio data
    // Use an OfflineAudioContext to decode without playing
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    // Generate peaks
    const channelData = audioBuffer.getChannelData(0); // Use first channel
    const sampleRate = audioBuffer.sampleRate;
    const samplesPerPixel = Math.floor(sampleRate / SAMPLES_PER_SEC);
    const numPeaks = Math.floor(channelData.length / samplesPerPixel);
    
    const peaks = new Float32Array(numPeaks);
    
    for (let i = 0; i < numPeaks; i++) {
      const start = i * samplesPerPixel;
      let max = 0;
      for (let j = 0; j < samplesPerPixel; j++) {
        const val = Math.abs(channelData[start + j]);
        if (val > max) max = val;
      }
      peaks[i] = max;
    }
    
    return peaks;
  })();

  peakCache.set(filePath, promise);
  
  try {
    return await promise;
  } catch (err) {
    peakCache.delete(filePath);
    throw err;
  }
}
