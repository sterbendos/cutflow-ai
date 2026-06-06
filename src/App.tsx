// CutFlow AI — App Root
// Assembles the full workspace layout:
//   Header (48px)
//   └── Workspace (flex-1)
//       ├── Sidebar (280px)
//       ├── VideoPlayer (flex-1)
//       └── Right Panel (320px, tabs: Transcript / Chat / Inspector)
//   Timeline (200px footer)

import { useState } from 'react';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import VideoPlayer from '@/components/VideoPlayer';
import TranscriptView from '@/components/TranscriptView';
import ChatPanel from '@/components/ChatPanel';
import Timeline from '@/components/Timeline';
import WelcomeScreen from '@/components/WelcomeScreen';
import TransformInspector from '@/components/TransformInspector';
import { useTimeline } from '@/context/TimelineContext';
import { useEffects } from '@/context/EffectsContext';
import { AnimatePresence } from 'framer-motion';

type RightTab = 'transcript' | 'chat' | 'inspector';

export default function App() {
  const [rightTab, setRightTab] = useState<RightTab>('transcript');
  const [selectedBRollId, setSelectedBRollId] = useState<string | null>(null);
  const { effects, setEffects } = useEffects();
  const { state } = useTimeline();
  const hasVideo = Boolean(state.source_video_path);

  // When a B-Roll is selected, auto-switch to Inspector tab
  const handleSelectBRoll = (id: string | null) => {
    setSelectedBRollId(id);
    if (id) setRightTab('inspector');
  };

  return (
    <div className="app-shell">
      <AnimatePresence>
        {!hasVideo && <WelcomeScreen key="welcome" />}
      </AnimatePresence>

      <Header />

      <div className="workspace">
        <Sidebar />
        <VideoPlayer />

        {/* Right panel: tabs for Transcript / Chat / Inspector */}
        <div className="right-panel">
          <div className="right-panel__tabs">
            <button
              className={`right-panel__tab${rightTab === 'transcript' ? ' active' : ''}`}
              onClick={() => setRightTab('transcript')}
            >
              Transcript
            </button>
            <button
              className={`right-panel__tab${rightTab === 'chat' ? ' active' : ''}`}
              onClick={() => setRightTab('chat')}
            >
              AI Chat
            </button>
            <button
              className={`right-panel__tab${rightTab === 'inspector' ? ' active' : ''}`}
              onClick={() => setRightTab('inspector')}
            >
              Inspector
            </button>
          </div>
          <div className="right-panel__content">
            {rightTab === 'transcript' && <TranscriptView />}
            {rightTab === 'chat' && <ChatPanel />}
            {rightTab === 'inspector' && (
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', height: '100%' }}>
                <TransformInspector
                  selectedBRollId={selectedBRollId}
                  effects={effects}
                  onEffectsChange={setEffects}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <Timeline onSelectBRoll={handleSelectBRoll} />
    </div>
  );
}
