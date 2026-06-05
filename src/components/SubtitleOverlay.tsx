import { useMemo } from 'react';
import { useTimeline } from '../context/TimelineContext';
import { useCaption, getBgCss } from '../context/CaptionContext';
import type { SubtitlePlacement } from '../hooks/useFaceDetection';

interface SubtitleOverlayProps {
  visible: boolean;
  /** When provided by face detection, overrides the style's position setting */
  dynamicPosition?: SubtitlePlacement;
}

export default function SubtitleOverlay({ visible, dynamicPosition }: SubtitleOverlayProps) {
  const { state, transcript } = useTimeline();
  const { style } = useCaption();

  const activeSubtitle = useMemo(() => {
    if (!visible || !transcript.length) return null;

    const t = state.current_time;
    let activeIndex = transcript.findIndex((w) => t >= w.start && t <= w.end + 0.5);

    if (activeIndex === -1) {
      activeIndex = transcript.findIndex((w) => t >= w.start - 0.2 && t <= w.end + 1.0);
    }

    if (activeIndex === -1) return null;

    return transcript[activeIndex];
  }, [transcript, state.current_time, visible]);

  if (!visible || !activeSubtitle) return null;

  // Resolve the effective position:
  // dynamicPosition (face-aware) takes priority, falls back to style setting
  const effectivePosition: 'top' | 'bottom' = dynamicPosition ?? style.position;

  const bgCss = getBgCss(style);
  const bgStyle: React.CSSProperties = style.bgOpacity > 0
    ? {
        background: bgCss,
        borderRadius: `${style.bgRadius}px`,
        padding: '4px 12px',
      }
    : {};

  const animClass = style.animation !== 'none' ? `caption-anim-${style.animation}` : '';

  // Smooth transition when position changes so text slides rather than snaps
  const positionStyle: React.CSSProperties =
    effectivePosition === 'bottom'
      ? { bottom: '40px', top: 'auto' }
      : { top: '20px', bottom: 'auto' };

  return (
    <div
      style={{
        position: 'absolute',
        ...positionStyle,
        left: `${(100 - style.maxWidth) / 2}%`,
        width: `${style.maxWidth}%`,
        textAlign: style.alignment,
        pointerEvents: 'none',
        zIndex: 50,
        transition: 'top 0.4s ease, bottom 0.4s ease',
      }}
    >
      <div
        className={animClass}
        style={{
          display: 'inline-block',
          fontFamily: style.fontFamily,
          fontSize: `${style.fontSize}px`,
          fontWeight: style.fontWeight,
          color: style.fontColor,
          letterSpacing: `${style.letterSpacing}em`,
          lineHeight: style.lineHeight,
          textShadow: style.textShadow
            ? `0px 2px 4px ${style.shadowColor}, 0px ${style.shadowBlur}px ${style.shadowBlur * 2}px ${style.shadowColor}`
            : 'none',
          textAlign: style.alignment,
          transition: 'all 0.2s ease',
          ...bgStyle,
        }}
      >
        {renderWord(activeSubtitle, style, state.current_time)}
      </div>
    </div>
  );
}

function renderWord(activeSubtitle: any, style: ReturnType<typeof useCaption>['style'], currentTime: number) {
  const text = activeSubtitle.text;
  if (style.wordStyle === 'none') {
    return <span>{text}</span>;
  }

  const words = text.split(/\s+/);
  const stopwords = new Set([
    'the', 'is', 'at', 'which', 'on', 'and', 'a', 'to', 'in', 'that',
    'it', 'of', 'for', 'with', 'as', 'are', 'this', 'but', 'not',
    'we', 'you', 'i', 'they', 'be', 'have', 'do', 'will', 'an', 'my',
    'or', 'so', 'if', 'no', 'up', 'me', 'he', 'she', 'his', 'her',
  ]);

  const chunkDuration = activeSubtitle.end - activeSubtitle.start;
  const wordDuration = chunkDuration / words.length;

  return (
    <>
      {words.map((word: string, i: number) => {
        const clean = word.toLowerCase().replace(/[^a-z0-9]/g, '');
        const isImportant = clean.length > 3 && !stopwords.has(clean);
        
        const wordStart = activeSubtitle.start + i * wordDuration;
        const wordEnd = wordStart + wordDuration;
        const isActive = currentTime >= wordStart && currentTime < wordEnd;

        if (style.wordStyle === 'active-word-crab' && isActive) {
          return (
            <span key={i} style={{ position: 'relative', color: style.highlightColor, textShadow: `0 0 8px ${style.highlightColor}99`, fontWeight: 900 }}>
              <span style={{ position: 'absolute', top: '-1.2em', left: '50%', transform: 'translateX(-50%)', animation: 'bounce 0.4s infinite alternate' }}>
                <ClaudeCrab color={style.highlightColor} />
              </span>
              {word}{' '}
            </span>
          );
        }

        if (style.wordStyle === 'active-word-color' && isActive) {
          return (
            <span key={i} style={{ color: style.highlightColor, textShadow: `0 0 10px ${style.highlightColor}99` }}>
              {word}{' '}
            </span>
          );
        }

        if (style.wordStyle === 'bold-keywords' && isImportant) {
          return (
            <span key={i} style={{ fontWeight: Math.min(style.fontWeight + 200, 900), color: style.fontColor }}>
              {word}{' '}
            </span>
          );
        }

        if (style.wordStyle === 'teal-highlight' && isImportant) {
          return (
            <span
              key={i}
              style={{
                color: style.highlightColor,
                textShadow: `0 0 10px ${style.highlightColor}80`,
                transition: 'color 0.1s',
              }}
            >
              {word}{' '}
            </span>
          );
        }

        if (style.wordStyle === 'gradient' && isImportant) {
          // Build a gradient from highlightColor to a shifted hue
          return (
            <span
              key={i}
              style={{
                background: `linear-gradient(135deg, ${style.highlightColor}, #0ea5e9)`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {word}{' '}
            </span>
          );
        }

        return <span key={i}>{word} </span>;
      })}
    </>
  );
}

const ClaudeCrab = ({ className, color = '#ff7b72' }: { className?: string, color?: string }) => (
  <svg className={className} viewBox="0 0 10 7" fill={color} style={{ width: '1.2em', height: '0.84em', display: 'block' }}>
    <rect x="2" y="0" width="1" height="1" />
    <rect x="7" y="0" width="1" height="1" />
    <rect x="1" y="1" width="8" height="1" />
    <rect x="0" y="2" width="10" height="1" />
    <rect x="0" y="3" width="10" height="1" />
    <rect x="1" y="4" width="8" height="1" />
    <rect x="2" y="5" width="1" height="1" />
    <rect x="4" y="5" width="1" height="1" />
    <rect x="5" y="5" width="1" height="1" />
    <rect x="7" y="5" width="1" height="1" />
    <rect x="2" y="6" width="1" height="1" />
    <rect x="7" y="6" width="1" height="1" />
  </svg>
);
