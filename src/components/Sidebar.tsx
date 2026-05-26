// CutFlow AI — Sidebar Component
// 280px asset panel with drag-and-drop video ingestion and edit sensitivity toggles.

import React, { useCallback, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useTimeline } from '@/context/TimelineContext';

// ─── Types ────────────────────────────────────────────────────

interface AssetItem {
  id: string;
  path: string;
  name: string;
  duration: number; // seconds
  size: string;
}

type Sensitivity = 'minimal' | 'balanced' | 'action' | 'aggressive';

const SENSITIVITY_OPTIONS: { key: Sensitivity; label: string; desc: string }[] = [
  { key: 'minimal',    label: 'Minimal',    desc: 'Keep long pauses' },
  { key: 'balanced',   label: 'Balanced',   desc: 'Default cut level' },
  { key: 'action',     label: 'Action',     desc: 'Tight dynamic cuts' },
  { key: 'aggressive', label: 'Aggressive', desc: 'Max cuts & trims' },
];

// ─── Helpers ─────────────────────────────────────────────────

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function FilmIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
      <line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/>
      <line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/>
      <line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/>
      <line x1="17" y1="7" x2="22" y2="7"/>
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="drop-zone__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16"/>
      <line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────

export default function Sidebar() {
  const { state, loadVideo } = useTimeline();
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState<Sensitivity>('balanced');
  const [dragOver, setDragOver] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // ── Probe video duration via a hidden <video> element ──────
  async function probeVideoDuration(filePath: string): Promise<number> {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      // Tauri asset protocol for local files
      v.src = `asset://${filePath.replace(/\\/g, '/')}`;
      v.onloadedmetadata = () => resolve(isFinite(v.duration) ? v.duration : 60);
      v.onerror = () => resolve(60); // fallback: 60s
    });
  }

  // ── Handle file selection (dialog or drop) ─────────────────
  const handleFiles = useCallback(
    async (paths: string[]) => {
      const videoExts = /\.(mp4|mov|mkv|avi|webm|m4v|wmv|flv)$/i;
      const validPaths = paths.filter((p) => videoExts.test(p));
      if (!validPaths.length) return;

      const newAssets: AssetItem[] = [];
      for (const p of validPaths) {
        const name = p.split(/[/\\]/).pop() ?? p;
        const duration = await probeVideoDuration(p);
        const sizeKb = Math.round(Math.random() * 800 + 200); // placeholder until fs stat
        newAssets.push({
          id: crypto.randomUUID(),
          path: p,
          name,
          duration,
          size: `${sizeKb} MB`,
        });
      }

      setAssets((prev) => [...prev, ...newAssets]);

      // Auto-load the first newly added asset
      const first = newAssets[0];
      if (first) {
        setActiveAssetId(first.id);
        await loadVideo(first.path, first.duration);
      }
    },
    [loadVideo]
  );

  // ── File picker dialog ─────────────────────────────────────
  async function openFilePicker() {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: 'Video Files', extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv'] },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      await handleFiles(paths);
    } catch {
      // Tauri dialog not available in browser dev mode
    }
  }

  // ── Select an existing asset ───────────────────────────────
  async function selectAsset(asset: AssetItem) {
    setActiveAssetId(asset.id);
    await loadVideo(asset.path, asset.duration);
  }

  // ── Drag and drop handlers ─────────────────────────────────
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave() { setDragOver(false); }
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const paths = Array.from(e.dataTransfer.files).map((f) => f.name);
    // In Tauri, dataTransfer.files gives File objects; in native context use paths
    const nativePaths = Array.from(e.dataTransfer.files).map(
      (f) => (f as File & { path?: string }).path ?? f.name
    );
    await handleFiles(nativePaths.filter(Boolean));
    void paths; // suppress unused warning
  }

  return (
    <aside className="sidebar" aria-label="Asset panel">
      {/* Header */}
      <div className="sidebar__header">
        <span className="sidebar__section-title">Media Assets</span>
        <button
          id="btn-add-media"
          className="btn-icon"
          onClick={openFilePicker}
          title="Add media file"
          aria-label="Add media file"
        >
          <PlusIcon />
        </button>
      </div>

      <div className="sidebar__content">
        {/* Drop Zone */}
        <div
          ref={dropRef}
          id="drop-zone"
          className={`drop-zone${dragOver ? ' drag-over' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Drop video files here or click to browse"
          onClick={openFilePicker}
          onKeyDown={(e) => e.key === 'Enter' && openFilePicker()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <UploadIcon />
          <span className="drop-zone__label">
            Drop videos here<br />or click to browse
          </span>
          <span className="drop-zone__hint">MP4, MOV, MKV, AVI, WebM</span>
        </div>

        {/* Asset List */}
        {assets.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="sidebar__section-title" style={{ marginTop: 4, display: 'block' }}>
              Clips ({assets.length})
            </span>
            {assets.map((asset) => (
              <div
                key={asset.id}
                id={`asset-${asset.id}`}
                className={`asset-card${activeAssetId === asset.id ? ' active' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`Load ${asset.name}`}
                aria-pressed={activeAssetId === asset.id}
                onClick={() => selectAsset(asset)}
                onKeyDown={(e) => e.key === 'Enter' && selectAsset(asset)}
              >
                <div className="asset-card__thumb" aria-hidden="true">
                  <FilmIcon size={20} />
                </div>
                <div className="asset-card__info">
                  <div className="asset-card__name" title={asset.name}>
                    {asset.name}
                  </div>
                  <div className="asset-card__meta">
                    {formatDuration(asset.duration)} · {asset.size}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit Sensitivity Toggles */}
        <div className="sensitivity-section">
          <span className="sensitivity-label">Cut Sensitivity</span>
          <div className="sensitivity-grid">
            {SENSITIVITY_OPTIONS.map(({ key, label, desc }) => (
              <button
                key={key}
                id={`sensitivity-${key}`}
                className={`sensitivity-btn${sensitivity === key ? ' active' : ''}`}
                onClick={() => setSensitivity(key)}
                title={desc}
                aria-pressed={sensitivity === key}
              >
                {label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 6, lineHeight: 1.4 }}>
            {SENSITIVITY_OPTIONS.find(o => o.key === sensitivity)?.desc}
          </p>
        </div>

        {/* Current video info */}
        {state.source_video_path && (
          <div
            style={{
              marginTop: 4,
              padding: '8px 10px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 4 }}>
              Active Source
            </div>
            <div style={{ fontSize: 11, color: 'var(--teal-primary)', wordBreak: 'break-all' }}>
              {state.source_video_path.split('/').pop()}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
              {state.edl.length} segment{state.edl.length !== 1 ? 's' : ''} in EDL
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
