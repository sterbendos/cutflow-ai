import {defineConfig} from 'vite';
import motionCanvas from '@motion-canvas/vite-plugin';

export default defineConfig({
  plugins: [
    motionCanvas.default
      ? motionCanvas.default()
      : (motionCanvas as unknown as () => unknown)(),
  ],
});
