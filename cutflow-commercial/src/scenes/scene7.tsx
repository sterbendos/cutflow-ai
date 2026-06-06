/**
 * SCENE 7 — 24s to 27s
 * Reimagined as "The Open Canvas" (Arc/Linear style).
 * The CUTFLOW logo fades out completely.
 * In the center of the clean canvas, the final URL materializes:
 * "cutflow.ai / you"
 * The "/ you" segment is highlighted in a gorgeous purple-indigo gradient.
 * A subtle cursor dot breathes gently beside it until the final frame.
 */
import {makeScene2D, Rect, Txt, Layout, Circle, Gradient} from '@motion-canvas/2d';
import {
  createRef, all, chain, waitFor, easeInOutCubic, easeOutExpo,
  easeOutBack, createSignal, Vector2, linear
} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.fill('#FFFFFF');

  const cameraGroup = createRef<Rect>();
  const ctaContainer = createRef<Layout>();
  const textLeft = createRef<Txt>();
  const textRight = createRef<Txt>();
  const cursorDot = createRef<Circle>();

  const dotScale = createSignal(1);

  const FONT = 'Outfit, sans-serif';

  view.add(
    <Rect
      ref={cameraGroup}
      width={3840}
      height={2160}
      clip={true}
      fill={'#FFFFFF'}
      scale={1}
      position={[0, 0]}
    >
      {/* ── Call to Action URL ── */}
      <Layout
        ref={ctaContainer}
        layout={true}
        direction={'row'}
        alignItems={'center'}
        justifyContent={'center'}
        gap={20}
        position={[0, 0]}
        opacity={0}
        scale={0.92}
      >
        <Txt
          ref={textLeft}
          text={'cutflow.ai'}
          fontFamily={FONT}
          fontSize={76}
          fontWeight={800}
          fill={'#111111'}
          letterSpacing={1.5}
        />
        <Txt
          ref={textRight}
          text={'/ you'}
          fontFamily={FONT}
          fontSize={76}
          fontWeight={800}
          fill={new Gradient({
            type: 'linear',
            from: [-60, 0],
            to: [60, 0],
            stops: [
              {offset: 0, color: '#6366F1'},
              {offset: 1, color: '#8B5CF6'}
            ]
          })}
          letterSpacing={1.5}
        />
        {/* Breathing Cursor Dot */}
        <Circle
          ref={cursorDot}
          size={16}
          fill={'#8B5CF6'}
          marginLeft={10}
          scale={() => dotScale()}
          shadowColor={'rgba(139, 92, 246, 0.4)'}
          shadowBlur={10}
        />
      </Layout>
    </Rect>
  );

  // ── ANIMATION TIMELINE ────────────────────────────────────────────────────

  // Cursor dot breathing animation running in parallel
  yield* all(
    chain(
      dotScale(1.4, 0.5, easeInOutCubic).to(1.0, 0.5, easeInOutCubic),
      dotScale(1.4, 0.5, easeInOutCubic).to(1.0, 0.5, easeInOutCubic),
      dotScale(1.4, 0.5, easeInOutCubic).to(1.0, 0.5, easeInOutCubic)
    ),
    chain(
      // 1. Initial wait for Scene 6 logo dissolve
      waitFor(0.3),
      // 2. URL fades and scales in
      all(
        ctaContainer().opacity(1, 0.8, easeOutExpo),
        ctaContainer().scale(1.0, 0.8, easeOutBack),
        cameraGroup().scale(1.03, 2.7, easeInOutCubic) // slow camera drift in
      ),
      // 3. Final settle hold
      waitFor(1.6)
    )
  );
});
