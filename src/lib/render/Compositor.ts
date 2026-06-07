import type { BRollSegment } from '@/context/TimelineContext';
import type { CaptionStyle } from '@/context/CaptionContext';
import { getBgCss } from '@/context/CaptionContext';
import type { MotionGraphicsItem } from '@/context/MotionGraphicsContext';
import type { TranscriptWord } from '@/hooks/useWhisper';
import type { EffectFilters } from '@/components/TransformInspector';
import { effectsToCssFilter } from '@/components/TransformInspector';

export type DrawableSource = CanvasImageSource | VideoFrame;

export interface RenderBRoll {
  segment: BRollSegment;
  source: DrawableSource;
}

export interface RenderFrameOptions {
  timestamp: number;
  source?: DrawableSource | null;
  bRolls?: RenderBRoll[];
  transcript?: TranscriptWord[];
  captionsVisible?: boolean;
  captionStyle?: CaptionStyle;
  subtitlePosition?: 'top' | 'bottom';
  motionGraphics?: MotionGraphicsItem[];
  effects?: EffectFilters;
  background?: string;
}

interface SourceSize {
  width: number;
  height: number;
}

const STOPWORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'and', 'a', 'to', 'in', 'that',
  'it', 'of', 'for', 'with', 'as', 'are', 'this', 'but', 'not',
  'we', 'you', 'i', 'they', 'be', 'have', 'do', 'will', 'an', 'my',
  'or', 'so', 'if', 'no', 'up', 'me', 'he', 'she', 'his', 'her',
]);

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('2D canvas context is not available');
    }

    this.canvas = canvas;
    this.ctx = ctx;
  }

  setSize(width: number, height: number) {
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));

    if (this.canvas.width !== safeWidth) this.canvas.width = safeWidth;
    if (this.canvas.height !== safeHeight) this.canvas.height = safeHeight;
  }

  renderFrame(options: RenderFrameOptions) {
    const {
      timestamp,
      source,
      bRolls = [],
      transcript = [],
      captionsVisible = true,
      captionStyle,
      subtitlePosition,
      motionGraphics = [],
      effects,
      background = '#000',
    } = options;

    const { ctx, canvas } = this;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    if (source) {
      this.drawContain(source, effects);
    }

    for (const item of bRolls) {
      this.drawBRoll(item, effects);
    }

    this.drawMotionGraphics(timestamp, motionGraphics);

    if (captionsVisible && captionStyle) {
      this.drawSubtitle(timestamp, transcript, captionStyle, subtitlePosition);
    }
  }

  private drawContain(source: DrawableSource, effects?: EffectFilters) {
    const { width, height } = this.canvas;
    const size = getSourceSize(source);
    if (!size.width || !size.height) return;

    const scale = Math.min(width / size.width, height / size.height);
    const drawWidth = size.width * scale;
    const drawHeight = size.height * scale;
    const left = (width - drawWidth) / 2;
    const top = (height - drawHeight) / 2;

    this.ctx.save();
    this.ctx.filter = effects ? effectsToCssFilter(effects) || 'none' : 'none';
    this.ctx.drawImage(source as CanvasImageSource, left, top, drawWidth, drawHeight);
    this.ctx.restore();
  }

  private drawBRoll(item: RenderBRoll, effects?: EffectFilters) {
    const { segment, source } = item;
    const spatial = segment.spatial ?? {
      scale: 1,
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
    };

    const size = getSourceSize(source);
    if (!size.width || !size.height) return;

    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const baseScale = Math.min(canvasWidth / size.width, canvasHeight / size.height);
    const drawWidth = size.width * baseScale * Math.max(0.01, spatial.scale);
    const drawHeight = size.height * baseScale * Math.max(0.01, spatial.scale);
    const left = (canvasWidth - drawWidth) * ((spatial.x + 1) / 2);
    const top = (canvasHeight - drawHeight) * ((spatial.y + 1) / 2);
    const centerX = left + drawWidth / 2;
    const centerY = top + drawHeight / 2;

    this.ctx.save();
    this.ctx.globalAlpha = clamp(spatial.opacity, 0, 1);
    this.ctx.filter = effects ? effectsToCssFilter(effects) || 'none' : 'none';
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate((spatial.rotation * Math.PI) / 180);
    this.ctx.drawImage(
      source as CanvasImageSource,
      -drawWidth / 2,
      -drawHeight / 2,
      drawWidth,
      drawHeight,
    );
    this.ctx.restore();
  }

  private drawSubtitle(
    timestamp: number,
    transcript: TranscriptWord[],
    style: CaptionStyle,
    subtitlePosition?: 'top' | 'bottom',
  ) {
    const activeWord = findActiveTranscriptWord(timestamp, transcript);
    if (!activeWord) return;

    const scale = this.canvas.height / 720;
    const fontSize = Math.max(8, style.fontSize * scale);
    const maxWidth = this.canvas.width * (style.maxWidth / 100);
    const lineHeight = fontSize * style.lineHeight;
    const paddingX = 12 * scale;
    const paddingY = 4 * scale;
    const position = subtitlePosition ?? style.position;

    this.ctx.save();
    this.ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    this.ctx.textBaseline = 'top';
    this.ctx.textAlign = 'left';

    const lines = splitSubtitleLines(this.ctx, activeWord, timestamp, style, maxWidth, fontSize);
    if (lines.length === 0) {
      this.ctx.restore();
      return;
    }

    const textBlockWidth = Math.max(...lines.map((line) => line.width));
    const blockWidth = textBlockWidth + paddingX * 2;
    const blockHeight = lines.length * lineHeight + paddingY * 2;
    const x = getAlignedLeft(this.canvas.width, blockWidth, style.alignment);
    const y = position === 'bottom'
      ? this.canvas.height - blockHeight - 40 * scale
      : 20 * scale;

    if (style.bgOpacity > 0) {
      this.ctx.fillStyle = getBgCss(style);
      roundedRect(this.ctx, x, y, blockWidth, blockHeight, style.bgRadius * scale);
      this.ctx.fill();
    }

    if (style.textShadow) {
      this.ctx.shadowColor = style.shadowColor;
      this.ctx.shadowBlur = style.shadowBlur * scale;
      this.ctx.shadowOffsetY = 2 * scale;
    }

    lines.forEach((line, lineIndex) => {
      let cursorX = x + paddingX + getInlineOffset(blockWidth - paddingX * 2, line.width, style.alignment);
      const cursorY = y + paddingY + lineIndex * lineHeight;

      line.parts.forEach((part) => {
        this.ctx.fillStyle = part.color;
        this.ctx.font = `${part.weight} ${fontSize}px ${style.fontFamily}`;
        this.ctx.fillText(part.text, cursorX, cursorY);
        cursorX += part.width;
      });
    });

    this.ctx.restore();
  }

  private drawMotionGraphics(timestamp: number, items: MotionGraphicsItem[]) {
    const activeItems = items.filter((item) => timestamp >= item.startTime && timestamp <= item.endTime);
    if (activeItems.length === 0) return;

    const scale = this.canvas.height / 720;

    for (const item of activeItems) {
      this.ctx.save();

      const x = (item.positionX / 100) * this.canvas.width;
      const y = (item.positionY / 100) * this.canvas.height;
      const fontSize = Math.max(8, item.fontSize * scale);
      const subtitleFontSize = Math.max(8, (item.type === 'title' ? item.fontSize * 0.5 : item.fontSize - 6) * scale);
      const paddingX = 16 * scale;
      const paddingY = 10 * scale;

      this.ctx.font = `${item.fontWeight} ${fontSize}px ${item.fontFamily}`;
      this.ctx.textBaseline = 'top';
      this.ctx.textAlign = 'left';

      const titleWidth = this.ctx.measureText(item.text).width;
      const subtitleWidth = item.subtitle
        ? measureWithFont(this.ctx, item.subtitle, `400 ${subtitleFontSize}px ${item.fontFamily}`)
        : 0;
      const contentWidth = Math.max(titleWidth, subtitleWidth);
      const contentHeight = fontSize * 1.3 + (item.subtitle ? subtitleFontSize * 1.3 + 2 * scale : 0);
      const boxWidth = contentWidth + paddingX * 2;
      const boxHeight = contentHeight + paddingY * 2;

      let left = x;
      if (item.type === 'title' || item.positionX === 50) {
        left = x - boxWidth / 2;
      } else if (item.positionX > 50) {
        left = x - boxWidth;
      }

      const top = item.type === 'title' ? y - boxHeight / 2 : y;

      if (item.bgOpacity > 0) {
        this.ctx.fillStyle = `rgba(${hexToRgb(item.bgColor)}, ${item.bgOpacity})`;
        roundedRect(this.ctx, left, top, boxWidth, boxHeight, 4 * scale);
        this.ctx.fill();
      }

      if (item.type === 'lower-third') {
        this.ctx.fillStyle = item.accentColor;
        this.ctx.fillRect(left, top, 4 * scale, boxHeight);
      } else if (item.type === 'title') {
        this.ctx.fillStyle = item.accentColor;
        this.ctx.fillRect(x - 30 * scale, top - 16 * scale, 60 * scale, 3 * scale);
      }

      this.ctx.fillStyle = item.fontColor;
      this.ctx.font = `${item.fontWeight} ${fontSize}px ${item.fontFamily}`;
      this.ctx.fillText(item.text, left + paddingX, top + paddingY);

      if (item.subtitle) {
        this.ctx.globalAlpha = 0.8;
        this.ctx.font = `400 ${subtitleFontSize}px ${item.fontFamily}`;
        this.ctx.fillText(item.subtitle, left + paddingX, top + paddingY + fontSize * 1.3 + 2 * scale);
      }

      this.ctx.restore();
    }
  }
}

