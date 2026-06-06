// CutFlow AI — Caption Style → SSA/ASS force_style converter
// Translates our CaptionContext style into the FFmpeg subtitle force_style string.
// Reference: https://ffmpeg.org/ffmpeg-filters.html#subtitles
// SSA/ASS Color format: &HAABBGGRR (alpha, blue, green, red — all hex, no #)

import type { CaptionStyle } from '@/context/CaptionContext';

/**
 * Converts a hex color string (#RRGGBB or #RRGGBBAA) to SSA/ASS &HAABBGGRR format.
 */
export function hexToSsaColor(hex: string, opacity = 1): string {
  const clean = hex.replace('#', '');
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  // Alpha: 0x00 = fully opaque, 0xFF = fully transparent
  const alpha = Math.round((1 - opacity) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `&H${alpha}${b}${g}${r}&`.toUpperCase();
}

/**
 * Strips CSS font-family wrappers and returns the first clean font name.
 * e.g. "'Outfit', 'Inter', sans-serif" → "Outfit"
 */
function cleanFontName(fontFamily: string): string {
  return fontFamily
    .split(',')[0]
    .replace(/['"]/g, '')
    .trim();
}

/**
 * Converts a CaptionStyle object to an FFmpeg ASS force_style string.
 * This string is passed as: subtitles='file.srt':force_style='...'
 */
export function captionStyleToSsaForceStyle(style: CaptionStyle): string {
  const parts: string[] = [];

  // Font
  parts.push(`Fontname=${cleanFontName(style.fontFamily)}`);
  parts.push(`Fontsize=${Math.round(style.fontSize * 0.65)}`);
  parts.push(`Bold=${style.fontWeight >= 700 ? 1 : 0}`);

  // Primary (text) color
  parts.push(`PrimaryColour=${hexToSsaColor(style.fontColor)}`);

  // Background / border box
  if (style.bgOpacity > 0) {
    // BorderStyle=3 = opaque box background in ASS
    parts.push('BorderStyle=3');
    // OutlineColour controls the box background color in BorderStyle=3
    parts.push(`OutlineColour=${hexToSsaColor(style.bgColor, style.bgOpacity)}`);
    // BackColour controls the shadow color of the box
    parts.push('BackColour=&HFF000000&');
    parts.push('Outline=0');
  } else {
    // No box — use outline for legibility
    parts.push('BorderStyle=1');
    parts.push('Outline=2');
    parts.push(`OutlineColour=&H80000000&`);
  }

  // Shadow
  if (style.textShadow) {
    parts.push('Shadow=2');
  } else {
    parts.push('Shadow=0');
  }

  // Vertical margin from edge
  const marginV = style.position === 'top' ? 20 : 40;
  parts.push(`MarginV=${marginV}`);

  // Alignment (2=bottom-center, 8=top-center, 1=bottom-left, 3=bottom-right)
  let alignment = 2; // default: bottom-center
  if (style.position === 'top') {
    alignment = style.alignment === 'left' ? 7 : style.alignment === 'right' ? 9 : 8;
  } else {
    alignment = style.alignment === 'left' ? 1 : style.alignment === 'right' ? 3 : 2;
  }
  parts.push(`Alignment=${alignment}`);

  // Letter spacing (approximated — ASS doesn't have native kerning, use Spacing)
  if (style.letterSpacing !== 0) {
    parts.push(`Spacing=${(style.letterSpacing * style.fontSize).toFixed(1)}`);
  }

  return parts.join(',');
}

/**
 * Builds the subtitle preset dropdown options list from captionPresets.
 */
export type SubtitlePresetOption = {
  label: string;
  forceStyle: string;
};

export function buildSubtitlePresetOptions(
  presets: Array<{ name: string; style: CaptionStyle }>
): SubtitlePresetOption[] {
  return presets.map((p) => ({
    label: p.name,
    forceStyle: captionStyleToSsaForceStyle(p.style),
  }));
}
