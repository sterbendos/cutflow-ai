// CutFlow AI — Subtitle / ASS generator for export
// Generates a valid Advanced SubStation Alpha (.ass) script so that:
//  • Font, colour, size, background box are driven by force_style
//  • Word-by-word highlight (active-word-color, active-word-crab) are implemented
//    with per-word cues that contain inline {\c&H...&} colour override tags
//  • Gradient / teal-highlight apply a fixed colour to important keywords
//  • Bold-keywords bolds important words with {\b1}…{\b0}
//  • Position is pinned to the bottom third — no face-detection movement on export

export interface SubtitleWord {
  text: string;
  start: number;
  end: number;
}

export interface SubtitleSegment {
  start: number;
  end: number;
  segment_type?: string;
}

const CUE_HOLD_SECONDS = 0.1;
const MIN_CUE_DURATION_SECONDS = 0.12;

export function normalizeTranscript(input: unknown): SubtitleWord[] {
  const value =
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Array.isArray((input as { transcript?: unknown }).transcript)
      ? (input as { transcript: unknown }).transcript
      : input;

  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;

      const candidate = entry as Partial<SubtitleWord>;
      const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
      const start = Number(candidate.start);
      const end = Number(candidate.end);

      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        return null;
      }

      return { text, start, end };
    })
    .filter((entry): entry is SubtitleWord => entry !== null);
}

import type { CaptionStyle } from '../../context/CaptionContext';

const stopwords = new Set([
  'the', 'is', 'at', 'which', 'on', 'and', 'a', 'to', 'in', 'that',
  'it', 'of', 'for', 'with', 'as', 'are', 'this', 'but', 'not',
  'we', 'you', 'i', 'they', 'be', 'have', 'do', 'will', 'an', 'my',
  'or', 'so', 'if', 'no', 'up', 'me', 'he', 'she', 'his', 'her',
]);

function isImportantWord(word: string): boolean {
  const clean = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  return clean.length > 3 && !stopwords.has(clean);
}

