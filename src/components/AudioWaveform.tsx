import { useEffect, useRef, useState } from 'react';
import { getAudioPeaks } from '@/lib/audio/waveformCache';

interface AudioWaveformProps {
  filePath: string;
  start: number; // Start time of this segment in the source file
  duration: number; // Duration of this segment
  color?: string; // Waveform color
}

export default function AudioWaveform({ filePath, start, duration, color = '#14b8a6' }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);

  useEffect(() => {
    let mounted = true;
    if (filePath) {
      getAudioPeaks(filePath).then((p) => {
        if (mounted) setPeaks(p);
      }).catch(console.error);
    }
    return () => { mounted = false; };
  }, [filePath]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;

    // We use a ResizeObserver or just responsive drawing, 
    // but since timeline blocks resize dynamically, let's draw on a fixed canvas
    // and let CSS stretch it width-wise (100%), which looks fine for waveforms.
    // Actually, drawing perfectly crisp to the pixel width is better, but this is a start.
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const SAMPLES_PER_SEC = 100;
    const startIndex = Math.floor(start * SAMPLES_PER_SEC);
    const endIndex = Math.floor((start + duration) * SAMPLES_PER_SEC);
    
    // Slice the peaks for this specific segment
    const segmentPeaks = peaks.subarray(startIndex, endIndex);
    if (segmentPeaks.length === 0) return;

    // Draw
    ctx.fillStyle = color;
    const step = width / segmentPeaks.length;
    
    // Smooth out drawing
    ctx.beginPath();
    for (let i = 0; i < segmentPeaks.length; i++) {
      const p = segmentPeaks[i];
      // Normalize to height
      const h = Math.max(1, p * height);
      const x = i * step;
      const y = (height - h) / 2;
      
      ctx.roundRect(x, y, Math.max(1, step - 0.5), h, 2);
    }
    ctx.fill();

  }, [peaks, start, duration, color]);

  return (
    <canvas
      ref={canvasRef}
      width={1000} // High-res internal width, stretched via CSS
      height={40}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        pointerEvents: 'none',
        opacity: 0.6,
      }}
    />
  );
}
