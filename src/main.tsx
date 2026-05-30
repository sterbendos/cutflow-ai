// CutFlow AI — React 19 Entry Point

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { TimelineProvider } from './context/TimelineContext';
import { CaptionProvider } from './context/CaptionContext';
import { MotionGraphicsProvider } from './context/MotionGraphicsContext';

const rootEl = document.getElementById('root');

if (!rootEl) {
  throw new Error('[CutFlow AI] Root element #root not found in DOM');
}

createRoot(rootEl).render(
  <StrictMode>
    <TimelineProvider>
      <CaptionProvider>
        <MotionGraphicsProvider>
          <App />
        </MotionGraphicsProvider>
      </CaptionProvider>
    </TimelineProvider>
  </StrictMode>
);
