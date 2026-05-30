// CutFlow AI — App Root
// Assembles the full workspace layout:
//   Header (48px)
//   └── Workspace (flex-1)
//       ├── Sidebar (280px)
//       ├── VideoPlayer (flex-1)
//       └── Right Panel (320px, tabs: Transcript / Chat)
//   Timeline (200px footer)

import { useState } from 'react';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import VideoPlayer from '@/components/VideoPlayer';
import TranscriptView from '@/components/TranscriptView';
import ChatPanel from '@/components/ChatPanel';
import Timeline from '@/components/Timeline';

type RightTab = 'transcript' | 'chat';

export default function App() {
  const [rightTab, setRightTab] = useState<RightTab>('transcript');

  return (
    <div className="app-shell">
      <Header />

      <div className="workspace">
        <Sidebar />
        <VideoPlayer />

        {/* Right panel: tabs for Transcript / Chat */}
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
          </div>
          <div className="right-panel__content">
            {rightTab === 'transcript' ? <TranscriptView /> : <ChatPanel />}
          </div>
        </div>
      </div>

      <Timeline />
    </div>
  );
}
