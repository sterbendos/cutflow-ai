// CutFlow AI — App Root
// Assembles the full workspace layout:
//   Header (48px)
//   └── Workspace (flex-1)
//       ├── Sidebar (280px)
//       ├── VideoPlayer (flex-1)
//       └── TranscriptView (320px)
//   Timeline (200px footer)

import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import VideoPlayer from '@/components/VideoPlayer';
import TranscriptView from '@/components/TranscriptView';
import Timeline from '@/components/Timeline';

export default function App() {
  return (
    <div className="app-shell">
      {/* Top bar */}
      <Header />

      {/* Main workspace row */}
      <div className="workspace">
        <Sidebar />
        <VideoPlayer />
        <TranscriptView />
      </div>

      {/* Multitrack timeline footer */}
      <Timeline />
    </div>
  );
}
