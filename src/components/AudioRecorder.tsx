import { useState, useRef } from 'react';
import { useTimeline } from '../context/TimelineContext';
import { writeFile, BaseDirectory, mkdir } from '@tauri-apps/plugin-fs';

export default function AudioRecorder() {
  const { addAudioSegment } = useTimeline();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [savedClips, setSavedClips] = useState<{name: string, path: string}[]>([]);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        try {
           await mkdir('recordings', { baseDir: BaseDirectory.AppLocalData, recursive: true });
        } catch (e) {}

        const filename = `sfx-${Date.now()}.webm`;
        // In a real app, you might want to convert this webm to wav via Tauri/FFmpeg
        await writeFile(`recordings/${filename}`, uint8Array, { baseDir: BaseDirectory.AppLocalData });
        
        // For now, we mock the absolute path handling because we need to get the real appData dir path
        // In Tauri v2, we'd resolve the path properly. We'll store a placeholder and let the user know.
        
        setSavedClips(prev => [...prev, { name: filename, path: `appdata/recordings/${filename}` }]);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Error accessing microphone:", err);
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
         <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>Microphone</span>
         <span style={{ fontSize: '12px', color: isRecording ? '#ef4444' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
           {formatTime(recordingTime)}
         </span>
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
        <button
          onClick={isRecording ? stopRecording : startRecording}
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            border: 'none',
            background: isRecording ? 'transparent' : '#ef4444',
            borderStyle: isRecording ? 'solid' : 'none',
            borderColor: '#ef4444',
            borderWidth: '2px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
            boxShadow: isRecording ? '0 0 15px rgba(239, 68, 68, 0.5)' : 'none',
          }}
        >
           <div style={{
             width: isRecording ? '16px' : '0px',
             height: isRecording ? '16px' : '0px',
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
            <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--panel)', padding: '6px 8px', borderRadius: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                {clip.name}
              </span>
              <button
                onClick={() => addAudioSegment({ id: crypto.randomUUID(), path: clip.path, start: 0, duration: 5, type: 'voice' })}
                style={{ background: 'var(--teal-primary)', color: 'var(--teal-dark)', border: 'none', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', fontWeight: 600, cursor: 'pointer' }}
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
