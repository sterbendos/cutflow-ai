import { useState, useRef } from 'react';
import { useTimeline } from '../context/TimelineContext';
import { writeFile, BaseDirectory, mkdir } from '@tauri-apps/plugin-fs';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';

export default function AudioRecorder() {
  const { addAudioSegment } = useTimeline();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isConverting, setIsConverting] = useState(false);
  const [savedClips, setSavedClips] = useState<{name: string, path: string, duration: number}[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Prefer webm/opus, fall back to whatever is available
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      startTimeRef.current = Date.now();

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const recordingDuration = (Date.now() - startTimeRef.current) / 1000;
        setIsConverting(true);

        try {
          // Write raw webm to a temp recordings folder
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
          const arrayBuffer = await audioBlob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          await mkdir('recordings', { baseDir: BaseDirectory.AppLocalData, recursive: true });

          const timestamp = Date.now();
          const webmFilename = `voice-${timestamp}.webm`;
          const wavFilename = `voice-${timestamp}.wav`;

          // Write webm to AppLocalData/recordings/
          await writeFile(`recordings/${webmFilename}`, uint8Array, { baseDir: BaseDirectory.AppLocalData });

          // Resolve absolute path
          const appDataPath = await appLocalDataDir();
          const webmAbsPath = await join(appDataPath, 'recordings', webmFilename);
          const wavAbsPath = await join(appDataPath, 'recordings', wavFilename);

          // Convert webm → wav via FFmpeg sidecar for max compatibility
          try {
            await invoke('convert_audio_to_wav', { inputPath: webmAbsPath, outputPath: wavAbsPath });
            // Success — use the wav path
            setSavedClips(prev => [...prev, { name: wavFilename, path: wavAbsPath, duration: recordingDuration }]);
            // Clean up webm after successful conversion
            try { await invoke('delete_file', { path: webmAbsPath }); } catch {}
          } catch (convErr) {
            // Fallback: use webm path (works for preview, may not export)
            console.warn('WAV conversion failed, using webm:', convErr);
            setSavedClips(prev => [...prev, { name: webmFilename, path: webmAbsPath, duration: recordingDuration }]);
          }
        } catch (err: any) {
          setError(`Save failed: ${err?.message ?? err}`);
        } finally {
          setIsConverting(false);
          stream.getTracks().forEach(track => track.stop());
        }
      };

      // Collect data every 100ms for responsive onstop
      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err: any) {
      if (err?.name === 'NotAllowedError') {
        setError('Microphone access denied. Allow microphone in your browser/OS settings.');
      } else {
        setError(`Cannot access microphone: ${err?.message ?? err}`);
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{ padding: '12px', background: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
         <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Microphone Recording</span>
         <span style={{ fontSize: '12px', color: isRecording ? '#ef4444' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
           {isRecording && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#ef4444', marginRight: 4, animation: 'pulse 1s infinite' }} />}
           {formatTime(recordingTime)}
         </span>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 4, padding: '6px 8px', fontSize: 10, color: '#fca5a5', marginBottom: 10 }}>
          {error}
        </div>
      )}

      {isConverting && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 8 }}>
          ⚙️ Converting to WAV...
        </div>
      )}
      
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isConverting}
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            border: isRecording ? '2px solid #ef4444' : 'none',
            background: isRecording ? 'transparent' : '#ef4444',
            cursor: isConverting ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
            boxShadow: isRecording ? '0 0 15px rgba(239, 68, 68, 0.5)' : 'none',
            opacity: isConverting ? 0.5 : 1,
          }}
          title={isRecording ? 'Stop recording' : 'Start recording'}
        >
           <div style={{
             width: isRecording ? '16px' : '20px',
             height: isRecording ? '16px' : '20px',
             backgroundColor: '#ef4444',
             borderRadius: isRecording ? '4px' : '50%',
             transition: 'all 0.2s'
           }} />
        </button>
      </div>

      {savedClips.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>Recordings</div>
          {savedClips.map((clip, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--panel)', padding: '6px 8px', borderRadius: '4px', gap: 6 }}>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: '11px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {clip.name}
                </span>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  {clip.duration.toFixed(1)}s
                </span>
              </div>
              <button
                onClick={() => addAudioSegment({
                  id: crypto.randomUUID(),
                  path: clip.path,
                  start: 0,
                  duration: clip.duration,
                  type: 'voice'
                })}
                style={{
                  flexShrink: 0,
                  background: 'var(--teal-primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  fontSize: '10px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                + Add
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
