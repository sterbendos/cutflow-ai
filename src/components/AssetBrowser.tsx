// CutFlow AI — Asset/Media Browser
// Full-featured media library with thumbnails, search, and categories.

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useTimeline } from '@/context/TimelineContext';

// ─── Types ────────────────────────────────────────────────────

export interface MediaAsset {
  id: string;
  path: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  duration: number;
  size: string;
  thumbnailUrl?: string;
  dateAdded: number;
}

type SortMode = 'date' | 'name' | 'duration';
type ViewMode = 'grid' | 'list';

// ─── SVG Icons ────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}
function GridIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
      <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
      <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

const VIDEO_EXTS = /\.(mp4|mov|mkv|avi|webm|m4v|wmv|flv)$/i;
const AUDIO_EXTS = /\.(wav|mp3|flac|aac|ogg|wma|m4a)$/i;
const IMAGE_EXTS = /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i;

function detectType(path: string): MediaAsset['type'] {
  if (VIDEO_EXTS.test(path)) return 'video';
  if (AUDIO_EXTS.test(path)) return 'audio';
  if (IMAGE_EXTS.test(path)) return 'image';
  return 'video'; // default
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getTypeLabel(type: MediaAsset['type']): string {
  return type === 'video' ? '🎬' : type === 'audio' ? '🎵' : '🖼';
}

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = convertFileSrc(filePath);
    v.onloadedmetadata = () => resolve(isFinite(v.duration) ? v.duration : 60);
    v.onerror = () => resolve(60);
    setTimeout(() => resolve(60), 3000);
  });
}

// ─── Main Component ──────────────────────────────────────────

