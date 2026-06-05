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

import type { FacePlacements } from './faceScanner';

export function generateSrtForExport(
  transcript: SubtitleWord[],
  segments: SubtitleSegment[],
  facePlacements?: FacePlacements
): string {
  const keepSegments = segments
    .filter((segment) => segment.segment_type === undefined || segment.segment_type === 'keep')
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)
    .slice()
    .sort((a, b) => a.start - b.start);

  if (transcript.length === 0 || keepSegments.length === 0) return '';

  let cueIndex = 1;
  let content = '';

  for (let i = 0; i < transcript.length; i++) {
    const word = transcript[i];
    const midpoint = (word.start + word.end) / 2;
    const sourceSegment = keepSegments.find(
      (segment) => midpoint >= segment.start && midpoint <= segment.end
    );

    if (!sourceSegment) continue;

    const sourceStart = clamp(word.start, sourceSegment.start, sourceSegment.end);
    const sourceEnd = clamp(word.end + CUE_HOLD_SECONDS, sourceSegment.start, sourceSegment.end);
    const exportStart = mapSourceTimeToExport(sourceStart, keepSegments);
    let exportEnd = mapSourceTimeToExport(sourceEnd, keepSegments);

    if (exportEnd <= exportStart) {
      exportEnd = exportStart + MIN_CUE_DURATION_SECONDS;
    }

    if (!Number.isFinite(exportStart) || !Number.isFinite(exportEnd)) continue;

    let text = formatSrtText(word.text);

    // Inject ASS alignment override tag if we have face placement data
    if (facePlacements) {
      const placement = facePlacements.get(i); 
      if (placement === 'top') {
        text = `{\\an8}${text}`; // 8 is Top Center in ASS numpad notation
      } else if (placement === 'bottom') {
        text = `{\\an2}${text}`; // 2 is Bottom Center
      }
    }

    content += `${cueIndex++}\n`;
    content += `${formatSrtTimestamp(exportStart)} --> ${formatSrtTimestamp(exportEnd)}\n`;
    content += `${text}\n\n`;
  }

  return content;
}

export function formatSrtTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = Math.floor(safeSeconds % 60);
  const ms = Math.round((safeSeconds % 1) * 1000);

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

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

function formatSrtText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