/** #RRGGBB → &HBBGGRR& (ASS BGR, fully opaque) */
function hexToAssBgr(hex: string): string {
  const clean = hex.replace('#', '').padEnd(6, '0');
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H00${b}${g}${r}&`.toUpperCase();
}

/** #RRGGBB + opacity → &HAABBGGRR& (ASS ABGR; 0x00=opaque, 0xFF=transparent) */
function hexToAssAbgr(hex: string, opacity: number): string {
  const clean = hex.replace('#', '').padEnd(6, '0');
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  const alpha = Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `&H${alpha}${b}${g}${r}&`.toUpperCase();
}

/** Format seconds as ASS timestamp: H:MM:SS.cc (centiseconds) */
function formatAssTimestamp(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s % 1) * 100); // centiseconds
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Also export the old SRT format timestamp (for compatibility) */
export function formatSrtTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = Math.floor(safeSeconds % 60);
  const ms = Math.round((safeSeconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Build the [Script Info] + [V4+ Styles] + [Events] header for an ASS file.
 * The Default style carries all the visual settings (font, size, colour, box, position).
 * Individual dialogue lines can still use inline override tags {\\c...} etc.
 */
function buildAssHeader(style: CaptionStyle | undefined): string {
  // ── Defaults when no style provided ─────────────────────────
  const fontName = style
    ? style.fontFamily.split(',')[0].replace(/['"]/g, '').trim()
    : 'Outfit';
  const fontSize = style ? Math.round(style.fontSize * 0.65) : 18; // scale down for video pixels
  const bold = style && style.fontWeight >= 700 ? -1 : 0; // -1 = bold in ASS
  const primaryColour = style ? hexToAssBgr(style.fontColor) : '&H00FFFFFF&';
  const secondaryColour = '&H00000000&'; // unused
  const backColour = '&HFF000000&';      // shadow — fully transparent by default

  let outlineColour = '&H80000000&';
  let borderStyle = 1; // 1 = outline+shadow, 3 = opaque box
  let outline = 2;
  let shadow = style?.textShadow ? 2 : 0;
  let marginV = 40;

  if (style && style.bgOpacity > 0) {
    borderStyle = 3;
    outlineColour = hexToAssAbgr(style.bgColor, style.bgOpacity);
    outline = 0;
    shadow = 0;
  }

  // Alignment: 2=bottom-centre (numpad), 8=top-centre, etc.
  let alignment = 2;
  if (style?.position === 'top') {
    alignment = style.alignment === 'left' ? 7 : style.alignment === 'right' ? 9 : 8;
    marginV = 20;
  } else {
    alignment = style?.alignment === 'left' ? 1 : style?.alignment === 'right' ? 3 : 2;
    marginV = 40;
  }

  const spacing = style && style.letterSpacing !== 0
    ? (style.letterSpacing * (style.fontSize ?? 28)).toFixed(1)
    : '0';

  return [
    '[Script Info]',
    'Title: CutFlow AI Export',
    'ScriptType: v4.00+',
    'Collisions: Normal',
    'PlayDepth: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${fontSize},${primaryColour},${secondaryColour},${outlineColour},${backColour},${bold},0,0,0,100,100,${spacing},0,${borderStyle},${outline},${shadow},${alignment},10,10,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
}

/**
 * Generate a full ASS (Advanced SubStation Alpha) file for export burn-in.
 *
 * Replaces the old SRT generator. The file is saved as .ass and passed to:
 *   -vf "ass='path/to/file.ass'"
 * (no force_style needed — styles are baked into the [V4+ Styles] section)
 */
export function generateSrtForExport(
  transcript: SubtitleWord[],
  segments: SubtitleSegment[],
  style?: CaptionStyle
): string {
  const keepSegments = segments
    .filter((seg) => seg.segment_type === undefined || seg.segment_type === 'keep')
    .filter((seg) => Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end > seg.start)
    .slice()
    .sort((a, b) => a.start - b.start);

  if (transcript.length === 0 || keepSegments.length === 0) return '';

  const header = buildAssHeader(style);
  const lines: string[] = [header];

  const highlightBgr = style ? hexToAssBgr(style.highlightColor) : '&H00A6B814&'; // teal default
  const fontBgr = style ? hexToAssBgr(style.fontColor) : '&H00FFFFFF&';
  const wordStyle = style?.wordStyle ?? 'none';

  for (const word of transcript) {
    const midpoint = (word.start + word.end) / 2;
    const sourceSegment = keepSegments.find(
      (seg) => midpoint >= seg.start && midpoint <= seg.end
    );
    if (!sourceSegment) continue;

    const words = word.text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) continue;

    if (wordStyle === 'active-word-color' || wordStyle === 'active-word-crab') {
      // Emit one dialogue line per word so the active-word colour changes per word
      const chunkDuration = word.end - word.start;
      const wordDuration = chunkDuration / words.length;

      for (let wIdx = 0; wIdx < words.length; wIdx++) {
        const wStart = word.start + wIdx * wordDuration;
        const wEnd = word.start + (wIdx + 1) * wordDuration;

        const srcStart = clamp(wStart, sourceSegment.start, sourceSegment.end);
        const srcEnd = clamp(
          wEnd + (wIdx === words.length - 1 ? CUE_HOLD_SECONDS : 0),
          sourceSegment.start,
          sourceSegment.end
        );

        const expStart = mapSourceTimeToExport(srcStart, keepSegments);
        let expEnd = mapSourceTimeToExport(srcEnd, keepSegments);
        if (expEnd <= expStart) expEnd = expStart + MIN_CUE_DURATION_SECONDS;
        if (!Number.isFinite(expStart) || !Number.isFinite(expEnd)) continue;

        // Build line: all words default colour, active word gets highlight colour
        const parts = words.map((w, j) => {
          if (j === wIdx) {
            // Active word: change primary colour inline then reset
            return `{\\c${highlightBgr}}${w}{\\c${fontBgr}}`;
          }
          return w;
        });

        lines.push(
          `Dialogue: 0,${formatAssTimestamp(expStart)},${formatAssTimestamp(expEnd)},Default,,0,0,0,,${parts.join(' ')}`
        );
      }
    } else {
      // Single dialogue line for the whole chunk
      const srcStart = clamp(word.start, sourceSegment.start, sourceSegment.end);
      const srcEnd = clamp(word.end + CUE_HOLD_SECONDS, sourceSegment.start, sourceSegment.end);

      const expStart = mapSourceTimeToExport(srcStart, keepSegments);
      let expEnd = mapSourceTimeToExport(srcEnd, keepSegments);
      if (expEnd <= expStart) expEnd = expStart + MIN_CUE_DURATION_SECONDS;
      if (!Number.isFinite(expStart) || !Number.isFinite(expEnd)) continue;

      let text: string;

      if (wordStyle === 'bold-keywords') {
        text = words
          .map((w) =>
            isImportantWord(w) ? `{\\b1}${w}{\\b0}` : w
          )
          .join(' ');
      } else if (wordStyle === 'teal-highlight' || wordStyle === 'gradient') {
        // gradient can't be done in ASS — render it as a solid colour highlight
        text = words
          .map((w) =>
            isImportantWord(w)
              ? `{\\c${highlightBgr}}${w}{\\c${fontBgr}}`
              : w
          )
          .join(' ');
      } else {
        // 'none' — plain text
        text = words.join(' ');
      }

      lines.push(
        `Dialogue: 0,${formatAssTimestamp(expStart)},${formatAssTimestamp(expEnd)},Default,,0,0,0,,${text}`
      );
    }
  }

  // If only the header was written, there are no events → return empty string
  if (lines.length === 1) return '';

  return lines.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────
// Time mapping helpers
// ─────────────────────────────────────────────────────────────

function mapSourceTimeToExport(sourceTime: number, keepSegments: SubtitleSegment[]): number {
  let exportTime = 0;

  for (const segment of keepSegments) {
    if (sourceTime <= segment.start) {
      return exportTime;
    }
    if (sourceTime <= segment.end) {
      return exportTime + (sourceTime - segment.start);
    }
    exportTime += segment.end - segment.start;
  }

  return exportTime;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
