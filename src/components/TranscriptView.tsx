// CutFlow AI — TranscriptView Component
// Enhanced with word-level selection, batch range deletion,
// filler word detection, and visual EDL status indicators.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTimeline } from '@/context/TimelineContext';
import { isFillerWord, findFillerRanges } from '@/lib/filler-words';
import LanguageSelector from './LanguageSelector';

// ─── Types ────────────────────────────────────────────────────

interface TranscriptWord {
  id: string;
  word: string;
  start: number;
  end: number;
  importance?: number;
}

interface TranscriptSegmentBlock {
  id: string;
  speaker?: string;
  words: TranscriptWord[];
}

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

// ─── SVG Icons ────────────────────────────────────────────────

function TrashIcon() { return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>); }
function EraserIcon() { return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14.6 1.6c.8-.8 2-.8 2.8 0L21 5.2c.8.8.8 2 0 2.8L12 17"/><path d="M6 11l4 4"/></svg>); }
function SparklesIcon() { return (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/><path d="M18 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/><path d="M6 14l-1 2-2 1 2 1 1 2 1-2 2-1-2-1-1-2z"/></svg>); }

// ─────────────────────────────────────────────────────────────

interface TranscriptViewProps {
  transcript?: TranscriptSegmentBlock[];
}

export default function TranscriptView({ transcript: externalTranscript }: TranscriptViewProps) {
  const { state, deleteRange, transcript: globalTranscript, isTranscribing } = useTimeline();
  const activeWordRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Selection state
  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);

  // Build flat word list from props or global context
  const rawWords = useMemo(() => {
    if (externalTranscript) return externalTranscript.flatMap(s => s.words);
    return globalTranscript.map((w, i) => ({ id: `w${i}`, word: w.text, start: w.start, end: w.end }));
  }, [externalTranscript, globalTranscript]);

  // Group into display segments
  const segments = useMemo(() => {
    if (!rawWords.length) return [];
    const chunks: TranscriptSegmentBlock[] = [];
    for (let i = 0; i < rawWords.length; i += 15) {
      chunks.push({
        id: `seg-${i}`,
        speaker: 'Speaker',
        words: rawWords.slice(i, Math.min(i + 15, rawWords.length)),
      });
    }
    return chunks;
  }, [rawWords]);

  // Active word tracking
  const activeWord = useMemo(() => {
    const t = state.current_time;
    return rawWords.find((w) => t >= w.start && t < w.end) ?? null;
  }, [state.current_time, rawWords]);

  // Auto-scroll to active word
  useEffect(() => {
    if (activeWordRef.current && panelRef.current) {
      const wordEl = activeWordRef.current;
      wordEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeWord]);

  // ── Word click / selection logic ──
  const handleWordClick = useCallback((word: TranscriptWord, event: React.MouseEvent) => {
    if (event.shiftKey && lastClickedId) {
      // Range selection with Shift+click
      const allIds = rawWords.map(w => w.id);
      const lastIdx = allIds.indexOf(lastClickedId);
      const currentIdx = allIds.indexOf(word.id);
      if (lastIdx !== -1 && currentIdx !== -1) {
        const [start, end] = lastIdx < currentIdx ? [lastIdx, currentIdx] : [currentIdx, lastIdx];
        const rangeIds = new Set(allIds.slice(start, end + 1));
        setSelectedWordIds(prev => {
          const next = new Set(prev);
          rangeIds.forEach(id => next.add(id));
          return next;
        });
      }
    } else if (event.ctrlKey || event.metaKey) {
      // Toggle individual word
      setSelectedWordIds(prev => {
        const next = new Set(prev);
        if (next.has(word.id)) next.delete(word.id);
        else next.add(word.id);
        return next;
      });
    } else {
      // Single select
      setSelectedWordIds(new Set([word.id]));
    }
    setLastClickedId(word.id);
  }, [lastClickedId, rawWords]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedWordIds(new Set());
    setLastClickedId(null);
  }, []);

  // ── Delete selected word range ──
  const deleteSelectedRange = useCallback(async () => {
    if (selectedWordIds.size === 0) return;

    const selectedWords = rawWords.filter(w => selectedWordIds.has(w.id));
    if (selectedWords.length === 0) return;

    const minStart = Math.min(...selectedWords.map(w => w.start));
    const maxEnd = Math.max(...selectedWords.map(w => w.end));
    const pad = 0.05;

    await deleteRange(
      Math.max(0, minStart - pad),
      maxEnd + pad
    );

    clearSelection();
  }, [selectedWordIds, rawWords, deleteRange, clearSelection]);

  // ── Remove all filler words ──
  const removeAllFillers = useCallback(async () => {
    const ranges = findFillerRanges(rawWords.map(w => ({ text: w.word, start: w.start, end: w.end })));

    // Process from end to start to avoid offset issues
    const sorted = [...ranges].sort((a, b) => b.start - a.start);
    for (const range of sorted) {
      await deleteRange(range.start, range.end);
    }
  }, [rawWords, deleteRange]);

  // ── Keyboard shortcut ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWordIds.size > 0) {
        deleteSelectedRange();
      }
      if (e.key === 'Escape') {
        clearSelection();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedWordIds, deleteSelectedRange, clearSelection]);

  return (
    <aside className="transcript-panel" id="transcript-panel" aria-label="Transcript">
      {/* Header */}
      <div className="transcript-panel__header">
        <span className="sidebar__section-title" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          Transcript
        </span>
        <span style={{ fontSize: 10, color: 'var(--teal-primary)', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }} aria-live="polite">
          {formatTimestamp(state.current_time)}
        </span>
      </div>

      {/* Action Bar */}
      <div style={{ display: 'flex', gap: 4, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
        <button
          className="btn-icon"
          onClick={deleteSelectedRange}
          disabled={selectedWordIds.size === 0}
          title={`Delete selected (${selectedWordIds.size} word${selectedWordIds.size !== 1 ? 's' : ''}) [Delete]`}
          style={{ opacity: selectedWordIds.size === 0 ? 0.4 : 1 }}
          aria-label={`Delete ${selectedWordIds.size} selected words`}
        >
          <TrashIcon />
        </button>
        <button
          className="btn-icon"
          onClick={removeAllFillers}
          disabled={rawWords.length === 0}
          title="Remove all filler words (um, uh, like...)"
          aria-label="Remove all filler words"
        >
          <EraserIcon />
        </button>
        {selectedWordIds.size > 0 && (
          <button
            className="btn-icon"
            onClick={clearSelection}
            title="Clear selection (Escape)"
            style={{ marginLeft: 'auto' }}
            aria-label="Clear selection"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
        {selectedWordIds.size > 0 && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center', marginLeft: 4 }}>
            {selectedWordIds.size} selected
          </span>
        )}
      </div>

      {/* Language selector */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
        <LanguageSelector />
      </div>

      {/* Body */}
      <div ref={panelRef} className="transcript-panel__body" id="transcript-body">
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

        {!isTranscribing && rawWords.length === 0 && (
          <div style={{ padding: '20px 10px', textAlign: 'center' }}>
            <SparklesIcon />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
              Load a video to generate an AI transcript.<br />
              Then click words to select and cut ranges.<br />
              <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>
                Shift+click for range · Ctrl+click to toggle
              </span>
            </p>
          </div>
        )}

        {segments.map((seg) => (
          <div key={seg.id} style={{ marginBottom: 16 }}>
            {seg.speaker && (
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--teal-primary)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--teal-primary)', display: 'inline-block', flexShrink: 0 }} aria-hidden="true" />
                {seg.speaker}
              </div>
            )}

            <div className="transcript-word-block">
              {seg.words.map((word) => {
                const isActive = activeWord?.id === word.id;
                const isDeleted = isWordDeleted(word, state.edl);
                const isSelected = selectedWordIds.has(word.id);
                const isFiller = isFillerWord(word.word);

                return (
                  <span
                    key={word.id}
                    ref={isActive ? activeWordRef : null}
                    className={`edl-word${isActive ? ' active' : ''}${isDeleted ? ' deleted' : ''}${isSelected ? ' selected' : ''}`}
                    title={`${formatTimestamp(word.start)} → ${formatTimestamp(word.end)}${isFiller ? ' (filler)' : ''}\n${isDeleted ? 'Already cut from timeline' : 'Click to select, Delete to cut'}`}
                    onClick={(e) => handleWordClick(word, e)}
                    onDoubleClick={() => {
                      if (selectedWordIds.size <= 1) {
                        // Single word: delete it immediately
                        const pad = 0.05;
                        deleteRange(Math.max(0, word.start - pad), word.end + pad);
                      } else {
                        // Multiple selected: batch delete
                        deleteSelectedRange();
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleWordClick(word, e as any);
                    }}
                    style={{
                      color: isDeleted ? 'var(--text-subtle)' : isFiller && !isDeleted ? 'var(--text-muted)' : undefined,
                      textDecoration: isDeleted ? 'line-through' : undefined,
                      background: isSelected ? 'rgba(239, 68, 68, 0.2)' : isActive ? 'rgba(20, 184, 166, 0.15)' : undefined,
                      borderBottom: isFiller && !isDeleted ? '1px dashed var(--text-subtle)' : undefined,
                      cursor: 'pointer',
                      borderRadius: 2,
                      padding: '0 1px',
                      transition: 'all 0.1s',
                    }}
                  >
                    {word.word}{' '}
                  </span>
                );
              })}
            </div>

            <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
              {formatTimestamp(seg.words[0]?.start ?? 0)} → {formatTimestamp(seg.words[seg.words.length - 1]?.end ?? 0)}
            </div>
          </div>
        ))}

        <div className="transcript-hint">
          <strong style={{ color: 'var(--text-muted)' }}>Tip:</strong>{' '}
          Click to select words, then press <kbd style={{ background: 'var(--panel)', padding: '1px 4px', borderRadius: 3, border: '1px solid var(--border)' }}>Delete</kbd> to cut.
          Shift+click for range. <kbd style={{ background: 'var(--panel)', padding: '1px 4px', borderRadius: 3, border: '1px solid var(--border)' }}>Esc</kbd> to deselect.
        </div>
      </div>
    </aside>
  );
}
