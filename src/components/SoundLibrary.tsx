import { useState } from 'react';
import { useTimeline } from '../context/TimelineContext';

export default function SoundLibrary() {
  const { addAudioSegment, transcript } = useTimeline();
  const [activeTab, setActiveTab] = useState<'sfx' | 'music'>('sfx');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [aiMood, setAiMood] = useState<string | null>(null);

  // Note: For a production app, use a real API key or proxy backend.
  // We're using a public placeholder approach for demo purposes.
  // const PIXABAY_API_KEY = "YOUR_PIXABAY_API_KEY"; // Placeholder

  const searchAudio = async (query: string, type: 'sfx' | 'music') => {
    if (!query) return;
    setIsSearching(true);
    try {
      // Mocking the API response for this demo since we don't have a real key here.
      // In a real implementation: fetch(`https://pixabay.com/api/audio/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(query)}`)
      await new Promise(r => setTimeout(r, 600)); // simulate network delay
      
      const mockResults = [
        { id: '1', name: `${query} 1`, duration: 4, type, url: `mock://${type}/1` },
        { id: '2', name: `${query} 2`, duration: 8, type, url: `mock://${type}/2` },
        { id: '3', name: `${query} 3`, duration: 12, type, url: `mock://${type}/3` },
      ];
      setResults(mockResults);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearching(false);
    }
  };

  const analyzeScriptAndRecommend = () => {
    // Very simple keyword based mood analysis
    const text = transcript.map(w => w.text.toLowerCase()).join(' ');
    
    let mood = 'ambient'; // default
    if (text.match(/excited|fast|action|quick|boom|fight/)) mood = 'upbeat';
    else if (text.match(/sad|slow|crying|tears|quiet/)) mood = 'cinematic';
    else if (text.match(/happy|joy|smile|laugh/)) mood = 'happy';

    setAiMood(mood);
    setSearch(mood);
    searchAudio(mood, 'music');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
        <button
          onClick={() => { setActiveTab('sfx'); setResults([]); setSearch(''); }}
          style={{ flex: 1, padding: '6px', background: activeTab === 'sfx' ? 'var(--surface)' : 'transparent', border: '1px solid var(--border)', borderRadius: '4px', color: activeTab === 'sfx' ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: '11px', cursor: 'pointer' }}
        >
          Sound Effects
        </button>
        <button
          onClick={() => { setActiveTab('music'); setResults([]); setSearch(''); }}
          style={{ flex: 1, padding: '6px', background: activeTab === 'music' ? 'var(--surface)' : 'transparent', border: '1px solid var(--border)', borderRadius: '4px', color: activeTab === 'music' ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: '11px', cursor: 'pointer' }}
        >
          Music
        </button>
      </div>

      {activeTab === 'music' && (
         <button
           onClick={analyzeScriptAndRecommend}
           style={{ background: 'var(--teal-glow)', color: 'var(--teal-primary)', border: '1px solid var(--teal-primary)', padding: '8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
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
          placeholder={`Search ${activeTab}...`}
          onKeyDown={(e) => e.key === 'Enter' && searchAudio(search, activeTab)}
          style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', padding: '6px 8px', borderRadius: '4px', color: 'var(--text-primary)', fontSize: '12px' }}
        />
        <button onClick={() => searchAudio(search, activeTab)} style={{ background: 'var(--panel)', border: '1px solid var(--border)', padding: '0 10px', borderRadius: '4px', cursor: 'pointer', color: 'var(--text-muted)' }}>
          🔍
        </button>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {isSearching && <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>Searching...</div>}
        
        {!isSearching && results.map(item => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
               <span style={{ fontSize: '11px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
               <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{item.duration}s</span>
            </div>
            <button
              onClick={() => addAudioSegment({ id: crypto.randomUUID(), path: item.url, start: 0, duration: item.duration, type: item.type })}
              style={{ flexShrink: 0, background: 'var(--teal-primary)', color: 'var(--teal-dark)', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', fontWeight: 600, cursor: 'pointer' }}
            >
              + Add
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
