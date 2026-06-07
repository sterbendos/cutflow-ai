// CutFlow AI - Export Dialog
// Browser-native export flow for MP4, FCPXML, and EDL.

import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTimeline } from '@/context/TimelineContext';
import { useEffects } from '@/context/EffectsContext';
import { useCaption, captionPresets } from '@/context/CaptionContext';
import { useMotionGraphics } from '@/context/MotionGraphicsContext';
import { generateFcpxml, type ExportClip } from '@/lib/export/fcpxml';
import { generateEdl } from '@/lib/export/edl';
import { exportTimelineToMp4, exportTimelineToTauriMp4, type BrowserExportQuality, type BrowserExportResolution } from '@/lib/render/Exporter';
import type { CaptionStyle } from '@/context/CaptionContext';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

type ExportFormat = 'mp4' | 'fcpxml' | 'edl';

function getPresetStyle(name: string, fallback: CaptionStyle) {
  return captionPresets.find((preset) => preset.name === name)?.style ?? fallback;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ExportDialog({ open, onClose }: ExportDialogProps) {
  const { effects } = useEffects();
  const { state, transcript, bRolls } = useTimeline();
  const { style: captionStyle } = useCaption();
  const { items: motionGraphics } = useMotionGraphics();
  const [format, setFormat] = useState<ExportFormat>('mp4');
  const [quality, setQuality] = useState<BrowserExportQuality>('high');
  const [resolution, setResolution] = useState<BrowserExportResolution>('source');
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [selectedPresetName, setSelectedPresetName] = useState<string>(() => captionPresets[0]?.name ?? 'CutFlow');
  const [exporting, setExporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [exportProgress, setExportProgress] = useState(0);
  const [errorDetail, setErrorDetail] = useState('');

  const exportCaptionStyle = useMemo(
    () => getPresetStyle(selectedPresetName, captionStyle),
    [captionStyle, selectedPresetName],
  );

  const subtitleWords = useMemo(() => {
    return Array.isArray(transcript) ? transcript : [];
  }, [transcript]);

  const projectName = useMemo(() => {
    return state.source_video_path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'export';
  }, [state.source_video_path]);

  const exportMp4 = useCallback(async () => {
    // If running inside Tauri, prefer native ffmpeg sidecar export path
    const isTauri = typeof window !== 'undefined' && (window as any).__TAURI__;
    if (isTauri) {
      try {
        setStatusMessage('Preparing native export...');
        const { save } = await import('@tauri-apps/plugin-dialog');
        const outputPath = await save({ defaultPath: `${projectName}.mp4`, filters: [{ name: 'MP4 (H.264)', extensions: ['mp4'] }] });
        if (!outputPath) return;

        setStatusMessage('Rendering frames and invoking native ffmpeg...');
        await exportTimelineToTauriMp4(state, {
          quality,
          resolution,
          includeSubtitles,
          transcript: subtitleWords,
          captionStyle: exportCaptionStyle,
          effects,
          bRolls,
          motionGraphics,
          onProgress: (p, m) => { setExportProgress(p); setStatusMessage(m); },
        }, outputPath, projectName);
        setStatusMessage(`Export queued to: ${outputPath}`);
        return;
      } catch (e) {
        setErrorDetail(String(e));
        setStatusMessage('Native export failed, falling back to browser export');
      }
    }

    const blob = await exportTimelineToMp4(state, {
      quality,
      resolution,
      includeSubtitles,
      transcript: subtitleWords,
      captionStyle: exportCaptionStyle,
      effects,
      bRolls,
      motionGraphics,
      onProgress: (progress, message) => {
        setExportProgress(progress);
        setStatusMessage(message);
      },
    });

    const ext = blob.type === 'video/webm' || blob.type.startsWith('video/webm') ? 'webm' : 'mp4';
    downloadBlob(blob, `${projectName}_export.${ext}`);
  }, [
    bRolls,
    effects,
    exportCaptionStyle,
    includeSubtitles,
    motionGraphics,
    projectName,
    quality,
    resolution,
    state,
    subtitleWords,
  ]);

  const exportTextFormat = useCallback(async () => {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');

    const ext = format === 'fcpxml' ? 'xml' : 'edl';
    const filterName = format === 'fcpxml' ? 'FCPXML (Final Cut Pro)' : 'EDL (CMX3600)';
    const outputPath = await save({
      defaultPath: `${projectName}.${ext}`,
      filters: [{ name: filterName, extensions: [ext] }],
    });

    if (!outputPath) return;

    const clips: ExportClip[] = state.edl
      .filter((seg) => seg.segment_type === 'keep')
      .map((seg) => ({
        id: seg.id,
        name: projectName,
        srcFile: state.source_video_path,
        start: seg.start,
        end: seg.end,
        duration: seg.end - seg.start,
        transition: state.transitionType !== 'none' ? state.transitionType as ExportClip['transition'] : undefined,
        transitionDuration: state.transitionType !== 'none' ? state.transitionDuration : undefined,
      }));

    const content = format === 'fcpxml'
      ? generateFcpxml(clips, projectName, 30)
      : generateEdl(clips, projectName);

    await writeTextFile(outputPath, content);
    setStatusMessage(`${format === 'fcpxml' ? 'FCPXML' : 'EDL'} exported successfully`);
  }, [format, projectName, state]);

  const doExport = useCallback(async () => {
    if (!state.source_video_path) return;

    setExporting(true);
    setStatusMessage('');
    setErrorDetail('');
    setExportProgress(0);

    try {
      if (format === 'mp4') {
        await exportMp4();
        setExportProgress(1);
        setStatusMessage('MP4 export completed');
      } else {
        await exportTextFormat();
      }

      window.setTimeout(() => {
        onClose();
        setExporting(false);
        setStatusMessage('');
        setExportProgress(0);
        setErrorDetail('');
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorDetail(message);
      setStatusMessage('Export failed');
      setExporting(false);
    } finally {
      setExporting(false);
    }
  }, [exportMp4, exportTextFormat, format, onClose, state.source_video_path]);

  const hasVideo = Boolean(state.source_video_path);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
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
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            style={{
              background: '#1a1a2e',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              width: 420,
              maxWidth: '90vw',
              padding: 24,
              boxShadow: 'var(--shadow-premium, 0 20px 60px rgba(0,0,0,0.5))',
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px', color: 'var(--text)' }}>Export</h2>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 20px' }}>
              Choose export format and settings
            </p>

            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Format</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {(['mp4', 'fcpxml', 'edl'] as ExportFormat[]).map((item) => (
                <button
                  key={item}
                  onClick={() => setFormat(item)}
                  style={{
                    flex: 1,
                    padding: '8px 4px',
                    fontSize: 11,
                    fontWeight: format === item ? 700 : 500,
                    background: format === item ? 'var(--teal-primary)' : 'var(--surface)',
                    color: format === item ? '#fff' : 'var(--text)',
                    border: format === item ? '1px solid var(--teal-primary)' : '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  {item === 'mp4' ? 'MP4 Video' : item === 'fcpxml' ? 'FCPXML' : 'EDL'}
                </button>
              ))}
            </div>

            {format === 'mp4' && (
              <>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Resolution</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                  {([
                    { value: 'source', label: 'Source' },
                    { value: '2160', label: '4K' },
                    { value: '1080', label: '1080p' },
                    { value: '720', label: '720p' },
                  ] as { value: BrowserExportResolution; label: string }[]).map((item) => (
                    <button
                      key={item.value}
                      onClick={() => setResolution(item.value)}
                      style={{
                        flex: 1,
                        padding: '6px 4px',
                        fontSize: 10,
                        fontWeight: resolution === item.value ? 700 : 500,
                        background: resolution === item.value ? 'var(--teal-primary)' : 'var(--surface)',
                        color: resolution === item.value ? '#fff' : 'var(--text)',
                        border: resolution === item.value ? '1px solid var(--teal-primary)' : '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Quality</label>
                <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                  {([
                    { value: 'high', label: 'High' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'low', label: 'Low' },
                  ] as { value: BrowserExportQuality; label: string }[]).map((item) => (
                    <button
                      key={item.value}
                      onClick={() => setQuality(item.value)}
                      style={{
                        flex: 1,
                        padding: '6px 4px',
                        fontSize: 10,
                        fontWeight: quality === item.value ? 700 : 500,
                        background: quality === item.value ? 'var(--teal-primary)' : 'var(--surface)',
                        color: quality === item.value ? '#fff' : 'var(--text)',
                        border: quality === item.value ? '1px solid var(--teal-primary)' : '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                      }}
                    >
                      {item.label}
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
                  Include subtitles
                </label>

                {includeSubtitles && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Subtitle Style</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {captionPresets.map((preset) => (
                        <button
                          key={preset.name}
                          onClick={() => setSelectedPresetName(preset.name)}
                          style={{
                            padding: '6px 12px',
                            fontSize: 11,
                            fontWeight: selectedPresetName === preset.name ? 700 : 500,
                            background: selectedPresetName === preset.name ? 'var(--teal-primary)' : 'var(--surface)',
                            color: selectedPresetName === preset.name ? '#fff' : 'var(--text)',
                            border: selectedPresetName === preset.name ? '1px solid var(--teal-primary)' : '1px solid var(--border)',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                          }}
                        >
                          {preset.name}
                        </button>
                      ))}
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
                      Using: <span style={{ color: 'var(--teal-primary)' }}>{selectedPresetName}</span> - matches the preview style
                    </p>
                  </div>
                )}
              </>
            )}

            {format !== 'mp4' && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
                This format will be written as a text file through the local save dialog.
              </p>
            )}

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
                  background: statusMessage && !errorDetail ? '#059669' : errorDetail ? '#dc2626' : 'var(--teal-primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: !hasVideo || exporting ? 'not-allowed' : 'pointer',
                  opacity: !hasVideo ? 0.5 : 1,
                }}
              >
                {exporting ? `Exporting... ${Math.round(exportProgress * 100)}%` : 'Export'}
              </button>
            </div>

            {!hasVideo && (
              <p style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 8, textAlign: 'center' }}>
                Load a video to enable export
              </p>
            )}

            {statusMessage && (
              <p style={{ fontSize: 10, color: errorDetail ? '#dc2626' : '#059669', marginTop: 8, textAlign: 'center' }}>
                {statusMessage}
              </p>
            )}

            {errorDetail && (
              <div style={{
                marginTop: 8,
                background: 'rgba(220,38,38,0.08)',
                border: '1px solid rgba(220,38,38,0.4)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626' }}>Export Error</span>
                  <button
                    onClick={() => { setErrorDetail(''); setStatusMessage(''); }}
                    style={{ fontSize: 10, background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}
                  >
                    Dismiss
                  </button>
                </div>
                <pre style={{
                  fontSize: 9,
                  color: '#fca5a5',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 150,
                  overflowY: 'auto',
                  margin: 0,
                  fontFamily: 'monospace',
                }}>
                  {errorDetail}
                </pre>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
