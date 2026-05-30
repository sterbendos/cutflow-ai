// CutFlow AI — Export Dialog
// Modal for choosing export format, resolution, quality, and subtitle options.

import { useState, useCallback } from 'react';
import { useTimeline } from '@/context/TimelineContext';
import { generateFcpxml, type ExportClip } from '@/lib/export/fcpxml';
import { generateEdl } from '@/lib/export/edl';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

type ExportFormat = 'mp4' | 'fcpxml' | 'edl';
type ExportQuality = 'high' | 'medium' | 'low';
type ExportResolution = 'source' | '2160' | '1080' | '720';

export default function ExportDialog({ open, onClose }: ExportDialogProps) {
  const { state } = useTimeline();
  const [format, setFormat] = useState<ExportFormat>('mp4');
  const [quality, setQuality] = useState<ExportQuality>('high');
  const [resolution, setResolution] = useState<ExportResolution>('source');
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');

  const doExport = useCallback(async () => {
    if (!state.source_video_path) return;
    setExporting(true);
    setExportStatus('idle');
    setStatusMessage('');

    try {
      if (format === 'mp4') {
        // Native MP4 export via Tauri
        const { save } = await import('@tauri-apps/plugin-dialog');
        const projectName = state.source_video_path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'export';
        const outputPath = await save({
          defaultPath: `${projectName}_export.mp4`,
          filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
        });
        if (!outputPath) {
          setExporting(false);
          return;
        }

        // Generate SRT if subtitles enabled
        if (includeSubtitles && state.edl.length > 0) {
          try {
            const { writeTextFile } = await import('@tauri-apps/plugin-fs');
            const { tempDir } = await import('@tauri-apps/api/path');
            const tmp = await tempDir();
            const srtPath = `${tmp}cutflow_export_subs.srt`;

            const words = state.edl.map((seg) => ({
              text: seg.segment_type === 'keep' ? 'keep' : 'cut',
              start: seg.start,
              end: seg.end,
            }));

            let srtContent = '';
            words.forEach((_, i) => {
              if (i % 5 !== 0) return;
              const chunk = words.slice(i, i + 5);
              const s = chunk[0].start;
              const e = chunk[chunk.length - 1].end + 0.5;
              srtContent += `${Math.floor(i / 5) + 1}\n`;
              srtContent += `${fmtSrt(s)} --> ${fmtSrt(e)}\n`;
              srtContent += `${chunk.map((c) => c.text).join(' ')}\n\n`;
            });

            await writeTextFile(srtPath, srtContent);
          } catch (err) {
            console.error('SRT export error:', err);
          }
        }

        // Invoke Rust export command
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('execute_export', { outputPath });
        setExportStatus('success');
        setStatusMessage('Export completed successfully');

        // Auto-close after 3s
        setTimeout(() => {
          onClose();
          setExportStatus('idle');
          setStatusMessage('');
        }, 3000);
      } else {
        // XML / EDL export — write file via save dialog
        const { save } = await import('@tauri-apps/plugin-dialog');
        const projectName = state.source_video_path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'project';
        const ext = format === 'fcpxml' ? 'xml' : 'edl';
        const filterName = format === 'fcpxml' ? 'FCPXML (Final Cut Pro)' : 'EDL (CMX3600)';

        const outputPath = await save({
          defaultPath: `${projectName}.${ext}`,
          filters: [{ name: filterName, extensions: [ext] }],
        });
        if (!outputPath) {
          setExporting(false);
          return;
        }

        // Build clips from EDL
        const clips: ExportClip[] = state.edl
          .filter((seg) => seg.segment_type === 'keep')
          .map((seg) => ({
            id: seg.id,
            name: state.source_video_path.split(/[\\/]/).pop() || 'clip',
            srcFile: state.source_video_path,
            start: seg.start,
            end: seg.end,
            duration: seg.end - seg.start,
            transition: state.transitionType !== 'none' ? state.transitionType as ExportClip['transition'] : undefined,
            transitionDuration: state.transitionType !== 'none' ? state.transitionDuration : undefined,
          }));

        let content: string;
        if (format === 'fcpxml') {
          content = generateFcpxml(clips, projectName, 30);
        } else {
          content = generateEdl(clips, projectName);
        }

        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        await writeTextFile(outputPath, content);

        setExportStatus('success');
        setStatusMessage(`${format === 'fcpxml' ? 'FCPXML' : 'EDL'} exported successfully`);
        setTimeout(() => {
          onClose();
          setExportStatus('idle');
          setStatusMessage('');
        }, 3000);
      }
    } catch (err: any) {
      console.error('Export failed:', err);
      setExportStatus('error');
      setStatusMessage(err?.message || 'Export failed');
      setTimeout(() => {
        setExportStatus('idle');
        setStatusMessage('');
      }, 4000);
    } finally {
      setExporting(false);
    }
  }, [state.source_video_path, state.edl, state.transitionType, state.transitionDuration, format, quality, resolution, includeSubtitles, onClose]);

  if (!open) return null;

  const hasVideo = Boolean(state.source_video_path);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#1a1a2e',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          width: 420,
          maxWidth: '90vw',
          padding: 24,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px', color: 'var(--text)' }}>Export</h2>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 20px' }}>
          Choose export format and settings
        </p>

        {/* Format */}
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Format</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {(['mp4', 'fcpxml', 'edl'] as ExportFormat[]).map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              style={{
                flex: 1,
                padding: '8px 4px',
                fontSize: 11,
                fontWeight: format === f ? 700 : 500,
                background: format === f ? 'var(--teal-primary)' : 'var(--surface)',
                color: format === f ? '#fff' : 'var(--text)',
                border: format === f ? '1px solid var(--teal-primary)' : '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                transition: 'all 0.1s',
              }}
            >
              {f === 'mp4' ? 'MP4 Video' : f === 'fcpxml' ? 'FCPXML' : 'EDL'}
            </button>
          ))}
        </div>

        {/* MP4 options */}
        {format === 'mp4' && (
          <>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Resolution</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {([
                { value: 'source', label: 'Source' },
                { value: '2160', label: '4K' },
                { value: '1080', label: '1080p' },
                { value: '720', label: '720p' },
              ] as { value: ExportResolution; label: string }[]).map((r) => (
                <button
                  key={r.value}
                  onClick={() => setResolution(r.value)}
                  style={{
                    flex: 1,
                    padding: '6px 4px',
                    fontSize: 10,
                    fontWeight: resolution === r.value ? 700 : 500,
                    background: resolution === r.value ? 'var(--teal-primary)' : 'var(--surface)',
                    color: resolution === r.value ? '#fff' : 'var(--text)',
                    border: resolution === r.value ? '1px solid var(--teal-primary)' : '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Quality</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {([
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'low', label: 'Low' },
              ] as { value: ExportQuality; label: string }[]).map((q) => (
                <button
                  key={q.value}
                  onClick={() => setQuality(q.value)}
                  style={{
                    flex: 1,
                    padding: '6px 4px',
                    fontSize: 10,
                    fontWeight: quality === q.value ? 700 : 500,
                    background: quality === q.value ? 'var(--teal-primary)' : 'var(--surface)',
                    color: quality === q.value ? '#fff' : 'var(--text)',
                    border: quality === q.value ? '1px solid var(--teal-primary)' : '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  {q.label}
                </button>
              ))}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text)', marginBottom: 16, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeSubtitles}
                onChange={(e) => setIncludeSubtitles(e.target.checked)}
                style={{ accentColor: 'var(--teal-primary)' }}
              />
              Include subtitle file (.srt)
            </label>
          </>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              fontSize: 12,
              background: 'var(--surface)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={doExport}
            disabled={!hasVideo || exporting}
            style={{
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 600,
              background: exportStatus === 'success' ? '#059669' : exportStatus === 'error' ? '#dc2626' : 'var(--teal-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: !hasVideo || exporting ? 'not-allowed' : 'pointer',
              opacity: !hasVideo ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {exporting ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83">
                    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
                  </path>
                </svg>
                Exporting...
              </>
            ) : exportStatus === 'success' ? (
              <>✓ Exported</>
            ) : exportStatus === 'error' ? (
              <>✗ Failed</>
            ) : (
              <>Export</>
            )}
          </button>
        </div>

        {!hasVideo && (
          <p style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 8, textAlign: 'center' }}>
            Load a video to enable export
          </p>
        )}

        {statusMessage && (
          <p style={{ fontSize: 10, color: exportStatus === 'error' ? '#dc2626' : 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
            {statusMessage}
          </p>
        )}
      </div>
    </div>
  );
}

function fmtSrt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
