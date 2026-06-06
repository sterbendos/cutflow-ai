/**
 * SCENE 1 — 0s to 4s
 * Reimagined as "The Genesis of Order" (Arc/Linear style).
 * A cloud of chaotic, vibrating particles representing raw media.
 * A vertical line of pure light sweeps across, crystallizing them into a perfect, 
 * clean horizontal array of rounded panels.
 */
import {makeScene2D, Rect, Line, Circle, Layout, Gradient} from '@motion-canvas/2d';
import {
  createRef, all, chain, waitFor, easeInOutCubic, easeOutExpo,
  easeOutBack, linear, Vector2, createSignal
} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.fill('#FFFFFF');

  const cameraGroup = createRef<Rect>();
  const scanline = createRef<Line>();
  const scanlineX = createSignal(-1400);
  const scanlineOpacity = createSignal(0);

  // Custom time signal for smooth, controllable particle noise
  const time = createSignal(0);

  // Create 10 particles with deterministic pseudo-random offsets
  const particleCount = 10;
  const particles = Array.from({length: particleCount}, (_, i) => {
    const ref = createRef<Rect>();
    const seedX = Math.sin(i * 1.7) * 450;
    const seedY = Math.cos(i * 2.3) * 350;
    const rawOffset = new Vector2(seedX, seedY);
    const cleanPos = new Vector2((i - (particleCount - 1) / 2) * 160, 0);
    return {ref, rawOffset, cleanPos, index: i};
  });

  // Calculate crystallization local factor based on scanline passage
  const getCrystallization = (i: number) => {
    const targetX = (i - (particleCount - 1) / 2) * 160;
    return () => {
      const currentScanX = scanlineX();
      const dist = currentScanX - targetX;
      // Crystallizes as the scanline passes (within a 300px transition window)
      return Math.max(0, Math.min(1, (dist + 150) / 300));
    };
  };

  view.add(
    <Rect
      ref={cameraGroup}
      width={3840}
      height={2160}
      clip={true}
      fill={'#FFFFFF'}
      scale={1.2}
      position={[-50, -30]}
    >
      {/* Abstract chaotic particles */}
      {particles.map((p) => {
        const cFactor = getCrystallization(p.index);
        const isCenter = p.index === 5; // Highlight one particle as key branding
        return (
          <Rect
            ref={p.ref}
            width={120}
            height={120}
            radius={() => 24 + (1 - cFactor()) * 20}
            lineWidth={2}
            stroke={() => isCenter ? '#6366F1' : '#E5E7EB'}
            fill={() => {
              if (isCenter) {
                return new Gradient({
                  type: 'linear',
                  from: [-60, -60],
                  to: [60, 60],
                  stops: [
                    {offset: 0, color: '#6366F1'},
                    {offset: 1, color: '#8B5CF6'}
                  ]
                });
              }
              return '#FAFAFA';
            }}
            opacity={() => 0.3 + cFactor() * 0.7}
            position={() => {
              const c = cFactor();
              const t = time();
              // High-frequency organic vibration when raw, shrinking to zero as c goes to 1
              const noiseX = Math.sin(t * 22 + p.index * 1.7) * 55 * (1 - c);
              const noiseY = Math.cos(t * 18 + p.index * 2.3) * 55 * (1 - c);
              const rawPos = p.rawOffset.add(new Vector2(noiseX, noiseY));
              return Vector2.lerp(rawPos, p.cleanPos, c);
            }}
            rotation={() => {
              const c = cFactor();
              const t = time();
              // Oscillate rotation when raw, settle to 0 when crystallized
              return (1 - c) * (Math.sin(t * 14 + p.index) * 35);
            }}
          />
        );
      })}

      {/* The Scanning Beam */}
      <Line
        ref={scanline}
        points={() => [
          [scanlineX(), -500],
          [scanlineX(), 500]
        ]}
        stroke={'#6366F1'}
        lineWidth={3}
        opacity={scanlineOpacity}
        shadowColor={'rgba(99, 102, 241, 0.4)'}
        shadowBlur={20}
      />
    </Rect>
  );

  // ── ANIMATION TIMELINE ────────────────────────────────────────────────────

  // Run the time accumulator in parallel with all animations (duration = 4.0s)
  yield* all(
    time(4, 4.0, linear),
    chain(
      // 1. Initial drift
      cameraGroup().position([-20, -10], 0.6, easeInOutCubic),
      // 2. Sweep scanline across
      all(
        scanlineOpacity(1, 0.4, easeInOutCubic),
        scanlineX(1400, 2.4, easeInOutCubic),
        cameraGroup().scale(1.0, 2.4, easeInOutCubic),
        cameraGroup().position([0, 0], 2.4, easeInOutCubic),
      ),
      // 3. Fade out scanline & subtle settle
      all(
        scanlineOpacity(0, 0.4, easeInOutCubic),
        cameraGroup().position([0, 10], 0.6, easeInOutCubic),
      )
    )
  );
});
