// Global test setup for Vitest
// This runs before every test file in the jsdom environment

import '@testing-library/jest-dom';

// Polyfill crypto.randomUUID for jsdom if not available
if (typeof crypto.randomUUID === 'undefined') {
  (crypto as any).randomUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };
}

// Mock AudioContext for jsdom environments
if (typeof window.AudioContext === 'undefined') {
  (window as any).AudioContext = class MockAudioContext {
    sampleRate = 16000;
    decodeAudioData() {
      return Promise.resolve({
        getChannelData: () => new Float32Array(16000),
        duration: 1,
        length: 16000,
        numberOfChannels: 1,
      });
    }
    close() {}
  };
}
