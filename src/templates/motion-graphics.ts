// CutFlow AI — Motion Graphics Template Registry
// Extensible template system. Users can add custom templates
// by placing JSON files in ~/.cutflow/templates/

export type MgAnimation = 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'reveal' | 'scale' | 'typewriter' | 'bounce' | 'none';
export type MgType = 'title' | 'lower-third' | 'text-overlay' | 'callout' | 'fullscreen';

export interface MgTemplate {
  id: string;
  name: string;
  description: string;
  category: 'lower-thirds' | 'titles' | 'callouts' | 'social' | 'branding';
  preview?: string; // data URI or path to preview image
  config: {
    type: MgType;
    positionX: number;    // percent (0-100)
    positionY: number;    // percent (0-100)
    animation: MgAnimation;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    fontColor: string;
    accentColor: string;
    bgColor: string;
    bgOpacity: number;
    border?: string;
    shadow?: string;
    textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
    letterSpacing?: number;
    lineHeight?: number;
  };
}

export const MG_TEMPLATES: MgTemplate[] = [
  // ── Lower Thirds ──────────────────────────────────────────
  {
    id: 'lt-clean',
    name: 'Clean Lower Third',
    description: 'Minimal name + title bar with teal accent',
    category: 'lower-thirds',
    config: {
      type: 'lower-third',
      positionX: 4, positionY: 80,
      animation: 'slide-left',
      fontFamily: "'Outfit', 'Inter', sans-serif",
      fontSize: 22, fontWeight: 700,
      fontColor: '#ffffff', accentColor: '#14b8a6',
      bgColor: '#0b1329', bgOpacity: 0.88,
    },
  },
  {
    id: 'lt-modern',
    name: 'Modern Lower Third',
    description: 'Sleek dark bar with accent underline',
    category: 'lower-thirds',
    config: {
      type: 'lower-third',
      positionX: 3, positionY: 78,
      animation: 'slide-up',
      fontFamily: "'Inter', sans-serif",
      fontSize: 20, fontWeight: 600,
      fontColor: '#ffffff', accentColor: '#0ea5e9',
      bgColor: '#0f172a', bgOpacity: 0.9,
      border: 'left: 3px solid #0ea5e9',
      letterSpacing: 0.02,
    },
  },
  {
    id: 'lt-bold',
    name: 'Bold Lower Third',
    description: 'Thick colored bar for high contrast',
    category: 'lower-thirds',
    config: {
      type: 'lower-third',
      positionX: 0, positionY: 84,
      animation: 'slide-left',
      fontFamily: "'Outfit', sans-serif",
      fontSize: 26, fontWeight: 800,
      fontColor: '#ffffff', accentColor: '#f59e0b',
      bgColor: '#1e293b', bgOpacity: 0.95,
      textTransform: 'uppercase',
      letterSpacing: 0.06,
    },
  },
  {
    id: 'lt-glass',
    name: 'Glass Lower Third',
    description: 'Frosted glass effect with blur',
    category: 'lower-thirds',
    config: {
      type: 'lower-third',
      positionX: 5, positionY: 82,
      animation: 'fade',
      fontFamily: "'Inter', sans-serif",
      fontSize: 20, fontWeight: 500,
      fontColor: '#ffffff', accentColor: '#a78bfa',
      bgColor: 'rgba(15, 23, 42, 0.6)', bgOpacity: 0.6,
      shadow: '0 4px 30px rgba(0,0,0,0.3)',
    },
  },

  // ── Titles ────────────────────────────────────────────────
  {
    id: 'title-center',
    name: 'Centered Title',
    description: 'Clean centered headline for opens',
    category: 'titles',
    config: {
      type: 'title',
      positionX: 50, positionY: 42,
      animation: 'fade',
      fontFamily: "'Outfit', 'Inter', sans-serif",
      fontSize: 48, fontWeight: 800,
      fontColor: '#ffffff', accentColor: '#14b8a6',
      bgColor: '#000000', bgOpacity: 0,
      lineHeight: 1.2,
    },
  },
  {
    id: 'title-bottom',
    name: 'Bottom Title',
    description: 'Title anchored at lower third',
    category: 'titles',
    config: {
      type: 'title',
      positionX: 50, positionY: 75,
      animation: 'slide-up',
      fontFamily: "'Outfit', sans-serif",
      fontSize: 36, fontWeight: 700,
      fontColor: '#ffffff', accentColor: '#14b8a6',
      bgColor: '#000000', bgOpacity: 0.3,
      letterSpacing: 0.04,
      textTransform: 'uppercase',
    },
  },
  {
    id: 'title-gradient',
    name: 'Gradient Title',
    description: 'Title with gradient text effect',
    category: 'titles',
    config: {
      type: 'title',
      positionX: 50, positionY: 40,
      animation: 'scale',
      fontFamily: "'Outfit', sans-serif",
      fontSize: 56, fontWeight: 900,
      fontColor: '#ffffff', accentColor: '#06b6d4',
      bgColor: '#000000', bgOpacity: 0,
      shadow: '0 0 40px rgba(6, 182, 212, 0.3)',
      lineHeight: 1.1,
    },
  },

  // ── Callouts / Annotations ────────────────────────────────
  {
    id: 'callout-top-left',
    name: 'Top Left Callout',
    description: 'Small annotation for top corner',
    category: 'callouts',
    config: {
      type: 'callout',
      positionX: 3, positionY: 4,
      animation: 'slide-right',
      fontFamily: "'Inter', sans-serif",
      fontSize: 14, fontWeight: 600,
      fontColor: '#94a3b8', accentColor: '#14b8a6',
      bgColor: '#000000', bgOpacity: 0.4,
    },
  },
  {
    id: 'callout-quote',
    name: 'Quote Overlay',
    description: 'Styled quote with serif font',
    category: 'callouts',
    config: {
      type: 'callout',
      positionX: 50, positionY: 50,
      animation: 'fade',
      fontFamily: "'Georgia', 'Times New Roman', serif",
      fontSize: 28, fontWeight: 400,
      fontColor: '#f5f5f5', accentColor: '#14b8a6',
      bgColor: '#000000', bgOpacity: 0.5,
      lineHeight: 1.5,
    },
  },
  {
    id: 'callout-highlight',
    name: 'Highlight Box',
    description: 'Accent-colored highlight box',
    category: 'callouts',
    config: {
      type: 'callout',
      positionX: 50, positionY: 70,
      animation: 'bounce',
      fontFamily: "'Inter', sans-serif",
      fontSize: 18, fontWeight: 700,
      fontColor: '#ffffff', accentColor: '#f59e0b',
      bgColor: '#f59e0b', bgOpacity: 0.2,
      border: 'all: 2px solid #f59e0b',
    },
  },

  // ── Social Media ──────────────────────────────────────────
  {
    id: 'social-tag',
    name: 'Social Handle',
    description: 'Instagram/Twitter handle overlay',
    category: 'social',
    config: {
      type: 'text-overlay',
      positionX: 5, positionY: 92,
      animation: 'slide-up',
      fontFamily: "'Inter', sans-serif",
      fontSize: 16, fontWeight: 600,
      fontColor: '#ffffff', accentColor: '#e1306c',
      bgColor: '#000000', bgOpacity: 0.5,
      letterSpacing: 0.02,
    },
  },
  {
    id: 'social-subscribe',
    name: 'Subscribe Callout',
    description: 'Subscribe/Follow prompt',
    category: 'social',
    config: {
      type: 'callout',
      positionX: 50, positionY: 85,
      animation: 'bounce',
      fontFamily: "'Outfit', sans-serif",
      fontSize: 20, fontWeight: 800,
      fontColor: '#ffffff', accentColor: '#ff0000',
      bgColor: '#ff0000', bgOpacity: 0.15,
      border: 'all: 2px solid #ff0000',
      textTransform: 'uppercase',
    },
  },
  {
    id: 'social-hashtags',
    name: 'Hashtags',
    description: 'Bottom hashtag bar',
    category: 'social',
    config: {
      type: 'text-overlay',
      positionX: 50, positionY: 95,
      animation: 'slide-up',
      fontFamily: "'Inter', sans-serif",
      fontSize: 13, fontWeight: 500,
      fontColor: '#94a3b8', accentColor: '#3b82f6',
      bgColor: '#000000', bgOpacity: 0.3,
      letterSpacing: 0.04,
    },
  },

  // ── Branding / Watermarks ─────────────────────────────────
  {
    id: 'brand-watermark',
    name: 'Watermark',
    description: 'Subtle corner branding',
    category: 'branding',
    config: {
      type: 'text-overlay',
      positionX: 95, positionY: 95,
      animation: 'none',
      fontFamily: "'Inter', sans-serif",
      fontSize: 12, fontWeight: 500,
      fontColor: '#64748b', accentColor: '#14b8a6',
      bgColor: '#000000', bgOpacity: 0,
      letterSpacing: 0.1,
      textTransform: 'uppercase',
    },
  },
  {
    id: 'brand-countdown',
    name: 'Countdown Timer',
    description: 'Lower-third countdown style',
    category: 'branding',
    config: {
      type: 'lower-third',
      positionX: 50, positionY: 90,
      animation: 'none',
      fontFamily: "'Outfit', monospace",
      fontSize: 32, fontWeight: 700,
      fontColor: '#ffffff', accentColor: '#14b8a6',
      bgColor: '#000000', bgOpacity: 0.6,
    },
  },
];

// ─── Template Loader (extensible) ─────────────────────────────
// In the future, load from ~/.cutflow/templates/*.json

export function getTemplatesByCategory(category: MgTemplate['category']): MgTemplate[] {
  return MG_TEMPLATES.filter(t => t.category === category);
}

export function getTemplate(id: string): MgTemplate | undefined {
  return MG_TEMPLATES.find(t => t.id === id);
}

export function getAllCategories(): MgTemplate['category'][] {
  return ['lower-thirds', 'titles', 'callouts', 'social', 'branding'];
}
