// CutFlow AI — React 19 Entry Point

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { TimelineProvider } from './context/TimelineContext';
import { CaptionProvider } from './context/CaptionContext';
import { MotionGraphicsProvider } from './context/MotionGraphicsContext';
import { EffectsProvider } from './context/EffectsContext';

const rootEl = document.getElementById('root');

if (!rootEl) {
  throw new Error('[CutFlow AI] Root element #root not found in DOM');
}

import React from 'react';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return <div style={{ color: 'red', padding: 20, whiteSpace: 'pre-wrap', background: '#222', minHeight: '100vh', zIndex: 9999 }}>
        <h2>Runtime Error</h2>
        {err.message}<br/>
        {err.stack}
      </div>;
    }
    return this.props.children;
  }
}

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <TimelineProvider>
        <EffectsProvider>
          <CaptionProvider>
            <MotionGraphicsProvider>
              <App />
            </MotionGraphicsProvider>
          </CaptionProvider>
        </EffectsProvider>
      </TimelineProvider>
    </ErrorBoundary>
  </StrictMode>
);
