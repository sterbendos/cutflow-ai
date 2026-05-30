import { useMemo } from 'react';
import { useTimeline } from '../context/TimelineContext';
import { useMotionGraphics, MotionGraphicsItem } from '../context/MotionGraphicsContext';

export default function MotionGraphicsOverlay() {
  const { state } = useTimeline();
  const { items } = useMotionGraphics();

  const activeItems = useMemo(() => {
    const t = state.current_time;
    return items.filter((item) => t >= item.startTime && t <= item.endTime);
  }, [items, state.current_time]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
        zIndex: 40,
        overflow: 'hidden',
      }}
    >
      {activeItems.map((item) => (
        <MotionGraphicItem key={item.id} item={item} />
      ))}
    </div>
  );
}

function MotionGraphicItem({ item }: { item: MotionGraphicsItem }) {
  const animClass = `mg-anim-${item.animation}`;

  if (item.type === 'lower-third') {
    return <LowerThird item={item} animClass={animClass} />;
  }

  if (item.type === 'title') {
    return <TitleCard item={item} animClass={animClass} />;
  }

  return <TextOverlayItem item={item} animClass={animClass} />;
}

function LowerThird({ item, animClass }: { item: MotionGraphicsItem; animClass: string }) {
  const baseFont = { fontFamily: item.fontFamily, color: item.fontColor };

  return (
    <div
      className={animClass}
      style={{
        position: 'absolute',
        left: `${item.positionX}%`,
        top: `${item.positionY}%`,
        transform: item.positionX > 50 ? 'translateX(-100%)' : 'translateX(0)',
      }}
    >
      {/* Background bar */}
      <div
        style={{
          background: item.bgOpacity > 0
            ? `rgba(${hexToRgb(item.bgColor)}, ${item.bgOpacity})`
            : 'transparent',
          padding: '10px 20px 10px 16px',
          borderRadius: '0 4px 4px 0',
          borderLeft: `4px solid ${item.accentColor}`,
          maxWidth: '60vw',
        }}
      >
        <div style={{ ...baseFont, fontSize: `${item.fontSize}px`, fontWeight: item.fontWeight, lineHeight: 1.3 }}>
          {item.text}
        </div>
        {item.subtitle && (
          <div
            style={{
              ...baseFont,
              fontSize: `${Math.max(12, item.fontSize - 6)}px`,
              fontWeight: 400,
              opacity: 0.8,
              marginTop: 2,
            }}
          >
            {item.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

function TitleCard({ item, animClass }: { item: MotionGraphicsItem; animClass: string }) {
  const baseFont = { fontFamily: item.fontFamily, color: item.fontColor };

  return (
    <div
      className={animClass}
      style={{
        position: 'absolute',
        left: `${item.positionX}%`,
        top: `${item.positionY}%`,
        transform: 'translate(-50%, -50%)',
        textAlign: 'center',
        width: '80%',
        maxWidth: '800px',
      }}
    >
      {/* Accent line */}
      <div
        style={{
          width: '60px',
          height: '3px',
          background: item.accentColor,
          margin: '0 auto 16px auto',
          borderRadius: '2px',
        }}
      />

      <div style={{ ...baseFont, fontSize: `${item.fontSize}px`, fontWeight: item.fontWeight, lineHeight: 1.2, letterSpacing: '-0.01em' }}>
        {item.text}
      </div>

      {item.subtitle && (
        <div
          style={{
            ...baseFont,
            fontSize: `${Math.max(14, item.fontSize * 0.5)}px`,
            fontWeight: 400,
            opacity: 0.7,
            marginTop: 12,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          {item.subtitle}
        </div>
      )}
    </div>
  );
}

function TextOverlayItem({ item, animClass }: { item: MotionGraphicsItem; animClass: string }) {
  const baseFont = { fontFamily: item.fontFamily, color: item.fontColor };
  const isCentered = item.positionX === 50;

  return (
    <div
      className={animClass}
      style={{
        position: 'absolute',
        left: `${item.positionX}%`,
        top: `${item.positionY}%`,
        transform: isCentered ? 'translateX(-50%)' : 'translateX(0)',
        background: item.bgOpacity > 0
          ? `rgba(${hexToRgb(item.bgColor)}, ${item.bgOpacity})`
          : 'transparent',
        padding: item.bgOpacity > 0 ? '8px 14px' : '0',
        borderRadius: '4px',
        maxWidth: '70vw',
      }}
    >
      <div style={{ ...baseFont, fontSize: `${item.fontSize}px`, fontWeight: item.fontWeight, lineHeight: 1.4 }}>
        {item.text}
      </div>
      {item.subtitle && (
        <div style={{ ...baseFont, fontSize: `${Math.max(11, item.fontSize - 4)}px`, fontWeight: 400, opacity: 0.7, marginTop: 2 }}>
          {item.subtitle}
        </div>
      )}
    </div>
  );
}

function hexToRgb(hex: string): string {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}
