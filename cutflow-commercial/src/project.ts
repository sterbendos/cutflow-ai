import {makeProject} from '@motion-canvas/core';

// Scene imports — the Vite plugin enriches these with name/size/resolutionScale at build time,
// so we cast to satisfy the FullSceneDescription constraint that TS can't see at compile time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import scene1 from './scenes/scene1';
import scene2 from './scenes/scene2';
import scene3 from './scenes/scene3';
import scene4 from './scenes/scene4';
import scene5 from './scenes/scene5';
import scene6 from './scenes/scene6';
import scene7 from './scenes/scene7';

export default makeProject({
  // The `as any` cast is intentional — FullSceneDescription fields (name, size, etc.)
  // are injected by @motion-canvas/vite-plugin at bundle time, not visible to tsc.
  scenes: [scene1, scene2, scene3, scene4, scene5, scene6, scene7] as any,
});
