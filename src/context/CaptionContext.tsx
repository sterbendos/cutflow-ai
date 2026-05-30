import React, { createContext, useCallback, useContext, useState } from 'react';

export interface CaptionWordStyle {
  bold: boolean;
  color?: string;
}

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontColor: string;
  bgColor: string;
  bgOpacity: number;
  bgRadius: number;
  position: 'bottom' | 'top';
  alignment: 'left' | 'center' | 'right';
  animation: 'none' | 'fade' | 'slide-up' | 'highlight';
  textShadow: boolean;
  shadowColor: string;
  shadowBlur: number;
  maxWidth: number;
  letterSpacing: number;
  lineHeight: number;
  wordStyle: 'none' | 'teal-highlight' | 'bold-keywords' | 'gradient';
}

export const defaultCaptionStyle: CaptionStyle = {
  fontFamily: "'Outfit', 'Inter', 'sans-serif'",
  fontSize: 28,
  fontWeight: 800,
  fontColor: '#ffffff',
  bgColor: '#000000',
  bgOpacity: 0.2,
  bgRadius: 8,
  position: 'bottom',
  alignment: 'center',
  animation: 'fade',
  textShadow: true,
  shadowColor: 'rgba(0, 0, 0, 0.8)',
  shadowBlur: 12,
  maxWidth: 90,
  letterSpacing: 0.02,
  lineHeight: 1.4,
  wordStyle: 'teal-highlight',
};

export function getBgCss(style: CaptionStyle): string {
  if (style.bgOpacity === 0) return 'transparent';
  const hex = style.bgColor;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${style.bgOpacity})`;
}

export interface CaptionPreset {
  name: string;
  style: CaptionStyle;
}

export const captionPresets: CaptionPreset[] = [
  {
    name: 'CutFlow',
    style: defaultCaptionStyle,
  },
  {
    name: 'Classic',
    style: {
      ...defaultCaptionStyle,
      fontFamily: "'Georgia', 'Times New Roman', serif",
      fontSize: 26,
      fontWeight: 400,
      fontColor: '#f5f5f5',
      bgColor: '#000000',
      bgOpacity: 0.75,
      bgRadius: 4,
      animation: 'none',
      wordStyle: 'none',
    },
  },
  {
    name: 'Minimal',
    style: {
      ...defaultCaptionStyle,
      fontSize: 22,
      fontWeight: 500,
      fontColor: '#e2e8f0',
      bgOpacity: 0,
      textShadow: true,
      shadowColor: 'rgba(0, 0, 0, 0.9)',
      shadowBlur: 4,
      animation: 'slide-up',
      wordStyle: 'none',
    },
  },
  {
    name: 'Neon',
    style: {
      ...defaultCaptionStyle,
      fontFamily: "'Outfit', 'Inter', sans-serif",
      fontSize: 32,
      fontWeight: 900,
      fontColor: '#22d3ee',
      bgOpacity: 0,
      textShadow: true,
      shadowColor: 'rgba(34, 211, 238, 0.6)',
      shadowBlur: 20,
      animation: 'fade',
      wordStyle: 'none',
    },
  },
  {
    name: 'Cinematic',
    style: {
      ...defaultCaptionStyle,
      fontFamily: "'Outfit', 'Inter', sans-serif",
      fontSize: 24,
      fontWeight: 300,
      fontColor: '#ffffff',
      bgColor: '#000000',
      bgOpacity: 0.4,
      bgRadius: 2,
      position: 'bottom',
      alignment: 'center',
      animation: 'fade',
      letterSpacing: 0.05,
      wordStyle: 'none',
    },
  },
  {
    name: 'Bold Keywords',
    style: {
      ...defaultCaptionStyle,
      fontFamily: "'Inter', sans-serif",
      fontSize: 26,
      fontWeight: 600,
      animation: 'highlight',
      wordStyle: 'bold-keywords',
    },
  },
];

interface CaptionContextValue {
  style: CaptionStyle;
  setStyle: (style: CaptionStyle) => void;
  updateStyle: (partial: Partial<CaptionStyle>) => void;
  applyPreset: (name: string) => void;
  presets: CaptionPreset[];
}

const CaptionContext = createContext<CaptionContextValue | null>(null);

export function CaptionProvider({ children }: { children: React.ReactNode }) {
  const [style, setStyle] = useState<CaptionStyle>(defaultCaptionStyle);

  const updateStyle = useCallback((partial: Partial<CaptionStyle>) => {
    setStyle((prev) => ({ ...prev, ...partial }));
  }, []);

  const applyPreset = useCallback((name: string) => {
    const preset = captionPresets.find((p) => p.name === name);
    if (preset) {
      setStyle({ ...preset.style });
    }
  }, []);

  return (
    <CaptionContext.Provider
      value={{ style, setStyle, updateStyle, applyPreset, presets: captionPresets }}
    >
      {children}
    </CaptionContext.Provider>
  );
}

export function useCaption(): CaptionContextValue {
  const ctx = useContext(CaptionContext);
  if (!ctx) throw new Error('useCaption must be used inside <CaptionProvider>');
  return ctx;
}
