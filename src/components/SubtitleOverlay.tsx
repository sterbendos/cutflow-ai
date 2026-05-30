import { useMemo } from 'react';
import { useTimeline } from '../context/TimelineContext';
import { useCaption, getBgCss } from '../context/CaptionContext';

interface SubtitleOverlayProps {
  visible: boolean;
}

export default function SubtitleOverlay({ visible }: SubtitleOverlayProps) {
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

  const bgCss = getBgCss(style);
  const bgStyle: React.CSSProperties = style.bgOpacity > 0
    ? {
        background: bgCss,
        borderRadius: `${style.bgRadius}px`,
        padding: '4px 12px',
      }
    : {};

  const animClass = style.animation !== 'none' ? `caption-anim-${style.animation}` : '';

  return (
    <div
      style={{
        position: 'absolute',
        bottom: style.position === 'bottom' ? '40px' : 'auto',
        top: style.position === 'top' ? '20px' : 'auto',
        left: `${(100 - style.maxWidth) / 2}%`,
        width: `${style.maxWidth}%`,
        textAlign: style.alignment,
        pointerEvents: 'none',
        zIndex: 50,
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
        {renderWord(activeSubtitle.text, style)}
      </div>
    </div>
  );
}

function renderWord(text: string, style: ReturnType<typeof useCaption>['style']) {
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

  return (
    <>
      {words.map((word, i) => {
        const clean = word.toLowerCase().replace(/[^a-z0-9]/g, '');
        const isImportant = clean.length > 3 && !stopwords.has(clean);

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
                color: '#14b8a6',
                textShadow: '0 0 10px rgba(20, 184, 166, 0.5)',
                transition: 'color 0.1s',
              }}
            >
              {word}{' '}
            </span>
          );
        }

        if (style.wordStyle === 'gradient' && isImportant) {
          return (
            <span
              key={i}
              style={{
                background: 'linear-gradient(135deg, #14b8a6, #0ea5e9)',
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
