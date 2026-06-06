// CutFlow AI — Export Dialog
// Modal for choosing export format, resolution, quality, and subtitle options.

import { useState, useCallback, useMemo } from 'react';
import { useTimeline } from '@/context/TimelineContext';
import { generateFcpxml, type ExportClip } from '@/lib/export/fcpxml';
import { generateEdl } from '@/lib/export/edl';
import { generateSrtForExport, normalizeTranscript } from '@/lib/export/subtitles';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffects } from '@/context/EffectsContext';
import { useCaption, captionPresets } from '@/context/CaptionContext';
import { captionStyleToSsaForceStyle } from '@/lib/export/captionToSsa';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

type ExportFormat = 'mp4' | 'fcpxml' | 'edl';
type ExportQuality = 'high' | 'medium' | 'low';
type ExportResolution = 'source' | '2160' | '1080' | '720';

export default function ExportDialog({ open, onClose }: ExportDialogProps) {
  const { effects } = useEffects();
  const { state, transcript, bRolls } = useTimeline();
  const { style: captionStyle } = useCaption();
  const [format, setFormat] = useState<ExportFormat>('mp4');
  const [quality, setQuality] = useState<ExportQuality>('high');
  const [resolution, setResolution] = useState<ExportResolution>('source');
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [useGpu, setUseGpu] = useState(true);
  // Default to the currently active caption preset name
  const [selectedPresetName, setSelectedPresetName] = useState<string>(() => {
    // Try to find a preset that matches the current style, fallback to 'CutFlow'
    return captionPresets[0]?.name ?? 'CutFlow';
  });
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'scanning' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [scanProgress, setScanProgress] = useState(0);
  const [errorDetail, setErrorDetail] = useState('');

  // Build the SSA force_style string from the selected preset
  const subtitleForceStyle = useMemo(() => {
    const preset = captionPresets.find(p => p.name === selectedPresetName);
    const styleToUse = preset ? preset.style : captionStyle;
    return captionStyleToSsaForceStyle(styleToUse);
  }, [selectedPresetName, captionStyle]);

  const subtitleWords = useMemo(() => {
    return transcript.length > 0 ? normalizeTranscript(transcript) : normalizeTranscript(state.transcript_json);
  }, [transcript, state.transcript_json]);

  const doExport = useCallback(async () => {
    if (!state.source_video_path) return;
    setExporting(true);
    setExportStatus('idle');
    setStatusMessage('');
    setErrorDetail('');

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

        let srtPath: string | null = null;

        // Generate SRT if subtitles enabled
        if (includeSubtitles && state.edl.length > 0) {
          if (subtitleWords.length === 0) {
            throw new Error('No subtitles available to burn in. Wait for transcription to finish, or disable subtitles for this export.');
          }

          setStatusMessage('Generating subtitles...');

          const preset = captionPresets.find(p => p.name === selectedPresetName);
          const styleToUse = preset ? preset.style : captionStyle;

          const srtContent = generateSrtForExport(subtitleWords, state.edl, styleToUse);

          if (!srtContent.trim()) {
            throw new Error('No subtitles available to burn in. Wait for transcription to finish, or disable subtitles for this export.');
          }

          const { writeTextFile } = await import('@tauri-apps/plugin-fs');
          const { tempDir, join } = await import('@tauri-apps/api/path');
          const tmp = await tempDir();
          // Save as .ass — the ASS file contains all style info in its [V4+ Styles]
          // section, so no force_style override is needed on the ffmpeg command side.
          srtPath = await join(tmp, 'cutflow_export_subs.ass');
          await writeTextFile(srtPath, srtContent);
        }

        // ── Build FFmpeg video filter chain from active effects ──────────
        const filterParts: string[] = [];

        // eq= handles brightness, contrast, saturation
        const eqParts: string[] = [];
        if (effects.brightness !== 100) eqParts.push(`brightness=${((effects.brightness - 100) / 100).toFixed(3)}`);
        if (effects.contrast !== 100) eqParts.push(`contrast=${(effects.contrast / 100).toFixed(3)}`);
        if (effects.saturation !== 100) eqParts.push(`saturation=${(effects.saturation / 100).toFixed(3)}`);
        if (eqParts.length > 0) filterParts.push(`eq=${eqParts.join(':')}`);

        // boxblur handles blur
        if (effects.blur > 0) {
          const r = Math.max(1, Math.round(effects.blur));
          filterParts.push(`boxblur=${r}:1`);
        }

        // hue= handles hue rotation
        if (effects.hueRotate !== 0) {
          filterParts.push(`hue=h=${effects.hueRotate}`);
        }

        const ffmpegFilter = filterParts.length > 0 ? filterParts.join(',') : null;

        // ── Collect B-roll segments for compositing ─────────────────────
        const brollInputs = bRolls
          .filter(b => b.path && !b.path.startsWith('mock://') && !b.path.startsWith('appdata/'))
          .map(b => ({
            path: b.path,
            start: b.start,
            duration: b.duration,
            scale: b.spatial?.scale ?? 1,
            x: b.spatial?.x ?? 0,
            y: b.spatial?.y ?? 0,
            rotation: b.spatial?.rotation ?? 0,
            opacity: b.spatial?.opacity ?? 1,
          }));

        // Invoke Rust export command
        // NOTE: subtitleStyle is intentionally omitted — all style info is baked
        // into the .ass file header by generateSrtForExport.
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('execute_export', { 
          outputPath,
          srtPath,
          subtitleStyle: null,
          videoFilter: ffmpegFilter,
          brollInputs: brollInputs.length > 0 ? brollInputs : null,
        });
        setExportStatus('success');
        setStatusMessage('Export completed successfully');

        // Auto-close after 3s
        setTimeout(() => {
          onClose();
          setExportStatus('idle');
          setStatusMessage('');
          setScanProgress(0);
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
      const msg: string = err?.message || String(err) || 'Export failed';
      console.error('Export failed:', msg);
      setExportStatus('error');
      setStatusMessage('Export failed — see details below');
      setErrorDetail(msg);
    } finally {
      setExporting(false);
    }
  }, [state.source_video_path, state.edl, state.transitionType, state.transitionDuration, subtitleWords, format, quality, resolution, includeSubtitles, useGpu, subtitleForceStyle, bRolls, effects, onClose]);

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
                  Using: <span style={{ color: 'var(--teal-primary)' }}>{selectedPresetName}</span> — matches your timeline preview style
                </p>
              </div>
            )}

            {includeSubtitles && subtitleWords.length === 0 && (
              <div style={{
                marginBottom: 12,
                padding: '8px 10px',
                background: 'rgba(245,158,11,0.12)',
                border: '1px solid rgba(245,158,11,0.4)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 10,
                color: '#f59e0b',
                lineHeight: 1.5,
              }}>
                No transcript yet. Wait for Whisper to finish transcribing, or disable subtitles.
              </div>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text)', marginBottom: 16, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={useGpu}
                onChange={(e) => setUseGpu(e.target.checked)}
                style={{ accentColor: 'var(--teal-primary)' }}
              />
              Use NVIDIA GPU Acceleration (NVENC)
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
                {exportStatus === 'scanning' ? `Scanning... ${Math.round(scanProgress)}%` : 'Exporting...'}
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
          <p style={{ fontSize: 10, color: exportStatus === 'error' ? '#dc2626' : '#059669', marginTop: 8, textAlign: 'center' }}>
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
              <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626' }}>FFmpeg Error Log</span>
              <button
                onClick={() => { setErrorDetail(''); setExportStatus('idle'); setStatusMessage(''); }}
                style={{ fontSize: 10, background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}
              >✕ Dismiss</button>
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
            }}>{errorDetail}</pre>
          </div>
        )}

        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}
