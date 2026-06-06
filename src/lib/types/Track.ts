import { AudioSegment, BRollSegment } from '@/context/TimelineContext';

export type TrackType = 'video' | 'audio' | 'b-roll' | 'text' | 'adjustment';

export interface BaseTrack {
  id: string;
  name: string;
  type: TrackType;
  isMuted: boolean;
  isHidden: boolean;
  opacity: number; // 0.0 to 1.0
  order: number; // For z-index and vertical ordering in the timeline
}

export interface VideoTrack extends BaseTrack {
  type: 'video';
  // Video-specific properties
}

export interface AudioTrack extends BaseTrack {
  type: 'audio';
  segments: AudioSegment[];
}

export interface BRollTrack extends BaseTrack {
  type: 'b-roll';
  segments: BRollSegment[];
}

export interface TextTrack extends BaseTrack {
  type: 'text';
  // Text segments
}

export interface AdjustmentTrack extends BaseTrack {
  type: 'adjustment';
  // Adjustment layers
}

export type TimelineTrack = VideoTrack | AudioTrack | BRollTrack | TextTrack | AdjustmentTrack;