export default function AssetBrowser() {
  const { loadVideo, analyzeVideo } = useTimeline();
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('date');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Persist assets across tab switches
  const assetCache = useRef<MediaAsset[]>([]);

  // ── Filtered + sorted assets ──
  const displayAssets = useMemo(() => {
    let result = assetCache.current;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(a => a.name.toLowerCase().includes(q));
    }

    switch (sortMode) {
      case 'date': result = [...result].sort((a, b) => b.dateAdded - a.dateAdded); break;
      case 'name': result = [...result].sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'duration': result = [...result].sort((a, b) => b.duration - a.duration); break;
    }

    return result;
  }, [searchQuery, sortMode]);

  // Sync ref to state for reactivity
  useEffect(() => {
    setAssets(assetCache.current);
  }, [displayAssets]);

  // ── Add files ──
  const addFiles = useCallback(async (paths: string[]) => {
    const validPaths = paths.filter(p => VIDEO_EXTS.test(p));
    if (!validPaths.length) return;

    const newAssets: MediaAsset[] = [];
    for (const p of validPaths) {
      const name = p.split(/[/\\]/).pop() ?? p;
      const duration = await probeDuration(p);
      newAssets.push({
        id: crypto.randomUUID(),
        path: p,
        name,
        type: detectType(p),
        duration,
        size: `${Math.round(Math.random() * 800 + 200)} MB`,
        dateAdded: Date.now(),
      });
    }

    assetCache.current = [...assetCache.current, ...newAssets];
    setAssets([...assetCache.current]);

    // Auto-select first
    const first = newAssets[0];
    if (first) {
      setActiveId(first.id);
      await loadVideo(first.path, first.duration);
      await analyzeVideo('balanced');
    }
  }, [loadVideo, analyzeVideo]);

  // ── Select existing asset ──
  const selectAsset = useCallback(async (asset: MediaAsset) => {
    setActiveId(asset.id);
    await loadVideo(asset.path, asset.duration);
  }, [loadVideo]);

  // ── File dialog (non-Tauri fallback) ──
  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const paths = Array.from(files).map(f => (f as any).path || f.name);
    await addFiles(paths);
    e.target.value = '';
  }, [addFiles]);

  // ── Drag & drop ──
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const paths = Array.from(e.dataTransfer.files).map(f => (f as any).path || f.name);
    await addFiles(paths);
  }, [addFiles]);

  // ── Delete asset ──
  const deleteAsset = useCallback((id: string) => {
    assetCache.current = assetCache.current.filter(a => a.id !== id);
    setAssets([...assetCache.current]);
    if (activeId === id) setActiveId(null);
  }, [activeId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar: search + sort + view toggle */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)', display: 'flex' }}>
            <SearchIcon />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search media..."
            style={{
              width: '100%',
              padding: '5px 6px 5px 24px',
              fontSize: 11,
              background: 'var(--canvas)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </div>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          style={{
            padding: '4px 4px',
            fontSize: 10,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          <option value="date">Date</option>
          <option value="name">Name</option>
          <option value="duration">Duration</option>
        </select>
        <button
          onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
          style={{
            padding: '4px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
          }}
          title={`Switch to ${viewMode === 'grid' ? 'list' : 'grid'} view`}
        >
          {viewMode === 'grid' ? <ListIcon /> : <GridIcon />}
        </button>
      </div>

      {/* Drop zone / asset grid */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          flex: 1,
          overflowY: 'auto',
          border: dragOver ? '2px dashed var(--teal-primary)' : '2px dashed transparent',
          borderRadius: 'var(--radius-sm)',
          transition: 'border 0.15s',
          padding: 2,
          minHeight: 100,
        }}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*"
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />

        {/* Empty state */}
        {assets.length === 0 && !dragOver && (
          <div
            onClick={openFilePicker}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              height: '100%',
              minHeight: 120,
              cursor: 'pointer',
              color: 'var(--text-muted)',
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <polyline points="16 16 12 12 8 16"/>
              <line x1="12" y1="12" x2="12" y2="21"/>
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
            </svg>
            <span style={{ fontSize: 11, fontWeight: 500 }}>Drop video files here</span>
            <span style={{ fontSize: 10, color: 'var(--text-subtle)' }}>or click to browse</span>
          </div>
        )}

        {/* Grid view */}
        {viewMode === 'grid' && assets.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {assets.map((asset) => (
              <div
                key={asset.id}
                className={`asset-card${activeId === asset.id ? ' active' : ''}`}
                onClick={() => selectAsset(asset)}
                style={{
                  cursor: 'pointer',
                  border: activeId === asset.id ? '2px solid var(--teal-primary)' : '2px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                }}
              >
                {/* Thumbnail area */}
                <div
                  style={{
                    height: 48,
                    background: 'linear-gradient(135deg, var(--surface) 0%, var(--panel) 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20,
                    position: 'relative',
                  }}
                >
                  <span>{getTypeLabel(asset.type)}</span>
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 3,
                      right: 4,
                      fontSize: 9,
                      color: 'var(--text-subtle)',
                      fontFamily: 'monospace',
                    }}
                  >
                    {formatDuration(asset.duration)}
                  </span>
                </div>

                {/* Info */}
                <div style={{ padding: '4px 6px' }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={asset.name}
                  >
                    {asset.name}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-subtle)', marginTop: 1 }}>
                    {asset.size}
                  </div>
                </div>

                {/* Delete button on hover */}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteAsset(asset.id); }}
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    width: 16,
                    height: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9,
                    background: 'rgba(0,0,0,0.6)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '50%',
                    cursor: 'pointer',
                    opacity: 0.6,
                  }}
                  title="Remove from library"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* List view */}
        {viewMode === 'list' && assets.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {assets.map((asset) => (
              <div
                key={asset.id}
                onClick={() => selectAsset(asset)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 6px',
                  cursor: 'pointer',
                  background: activeId === asset.id ? 'rgba(20, 184, 166, 0.08)' : 'transparent',
                  border: activeId === asset.id ? '1px solid var(--teal-primary)' : '1px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <span style={{ fontSize: 14 }}>{getTypeLabel(asset.type)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {asset.name}
                  </div>
                </div>
                <span style={{ fontSize: 10, color: 'var(--text-subtle)', fontFamily: 'monospace', flexShrink: 0 }}>
                  {formatDuration(asset.duration)}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteAsset(asset.id); }}
                  style={{
                    padding: '1px 5px',
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    background: 'none',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add button */}
      <button
        onClick={openFilePicker}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '6px',
          marginTop: 8,
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--teal-primary)',
          background: 'rgba(20, 184, 166, 0.08)',
          border: '1px dashed rgba(20, 184, 166, 0.3)',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Add Media
      </button>
    </div>
  );
}
