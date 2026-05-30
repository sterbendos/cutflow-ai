import React, { createContext, useCallback, useContext, useState } from 'react';
import { MG_TEMPLATES } from '@/templates/motion-graphics';

export type MgAnimation = 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'reveal' | 'none';
export type MgType = 'title' | 'lower-third' | 'text-overlay';
export type MgTemplate = 'lower-third' | 'title-card' | 'quote' | 'label' | 'section-header';

export interface MotionGraphicsItem {
  id: string;
  type: MgType;
  template?: MgTemplate;
  text: string;
  subtitle: string;
  startTime: number;
  endTime: number;
  positionX: number;
  positionY: number;
  animation: MgAnimation;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontColor: string;
  accentColor: string;
  bgColor: string;
  bgOpacity: number;
}

export const mgTemplates: Record<MgTemplate, Omit<MotionGraphicsItem, 'id' | 'text' | 'subtitle' | 'startTime' | 'endTime'>> = {
  'lower-third': {
    type: 'lower-third',
    positionX: 5,
    positionY: 82,
    animation: 'slide-left',
    fontFamily: "'Outfit', 'Inter', sans-serif",
    fontSize: 22,
    fontWeight: 700,
    fontColor: '#ffffff',
    accentColor: '#14b8a6',
    bgColor: '#0b1329',
    bgOpacity: 0.85,
  },
  'title-card': {
    type: 'title',
    positionX: 50,
    positionY: 45,
    animation: 'fade',
    fontFamily: "'Outfit', 'Inter', sans-serif",
    fontSize: 42,
    fontWeight: 800,
    fontColor: '#ffffff',
    accentColor: '#14b8a6',
    bgColor: '#000000',
    bgOpacity: 0,
  },
  'quote': {
    type: 'text-overlay',
    positionX: 50,
    positionY: 50,
    animation: 'fade',
    fontFamily: "'Georgia', 'Times New Roman', serif",
    fontSize: 28,
    fontWeight: 400,
    fontColor: '#f5f5f5',
    accentColor: '#14b8a6',
    bgColor: '#000000',
    bgOpacity: 0.5,
  },
  'label': {
    type: 'text-overlay',
    positionX: 5,
    positionY: 5,
    animation: 'slide-up',
    fontFamily: "'Inter', sans-serif",
    fontSize: 14,
    fontWeight: 600,
    fontColor: '#94a3b8',
    accentColor: '#14b8a6',
    bgColor: '#000000',
    bgOpacity: 0.4,
  },
  'section-header': {
    type: 'title',
    positionX: 50,
    positionY: 30,
    animation: 'reveal',
    fontFamily: "'Outfit', 'Inter', sans-serif",
    fontSize: 36,
    fontWeight: 700,
    fontColor: '#ffffff',
    accentColor: '#14b8a6',
    bgColor: '#000000',
    bgOpacity: 0,
  },
};

// ─── Helper: resolve template config from old or new ID ──────
function resolveTemplateConfig(template: string): Omit<MotionGraphicsItem, 'id' | 'text' | 'subtitle' | 'startTime' | 'endTime'> | null {
  // Check old-style templates
  if (template in mgTemplates) {
    return mgTemplates[template as MgTemplate];
  }
  // Check new-style templates from motion-graphics.ts
  const found = MG_TEMPLATES.find(t => t.id === template);
  if (found) {
    const c = found.config;
    return {
      type: c.type as MgType,
      positionX: c.positionX,
      positionY: c.positionY,
      animation: c.animation as MgAnimation,
      fontFamily: c.fontFamily,
      fontSize: c.fontSize,
      fontWeight: c.fontWeight,
      fontColor: c.fontColor,
      accentColor: c.accentColor,
      bgColor: c.bgColor,
      bgOpacity: c.bgOpacity,
    };
  }
  return null;
}

interface MotionGraphicsContextValue {
  items: MotionGraphicsItem[];
  addItem: (item: MotionGraphicsItem) => void;
  updateItem: (id: string, partial: Partial<MotionGraphicsItem>) => void;
  removeItem: (id: string) => void;
  addFromTemplate: (template: string, text: string, subtitle: string, start: number, end: number) => void;
}

const MotionGraphicsContext = createContext<MotionGraphicsContextValue | null>(null);

function generateId(): string {
  return `mg-${crypto.randomUUID().slice(0, 8)}`;
}

export function MotionGraphicsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<MotionGraphicsItem[]>([]);

  const addItem = useCallback((item: MotionGraphicsItem) => {
    setItems((prev) => [...prev, item]);
  }, []);

  const updateItem = useCallback((id: string, partial: Partial<MotionGraphicsItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...partial } : item)));
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const addFromTemplate = useCallback(
    (template: string, text: string, subtitle: string, start: number, end: number) => {
      const base = resolveTemplateConfig(template);
      if (!base) return;
      const item: MotionGraphicsItem = {
        ...base,
        id: generateId(),
        template: template as MgTemplate,
        text,
        subtitle,
        startTime: start,
        endTime: end,
      };
      setItems((prev) => [...prev, item]);
    },
    [],
  );

  return (
    <MotionGraphicsContext.Provider value={{ items, addItem, updateItem, removeItem, addFromTemplate }}>
      {children}
    </MotionGraphicsContext.Provider>
  );
}

export function useMotionGraphics(): MotionGraphicsContextValue {
  const ctx = useContext(MotionGraphicsContext);
  if (!ctx) throw new Error('useMotionGraphics must be used inside <MotionGraphicsProvider>');
  return ctx;
}
