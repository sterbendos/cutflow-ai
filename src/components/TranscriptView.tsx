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

// ─── Real AI Transcript ────────────────────────────────────────
// Loaded dynamically from TimelineContext via transformers.js whisper

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

export default function TranscriptView({ transcript: externalTranscript }: TranscriptViewProps) {
  const { state, deleteRange, transcript: globalTranscript, isTranscribing } = useTimeline();
  const activeWordRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Use the local component transcript prop or the global Context state
  const rawWords = useMemo(() => {
    if (externalTranscript) return externalTranscript.flatMap(s => s.words);
    return globalTranscript.map((w, i) => ({ id: `w${i}`, word: w.text, start: w.start, end: w.end }));
  }, [externalTranscript, globalTranscript]);

  const segments = useMemo(() => {
    if (!rawWords.length) return [];
    // Group words into arbitrary 15-word chunks or block sentences for the UI
    const chunks: TranscriptSegmentBlock[] = [];
    for (let i = 0; i < rawWords.length; i += 15) {
      chunks.push({
        id: `seg-${i}`,
        speaker: 'Speaker',
        words: rawWords.slice(i, i + 15),
      });
    }
    return chunks;
  }, [rawWords]);

  const allWords = rawWords;

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
        {isTranscribing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal-primary)" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
              </path>
            </svg>
            <span style={{ fontSize: 12, color: 'var(--teal-primary)', fontWeight: 500 }}>AI Transcription in progress...</span>
          </div>
        )}

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
