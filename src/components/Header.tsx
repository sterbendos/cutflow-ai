// CutFlow AI — Header Component
// 48px top bar: brand left, project name center, actions right.

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { useTimeline } from '@/context/TimelineContext';

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

function ExportSpinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
      </path>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────

export default function Header() {
  const { state } = useTimeline();
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const hasVideo = Boolean(state.source_video_path);

  // Derive a friendly project name from the file path
  const projectName = hasVideo
    ? state.source_video_path.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Untitled'
    : 'Untitled Project';

  async function handleExport() {
    if (!hasVideo || exporting) return;

    try {
      // Open a Save dialog so the user picks an output path
      const outputPath = await save({
        title: 'Export Video',
        defaultPath: `${projectName}_export.mp4`,
        filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      });

      if (!outputPath) return; // User cancelled

      setExporting(true);
      setExportStatus('idle');

      await invoke('execute_export', { outputPath });

      setExportStatus('success');
      setTimeout(() => setExportStatus('idle'), 3000);
    } catch (err) {
      console.error('Export failed:', err);
      setExportStatus('error');
      setTimeout(() => setExportStatus('idle'), 4000);
    } finally {
      setExporting(false);
    }
  }

  const exportLabel = () => {
    if (exporting) return 'Exporting…';
    if (exportStatus === 'success') return '✓ Exported!';
    if (exportStatus === 'error') return '✗ Failed';
    return 'Export MP4';
  };

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
        <button
          id="btn-undo"
          className="btn-icon"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          disabled={!hasVideo}
        >
          <UndoIcon />
        </button>

        <button
          id="btn-redo"
          className="btn-icon"
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
          disabled={!hasVideo}
        >
          <RedoIcon />
        </button>

        <div
          style={{
            width: 1,
            height: 20,
            background: 'var(--border)',
            margin: '0 4px',
          }}
          aria-hidden="true"
        />

        <button
          id="btn-export"
          className="btn-export"
          onClick={handleExport}
          disabled={!hasVideo || exporting}
          aria-label="Export video as MP4"
          style={{
            background:
              exportStatus === 'success'
                ? '#059669'
                : exportStatus === 'error'
                ? '#dc2626'
                : undefined,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {exporting && <ExportSpinner />}
            {exportLabel()}
          </span>
        </button>
      </div>
    </header>
  );
}
