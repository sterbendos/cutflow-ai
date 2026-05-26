// CutFlow AI — TranscriptView Component
// 320px docked dialogue pane with word-level timestamp rendering,
// active word highlight synced to playhead via currentTime,
// and double-click to delete that word's time range.

import { useEffect, useMemo, useRef } from 'react';
import { useTimeline } from '@/context/TimelineContext';

// ─── Types ────────────────────────────────────────────────────

export interface TranscriptWord {
  id: string;
  word: string;
  start: number; // seconds
  end: number;   // seconds
}

export interface TranscriptSegmentBlock {
  id: string;
  speaker?: string;
  words: TranscriptWord[];
}

// ─── Sample Transcript ────────────────────────────────────────
// Realistic multi-speaker sample. Real Whisper data drops in here.

const SAMPLE_TRANSCRIPT: TranscriptSegmentBlock[] = [
  {
    id: 'seg-1',
    speaker: 'Host',
    words: [
      { id: 'w1',  word: 'Welcome',   start: 0.2,  end: 0.6  },
      { id: 'w2',  word: 'to',        start: 0.65, end: 0.8  },
      { id: 'w3',  word: 'CutFlow',   start: 0.85, end: 1.3  },
      { id: 'w4',  word: 'AI,',       start: 1.35, end: 1.7  },
      { id: 'w5',  word: 'the',       start: 1.8,  end: 1.95 },
      { id: 'w6',  word: 'local-first', start: 2.0, end: 2.6 },
      { id: 'w7',  word: 'video',     start: 2.65, end: 2.95 },
      { id: 'w8',  word: 'editor',    start: 3.0,  end: 3.45 },
      { id: 'w9',  word: 'powered',   start: 3.5,  end: 3.9  },
      { id: 'w10', word: 'by',        start: 3.95, end: 4.1  },
      { id: 'w11', word: 'AI.',       start: 4.15, end: 4.6  },
    ],
  },
  {
    id: 'seg-2',
    speaker: 'Host',
    words: [
      { id: 'w12', word: "Today",     start: 5.2,  end: 5.55 },
      { id: 'w13', word: "we're",     start: 5.6,  end: 5.85 },
      { id: 'w14', word: "going",     start: 5.9,  end: 6.1  },
      { id: 'w15', word: "to",        start: 6.15, end: 6.25 },
      { id: 'w16', word: "show",      start: 6.3,  end: 6.55 },
      { id: 'w17', word: "you",       start: 6.6,  end: 6.75 },
      { id: 'w18', word: "how",       start: 6.8,  end: 6.95 },
      { id: 'w19', word: "the",       start: 7.0,  end: 7.1  },
      { id: 'w20', word: "silence",   start: 7.15, end: 7.5  },
      { id: 'w21', word: "detection", start: 7.55, end: 8.1  },
      { id: 'w22', word: "works",     start: 8.15, end: 8.5  },
      { id: 'w23', word: "in",        start: 8.55, end: 8.65 },
      { id: 'w24', word: "real-time.", start: 8.7, end: 9.3  },
    ],
  },
  {
    id: 'seg-3',
    speaker: 'Host',
    words: [
      { id: 'w25', word: 'Double-click', start: 10.1, end: 10.7 },
      { id: 'w26', word: 'any',          start: 10.75, end: 10.95 },
      { id: 'w27', word: 'word',         start: 11.0,  end: 11.3  },
      { id: 'w28', word: 'to',           start: 11.35, end: 11.5  },
      { id: 'w29', word: 'instantly',    start: 11.55, end: 12.0  },
      { id: 'w30', word: 'cut',          start: 12.05, end: 12.3  },
      { id: 'w31', word: 'that',         start: 12.35, end: 12.5  },
      { id: 'w32', word: 'segment',      start: 12.55, end: 12.95 },
      { id: 'w33', word: 'from',         start: 13.0,  end: 13.2  },
      { id: 'w34', word: 'your',         start: 13.25, end: 13.45 },
      { id: 'w35', word: 'timeline.',    start: 13.5,  end: 14.0  },
    ],
  },
  {
    id: 'seg-4',
    speaker: 'Host',
    words: [
      { id: 'w36', word: 'The',         start: 15.0,  end: 15.15 },
      { id: 'w37', word: 'export',      start: 15.2,  end: 15.6  },
      { id: 'w38', word: 'engine',      start: 15.65, end: 16.0  },
      { id: 'w39', word: 'uses',        start: 16.05, end: 16.3  },
      { id: 'w40', word: 'FFmpeg',      start: 16.35, end: 16.8  },
      { id: 'w41', word: 'to',          start: 16.85, end: 16.95 },
      { id: 'w42', word: 'generate',    start: 17.0,  end: 17.5  },
      { id: 'w43', word: 'a',           start: 17.55, end: 17.65 },
      { id: 'w44', word: 'lossless',    start: 17.7,  end: 18.15 },
      { id: 'w45', word: 'filtergraph', start: 18.2,  end: 18.9  },
      { id: 'w46', word: 'cut.',        start: 18.95, end: 19.4  },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────

function formatTimestamp(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(1);
  return `${m}:${parseFloat(s).toFixed(1).padStart(4, '0')}`;
}

function isWordDeleted(word: TranscriptWord, edl: ReturnType<typeof useTimeline>['state']['edl']): boolean {
  return edl.some(
    (seg) =>
      (seg.segment_type === 'user-deleted' || seg.segment_type === 'silence') &&
      word.start >= seg.start &&
      word.end <= seg.end
  );
}

// ─────────────────────────────────────────────────────────────

interface TranscriptViewProps {
  /** Optional external transcript data (e.g., from Whisper output) */
  transcript?: TranscriptSegmentBlock[];
}

export default function TranscriptView({ transcript }: TranscriptViewProps) {
  const { state, deleteRange } = useTimeline();
  const activeWordRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const segments = transcript ?? SAMPLE_TRANSCRIPT;

  // ── Build a flat word list for active word lookup ──────────
  const allWords = useMemo(
    () => segments.flatMap((s) => s.words),
    [segments]
  );

  // ── Find the currently active word based on currentTime ───
  const activeWord = useMemo(() => {
    const t = state.current_time;
    return allWords.find((w) => t >= w.start && t < w.end) ?? null;
  }, [state.current_time, allWords]);

  // ── Auto-scroll to keep active word visible ───────────────
  useEffect(() => {
    if (activeWordRef.current && panelRef.current) {
      const panel = panelRef.current;
      const wordEl = activeWordRef.current;
      const wordTop = wordEl.offsetTop;
      const wordBottom = wordTop + wordEl.offsetHeight;
      const panelTop = panel.scrollTop;
      const panelBottom = panelTop + panel.clientHeight;

      if (wordTop < panelTop + 40 || wordBottom > panelBottom - 40) {
        wordEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeWord]);

  // ── Double-click handler: delete the word's time range ────
  async function handleWordDoubleClick(word: TranscriptWord) {
    // Add a small pad around the word for clean cuts
    const pad = 0.05;
    await deleteRange(
      Math.max(0, word.start - pad),
      word.end + pad
    );
  }

  return (
    <aside
      className="transcript-panel"
      id="transcript-panel"
      aria-label="Transcript"
    >
      {/* Header */}
      <div className="transcript-panel__header">
        <span
          className="sidebar__section-title"
          style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}
        >
          Transcript
        </span>
        <span
          style={{
            fontSize: 10,
            color: 'var(--teal-primary)',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 500,
          }}
          aria-live="polite"
          aria-label={`Current time: ${formatTimestamp(state.current_time)}`}
        >
          {formatTimestamp(state.current_time)}
        </span>
      </div>

      {/* Body */}
      <div
        ref={panelRef}
        className="transcript-panel__body"
        id="transcript-body"
      >
        {segments.map((seg) => (
          <div
            key={seg.id}
            style={{ marginBottom: 16 }}
          >
            {/* Speaker label */}
            {seg.speaker && (
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--teal-primary)',
                  marginBottom: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--teal-primary)',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                />
                {seg.speaker}
              </div>
            )}

            {/* Words */}
            <div className="transcript-word-block" aria-label={`${seg.speaker ?? 'Speaker'}: ${seg.words.map(w => w.word).join(' ')}`}>
              {seg.words.map((word) => {
                const isActive = activeWord?.id === word.id;
                const isDeleted = isWordDeleted(word, state.edl);

                return (
                  <span
                    key={word.id}
                    id={`word-${word.id}`}
                    ref={isActive ? activeWordRef : null}
                    className={`transcript-word${isActive ? ' active' : ''}${isDeleted ? ' deleted' : ''}`}
                    title={`${formatTimestamp(word.start)} → ${formatTimestamp(word.end)}\nDouble-click to cut`}
                    aria-label={`${word.word}, ${formatTimestamp(word.start)}`}
                    onDoubleClick={() => handleWordDoubleClick(word)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Delete' || e.key === 'Backspace') {
                        handleWordDoubleClick(word);
                      }
                    }}
                  >
                    {word.word}{' '}
                  </span>
                );
              })}
            </div>

            {/* Block timestamp */}
            <div
              style={{
                marginTop: 4,
                fontSize: 10,
                color: 'var(--text-subtle)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatTimestamp(seg.words[0]?.start ?? 0)} →{' '}
              {formatTimestamp(seg.words[seg.words.length - 1]?.end ?? 0)}
            </div>
          </div>
        ))}

        {/* Usage hint */}
        <div className="transcript-hint">
          <strong style={{ color: 'var(--text-muted)' }}>Tip:</strong>{' '}
          Double-click any word to cut that range from the timeline.
          Press <kbd style={{ background: 'var(--panel)', padding: '1px 4px', borderRadius: 3, border: '1px solid var(--border)' }}>Delete</kbd> on a focused word to do the same.
        </div>
      </div>
    </aside>
  );
}
