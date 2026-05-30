// CutFlow AI — Aspect Ratio Selector
// Dropdown to switch between 16:9, 9:16, 1:1, 4:3, 21:9

import { useTimeline } from '@/context/TimelineContext';
import type { AspectRatio } from '@/context/TimelineContext';

const RATIOS: { id: AspectRatio; label: string; desc: string; icon: string }[] = [
  { id: '16:9', label: '16:9', desc: 'Landscape (YouTube, TV)', icon: '▬' },
  { id: '9:16', label: '9:16', desc: 'Portrait (TikTok, Reels, Shorts)', icon: '▮' },
  { id: '1:1', label: '1:1', desc: 'Square (Instagram)', icon: '◻' },
  { id: '4:3', label: '4:3', desc: 'Classic (Standard def)', icon: '▭' },
  { id: '21:9', label: '21:9', desc: 'Ultrawide (Cinematic)', icon: '──' },
];

export default function AspectRatioSelector() {
  const { state, setAspectRatio } = useTimeline();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v2M17 4v2M2 10h20"/>
      </svg>
      {RATIOS.map((ratio) => (
        <button
          key={ratio.id}
          onClick={() => setAspectRatio(ratio.id)}
          title={ratio.desc}
          style={{
            padding: '3px 6px',
            fontSize: 10,
            fontWeight: state.aspectRatio === ratio.id ? 700 : 500,
            fontFamily: 'monospace',
            background: state.aspectRatio === ratio.id ? 'var(--teal-primary)' : 'var(--surface)',
            color: state.aspectRatio === ratio.id ? '#fff' : 'var(--text-muted)',
            border: state.aspectRatio === ratio.id ? '1px solid var(--teal-primary)' : '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            transition: 'all 0.1s',
            letterSpacing: '0.02em',
          }}
        >
          {ratio.label}
        </button>
      ))}
    </div>
  );
}
