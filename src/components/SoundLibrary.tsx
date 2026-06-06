// CutFlow AI — Sound Library
// Searches real audio via Pixabay Audio API (free, 100 req/min).
// To enable: get a free API key at https://pixabay.com/api/docs/
// and set PIXABAY_API_KEY below.

import { useState, useRef } from 'react';
import { useTimeline } from '../context/TimelineContext';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { mkdir } from '@tauri-apps/plugin-fs';

// ─── CONFIG: Paste your free Pixabay API key here ───────────────────────────
// Get one at: https://pixabay.com/accounts/register/ (free, instant)
const PIXABAY_API_KEY = '56194554-1bff8ac5359a20b7046b1147a';
// ─────────────────────────────────────────────────────────────────────────────

interface AudioResult {
  id: number;
  tags: string;
  duration: number;
  audio_url: string;
  preview_url: string;
  user: string;
}

export default function SoundLibrary() {
  const { addAudioSegment, transcript } = useTimeline();
  const [activeTab, setActiveTab] = useState<'sfx' | 'music'>('sfx');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<AudioResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isDownloading, setIsDownloading] = useState<number | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [aiMood, setAiMood] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const hasApiKey = PIXABAY_API_KEY.trim().length > 0;

  const searchAudio = async (query: string, type: 'sfx' | 'music') => {
    if (!query.trim()) return;
    if (!hasApiKey) {
      setError('No API key configured. See instructions above the component.');
      return;
    }
    setIsSearching(true);
    setError(null);
    try {
      const category = type === 'music' ? 'music' : 'sound_effects';
      const url = `https://pixabay.com/api/audio/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&category=${category}&per_page=20`;
      
      // Use Tauri's fetch to bypass CORS in the Webview
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Pixabay API error: ${response.status}`);
      }
      const data = await response.json() as { hits: AudioResult[] };
      setResults(data.hits ?? []);
      if ((data.hits ?? []).length === 0) {
        setError(`No results found for "${query}"`);
      }
    } catch (e: any) {
      setError(`Search failed: ${e?.message ?? e}`);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const togglePlay = (item: AudioResult) => {
    if (playingId === item.id) {
      audioRef.current?.pause();
      setPlayingId(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(item.preview_url || item.audio_url);
      audioRef.current = audio;
      audio.play();
      audio.onended = () => setPlayingId(null);
      setPlayingId(item.id);
    }
  };

  const downloadAndAdd = async (item: AudioResult) => {
    setIsDownloading(item.id);
    setError(null);
    try {
      // Download audio file
      const response = await fetch(item.audio_url);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      
      const arrayBuffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Save to AppLocalData/sounds/
      const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
      await mkdir('sounds', { baseDir: BaseDirectory.AppLocalData, recursive: true });
      
      const ext = item.audio_url.split('.').pop()?.split('?')[0] ?? 'mp3';
      const filename = `pixabay-${item.id}.${ext}`;
      
      const appDataPath = await appLocalDataDir();
      const filePath = await join(appDataPath, 'sounds', filename);
      
      // Write file using Tauri fs plugin
      await writeFile(`sounds/${filename}`, uint8Array, { baseDir: BaseDirectory.AppLocalData });
      
      addAudioSegment({
        id: crypto.randomUUID(),
        path: filePath,
        start: 0,
        duration: item.duration,
        type: activeTab === 'music' ? 'music' : 'sfx',
      });
    } catch (e: any) {
      setError(`Download failed: ${e?.message ?? e}`);
    } finally {
      setIsDownloading(null);
    }
  };

  const analyzeScriptAndRecommend = () => {
    const text = transcript.map(w => w.text.toLowerCase()).join(' ');
    let mood = 'ambient';
    if (text.match(/excited|fast|action|quick|boom|fight/)) mood = 'upbeat';
    else if (text.match(/sad|slow|crying|tears|quiet/)) mood = 'cinematic';
    else if (text.match(/happy|joy|smile|laugh/)) mood = 'happy';
    else if (text.match(/tech|code|future|ai|digital/)) mood = 'electronic';
    setAiMood(mood);
    setSearch(mood);
    searchAudio(mood, 'music');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
        <button
          onClick={() => { setActiveTab('sfx'); setResults([]); setSearch(''); setError(null); }}
          style={{ flex: 1, padding: '6px', background: activeTab === 'sfx' ? 'var(--teal-primary)' : 'transparent', border: '1px solid var(--border)', borderRadius: '4px', color: activeTab === 'sfx' ? '#fff' : 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', transition: 'all 0.15s' }}
        >
          🔊 Sound Effects
        </button>
        <button
          onClick={() => { setActiveTab('music'); setResults([]); setSearch(''); setError(null); }}
          style={{ flex: 1, padding: '6px', background: activeTab === 'music' ? 'var(--teal-primary)' : 'transparent', border: '1px solid var(--border)', borderRadius: '4px', color: activeTab === 'music' ? '#fff' : 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', transition: 'all 0.15s' }}
        >
          🎵 Music
        </button>
      </div>

      {/* API Key notice */}
      {!hasApiKey && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 6, padding: '8px 10px', fontSize: 10, color: '#f59e0b', lineHeight: 1.5 }}>
          <strong>Setup required:</strong> Get a free Pixabay API key at{' '}
          <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => window.open('https://pixabay.com/accounts/register/', '_blank')}>
            pixabay.com
          </span>{' '}
          and paste it in <code>SoundLibrary.tsx</code> at the top.
        </div>
      )}

      {activeTab === 'music' && (
        <button
          onClick={analyzeScriptAndRecommend}
          disabled={!hasApiKey}
          style={{ background: 'var(--teal-glow)', color: 'var(--teal-primary)', border: '1px solid var(--teal-primary)', padding: '8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: hasApiKey ? 'pointer' : 'not-allowed', opacity: hasApiKey ? 1 : 0.5 }}
        >
          ✨ AI Suggest Music from Script
        </button>
      )}

      {aiMood && activeTab === 'music' && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Detected mood: <span style={{ color: 'var(--teal-primary)', fontWeight: 600 }}>{aiMood}</span>
        </div>
      )}

      {/* Search */}
      <div style={{ display: 'flex', gap: '6px' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${activeTab === 'sfx' ? 'sound effects' : 'music'}...`}
          onKeyDown={(e) => e.key === 'Enter' && searchAudio(search, activeTab)}
          style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', padding: '6px 8px', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px' }}
          disabled={!hasApiKey}
        />
        <button
          onClick={() => searchAudio(search, activeTab)}
          disabled={!hasApiKey || isSearching}
          style={{ background: 'var(--panel)', border: '1px solid var(--border)', padding: '0 10px', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-muted)' }}
        >
          {isSearching ? '⏳' : '🔍'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, padding: '6px 8px', fontSize: 10, color: '#fca5a5' }}>
          {error}
        </div>
      )}

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {isSearching && (
          <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', padding: 12 }}>
            Searching Pixabay...
          </div>
        )}

        {!isSearching && results.map(item => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              gap: 6,
            }}
          >
            {/* Play button */}
            <button
              onClick={() => togglePlay(item)}
              style={{
                flexShrink: 0,
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: playingId === item.id ? 'var(--teal-primary)' : 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: playingId === item.id ? '#fff' : 'var(--text-muted)',
                fontSize: 10,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {playingId === item.id ? '⏸' : '▶'}
            </button>

            {/* Info */}
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: '11px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.tags.split(',')[0].trim() || `Track ${item.id}`}
              </span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                {item.duration}s · by {item.user}
              </span>
            </div>

            {/* Add button */}
            <button
              onClick={() => downloadAndAdd(item)}
              disabled={isDownloading === item.id}
              style={{
                flexShrink: 0,
                background: isDownloading === item.id ? 'var(--surface-2)' : 'var(--teal-primary)',
                color: isDownloading === item.id ? 'var(--text-muted)' : '#fff',
                border: 'none',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '10px',
                fontWeight: 600,
                cursor: isDownloading === item.id ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {isDownloading === item.id ? '⏳' : '+ Add'}
            </button>
          </div>
        ))}

        {!isSearching && results.length === 0 && hasApiKey && (
          <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', padding: '16px 0' }}>
            Search for {activeTab === 'sfx' ? 'sound effects' : 'background music'} above
          </div>
        )}
      </div>
    </div>
  );
}
