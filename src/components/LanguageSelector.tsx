// CutFlow AI — Language Selector for Whisper transcription
// Allows the user to pick the spoken language for better accuracy

import { useTimeline } from '@/context/TimelineContext';

const LANGUAGES = [
  { code: '', label: 'Auto-detect', description: 'Let Whisper detect the language' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'tr', label: 'Turkish' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' },
];

export default function LanguageSelector() {
  const { language, setLanguage, retranscribe, state } = useTimeline();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        style={{
          flex: 1,
          padding: '3px 6px',
          fontSize: 11,
          background: 'var(--surface)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.label}{lang.description ? ` — ${lang.description}` : ''}
          </option>
        ))}
      </select>
      {state.source_video_path && (
        <button
          onClick={retranscribe}
          title="Re-transcribe with selected language"
          style={{
            padding: '3px 8px',
            fontSize: 11,
            background: 'var(--teal-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Re-transcribe
        </button>
      )}
    </div>
  );
}
