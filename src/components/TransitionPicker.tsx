import React from 'react';
import { useTimeline } from '../context/TimelineContext';

export default function TransitionPicker() {
  const { state, setTransition } = useTimeline();

  const transitions = [
    { value: 'none', label: 'None' },
    { value: 'crossfade', label: 'Crossfade (0.3s)' },
    { value: 'dip_black', label: 'Dip to Black (0.5s)' },
    { value: 'wipe', label: 'Wipe (0.4s)' },
  ] as const;

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as any;
    let dur = 0.3;
    if (val === 'dip_black') dur = 0.5;
    if (val === 'wipe') dur = 0.4;
    setTransition(val, dur);
  };

  return (
    <div style={{ marginTop: '16px' }}>
      <label style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '6px', display: 'block' }}>
        Export Transitions
      </label>
      <select
        value={state.transitionType}
        onChange={handleSelect}
        style={{
          width: '100%',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          padding: '6px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          cursor: 'pointer',
        }}
      >
        {transitions.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}
