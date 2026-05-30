// CutFlow AI — Sidebar Component
// 280px tabbed panel: Media, Audio, Effects, Agents

import { useState } from 'react';
import AudioRecorder from './AudioRecorder';
import SoundLibrary from './SoundLibrary';
import CaptionEditor from './CaptionEditor';
import TransitionPicker from './TransitionPicker';
import MCPConfigPanel from './MCPConfigPanel';
import TemplateBrowser from './TemplateBrowser';
import AssetBrowser from './AssetBrowser';

type TabId = 'media' | 'audio' | 'effects' | 'agents';

const TABS: { id: TabId; label: string }[] = [
  { id: 'media', label: 'Media' },
  { id: 'audio', label: 'Audio' },
  { id: 'effects', label: 'Effects' },
  { id: 'agents', label: 'Agents' },
];

const TAB_STYLE = (active: boolean, isAgents: boolean): React.CSSProperties => ({
  flex: 1,
  padding: '6px',
  background: active ? 'var(--surface)' : 'transparent',
  border: '1px solid var(--border)',
  borderBottom: 'none',
  borderRadius: '4px 4px 0 0',
  color: active ? (isAgents ? 'var(--teal-primary)' : 'var(--text-primary)') : 'var(--text-muted)',
  fontSize: '11px',
  cursor: 'pointer',
  fontWeight: active ? 700 : 600,
});

export default function Sidebar() {
  const [activeTab, setActiveTab] = useState<TabId>('media');

  return (
    <aside className="sidebar" aria-label="Asset panel">
      {/* Header */}
      <div className="sidebar__header">
        <span className="sidebar__section-title">{TABS.find(t => t.id === activeTab)?.label ?? 'Assets'}</span>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '4px', padding: '12px 14px 0' }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={TAB_STYLE(activeTab === tab.id, tab.id === 'agents')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="sidebar__content" style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
        {activeTab === 'media' && <AssetBrowser />}
        {activeTab === 'audio' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
            <AudioRecorder />
            <SoundLibrary />
          </div>
        )}
        {activeTab === 'effects' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <CaptionEditor />
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <TemplateBrowser />
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <TransitionPicker />
            </div>
          </div>
        )}
        {activeTab === 'agents' && <MCPConfigPanel />}
      </div>
    </aside>
  );
}
