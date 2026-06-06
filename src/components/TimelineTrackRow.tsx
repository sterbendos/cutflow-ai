import React, { useMemo } from 'react';
import { TimelineTrack, BRollTrack, AudioTrack } from '@/lib/types/Track';
import { useTimeline, BRollSegment, AudioSegment } from '@/context/TimelineContext';
import AudioWaveform from './AudioWaveform';

interface TimelineTrackRowProps {
  track: TimelineTrack;
  timeToPct: (t: number) => number;
  draggingBRollId?: string | null;
  selectedBRollId?: string | null;
  onSegmentMouseDown?: (e: React.MouseEvent, trackId: string, segmentId: string, start: number) => void;
}

export default function TimelineTrackRow({
  track,
  timeToPct,
  draggingBRollId,
  selectedBRollId,
  onSegmentMouseDown
}: TimelineTrackRowProps) {
  const { removeBRollSegment, removeAudioSegment } = useTimeline();

  // Dynamic colors and heights based on type
  const trackStyle = useMemo(() => {
    switch (track.type) {
      case 'b-roll': return { height: 32, bg: 'rgba(0,0,0,0.1)' };
      case 'audio': return { height: 32, bg: 'transparent' };
      default: return { height: 32, bg: 'transparent' };
    }
  }, [track.type]);

  return (
    <div className="timeline-track" style={{ height: trackStyle.height, background: trackStyle.bg }}>
      <span
        className="timeline-track__label"
        aria-label={`${track.name} track`}
        style={{ position: 'sticky', left: 0, zIndex: 10, fontSize: 9 }}
      >
        {track.name.toUpperCase()}
      </span>
      <div
        className="timeline-track__rail"
        style={{ cursor: 'default' }}
        aria-label={`${track.name} timeline`}
      >
        {track.type === 'b-roll' && (track as BRollTrack).segments.map((seg: BRollSegment) => {
          const leftPct = timeToPct(seg.start);
          const widthPct = timeToPct(seg.start + seg.duration) - leftPct;
          const isSelected = selectedBRollId === seg.id;
          const isDragging = draggingBRollId === seg.id;

          return (
            <div
              key={seg.id}
              style={{
                position: 'absolute',
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                height: '80%',
                top: '10%',
                opacity: track.isHidden ? 0 : (track.opacity ?? 1) * 0.9,
                cursor: isDragging ? 'grabbing' : 'grab',
                background: isSelected ? '#14b8a6' : '#0891b2',
                border: isSelected ? '2px solid #fff' : '1px solid rgba(0,0,0,0.3)',
                boxShadow: isSelected ? '0 0 0 2px var(--teal-primary)' : 'none',
                borderRadius: '3px',
                display: 'flex',
                alignItems: 'center',
                padding: '0 4px',
                fontSize: '10px',
                color: '#fff',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                zIndex: isDragging ? 20 : isSelected ? 10 : 1,
                transition: 'background 0.1s ease, border 0.1s ease',
              }}
              title="Click to select, drag to move, double-click to remove. Shift+Click to split."
              onMouseDown={(e) => onSegmentMouseDown?.(e, track.id, seg.id, seg.start)}
              onDoubleClick={() => removeBRollSegment(seg.id)}
            >
              {seg.name}
            </div>
          );
        })}

        {track.type === 'audio' && (track as AudioTrack).segments.map((seg: AudioSegment) => {
          const leftPct = timeToPct(seg.start);
          const widthPct = timeToPct(seg.start + seg.duration) - leftPct;
          const color = seg.type === 'music' ? '#8b5cf6' : seg.type === 'voice' ? '#ec4899' : '#14b8a6';
          
          return (
            <div
              key={seg.id}
              style={{
                position: 'absolute',
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                background: color,
                border: '1px solid rgba(0,0,0,0.3)',
                borderRadius: '3px',
                height: '80%',
                top: '10%',
                opacity: track.isHidden ? 0 : (track.opacity ?? 1) * 0.8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '0 4px',
                fontSize: '10px',
                color: '#fff',
                overflow: 'hidden',
                whiteSpace: 'nowrap'
              }}
              title="Double-click to delete. Shift+Click to split."
              onMouseDown={(e) => onSegmentMouseDown?.(e, track.id, seg.id, seg.start)}
              onDoubleClick={() => removeAudioSegment(seg.id)}
            >
              <span style={{ position: 'relative', zIndex: 2 }}>{seg.type.toUpperCase()}</span>
              <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
                <AudioWaveform filePath={seg.path} start={0} duration={seg.duration} color="#ffffff" />
              </div>
            </div>
          );
        })}

        <div
          className="timeline-playhead"
          style={{ left: 'var(--playhead-pct, 0%)', opacity: 0.5 }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
