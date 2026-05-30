// CutFlow AI — Header Component
// 48px top bar: brand left, project name center, actions right.

import { useState } from 'react';
import { useTimeline } from '@/context/TimelineContext';
import ExportDialog from './ExportDialog';
import { motion } from 'framer-motion';

// ─── SVG Icon helpers (inline, no external icon dep) ──────────

function ScissorsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
      <line x1="20" y1="4" x2="8.12" y2="15.88"/>
      <line x1="14.47" y1="14.48" x2="20" y2="20"/>
      <line x1="8.12" y1="8.12" x2="12" y2="12"/>
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────

export default function Header() {
  const { state, undo, redo, canUndo, canRedo } = useTimeline();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const hasVideo = Boolean(state.source_video_path);

  const projectName = hasVideo
    ? state.source_video_path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Untitled'
    : 'Untitled Project';

  return (
    <header className="header" role="banner">
      {/* Brand */}
      <div className="header__brand">
        <div className="header__logo" aria-hidden="true">
          <ScissorsIcon />
        </div>
        <span className="header__title">CutFlow</span>
        <span className="header__subtitle" style={{ color: 'var(--teal-primary)', fontWeight: 600 }}>AI</span>
      </div>

      {/* Project name badge */}
      <div className="header__project-name" aria-label="Project name">
        {projectName}
      </div>

      {/* Actions */}
      <div className="header__actions">
        <motion.button
          id="btn-undo"
          className="btn-icon"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          disabled={!canUndo}
          onClick={undo}
          whileTap={canUndo ? { scale: 0.85 } : {}}
          animate={{ opacity: canUndo ? 1 : 0.4 }}
        >
          <UndoIcon />
        </motion.button>

        <motion.button
          id="btn-redo"
          className="btn-icon"
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
          disabled={!canRedo}
          onClick={redo}
          whileTap={canRedo ? { scale: 0.85 } : {}}
          animate={{ opacity: canRedo ? 1 : 0.4 }}
        >
          <RedoIcon />
        </motion.button>

        <div
          style={{
            width: 1,
            height: 20,
            background: 'var(--border)',
            margin: '0 4px',
          }}
          aria-hidden="true"
        />

        <motion.button
          id="btn-export"
          className="btn-export"
          onClick={() => setExportDialogOpen(true)}
          disabled={!hasVideo}
          aria-label="Export video"
          whileHover={hasVideo ? { scale: 1.02, boxShadow: "0 4px 16px rgba(14, 165, 233, 0.35)" } : {}}
          whileTap={hasVideo ? { scale: 0.98 } : {}}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export
          </span>
        </motion.button>
      </div>

      <ExportDialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} />
    </header>
  );
}