function getSourceSize(source: DrawableSource): SourceSize {
  const candidate = source as unknown as {
    displayWidth?: number;
    displayHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };

  return {
    width: candidate.displayWidth ?? candidate.videoWidth ?? candidate.naturalWidth ?? candidate.width ?? 0,
    height: candidate.displayHeight ?? candidate.videoHeight ?? candidate.naturalHeight ?? candidate.height ?? 0,
  };
}

function findActiveTranscriptWord(timestamp: number, transcript: TranscriptWord[]) {
  let activeIndex = transcript.findIndex((word) => timestamp >= word.start && timestamp <= word.end + 0.5);

  if (activeIndex === -1) {
    activeIndex = transcript.findIndex((word) => timestamp >= word.start - 0.2 && timestamp <= word.end + 1);
  }

  return activeIndex === -1 ? null : transcript[activeIndex];
}

interface TextPart {
  text: string;
  color: string;
  weight: number;
  width: number;
}

interface TextLine {
  parts: TextPart[];
  width: number;
}

function splitSubtitleLines(
  ctx: CanvasRenderingContext2D,
  activeWord: TranscriptWord,
  timestamp: number,
  style: CaptionStyle,
  maxWidth: number,
  fontSize: number,
): TextLine[] {
  const words = activeWord.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const duration = Math.max(0.001, activeWord.end - activeWord.start);
  const wordDuration = duration / words.length;
  const parts = words.map((word, index) => {
    const clean = word.toLowerCase().replace(/[^a-z0-9]/g, '');
    const isImportant = clean.length > 3 && !STOPWORDS.has(clean);
    const wordStart = activeWord.start + index * wordDuration;
    const wordEnd = wordStart + wordDuration;
    const isActive = timestamp >= wordStart && timestamp < wordEnd;
    const text = `${word} `;
    const weight = style.wordStyle === 'bold-keywords' && isImportant
      ? Math.min(style.fontWeight + 200, 900)
      : style.fontWeight;
    const color = getWordColor(style, isImportant, isActive);

    // Use the same font size used for rendering so measurements match
    ctx.font = `${weight} ${fontSize}px ${style.fontFamily}`;
    return {
      text,
      color,
      weight,
      width: ctx.measureText(text).width,
    };
  });

  const lines: TextLine[] = [];
  let current: TextLine = { parts: [], width: 0 };

  for (const part of parts) {
    if (current.parts.length > 0 && current.width + part.width > maxWidth) {
      lines.push(current);
      current = { parts: [], width: 0 };
    }

    current.parts.push(part);
    current.width += part.width;
  }

  if (current.parts.length > 0) lines.push(current);
  return lines;
}

function getWordColor(style: CaptionStyle, isImportant: boolean, isActive: boolean) {
  if (style.wordStyle === 'active-word-color' && isActive) return style.highlightColor;
  if (style.wordStyle === 'teal-highlight' && isImportant) return style.highlightColor;
  return style.fontColor;
}

function getAlignedLeft(canvasWidth: number, blockWidth: number, alignment: CaptionStyle['alignment']) {
  if (alignment === 'left') return canvasWidth * 0.05;
  if (alignment === 'right') return canvasWidth - blockWidth - canvasWidth * 0.05;
  return (canvasWidth - blockWidth) / 2;
}

function getInlineOffset(width: number, textWidth: number, alignment: CaptionStyle['alignment']) {
  if (alignment === 'right') return width - textWidth;
  if (alignment === 'center') return (width - textWidth) / 2;
  return 0;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function measureWithFont(ctx: CanvasRenderingContext2D, text: string, font: string) {
  const previousFont = ctx.font;
  ctx.font = font;
  const width = ctx.measureText(text).width;
  ctx.font = previousFont;
  return width;
}

function hexToRgb(hex: string): string {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
