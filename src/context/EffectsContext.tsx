// CutFlow AI — Effects Context
// Provides global CSS filter effects state that is shared between
// the Inspector panel, VideoPlayer preview, and ExportDialog baking.

import { createContext, useContext, useState, ReactNode } from 'react';
import { EffectFilters, DEFAULT_EFFECTS } from '@/components/TransformInspector';

interface EffectsContextValue {
  effects: EffectFilters;
  setEffects: (e: EffectFilters) => void;
  resetEffects: () => void;
}

const EffectsContext = createContext<EffectsContextValue | null>(null);

export function EffectsProvider({ children }: { children: ReactNode }) {
  const [effects, setEffects] = useState<EffectFilters>(DEFAULT_EFFECTS);

  const resetEffects = () => setEffects({ ...DEFAULT_EFFECTS });

  return (
    <EffectsContext.Provider value={{ effects, setEffects, resetEffects }}>
      {children}
    </EffectsContext.Provider>
  );
}

export function useEffects(): EffectsContextValue {
  const ctx = useContext(EffectsContext);
  if (!ctx) throw new Error('useEffects must be used within EffectsProvider');
  return ctx;
}
