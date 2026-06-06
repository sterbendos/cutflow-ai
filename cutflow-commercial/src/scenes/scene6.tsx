/**
 * SCENE 6 — 20s to 24s
 * Reimagined as "The Convergence" (Arc/Linear style).
 * A cloud of floating geometry (representing all previous features) rotates in parallax.
 * The elements pull backward as the camera retracts, then get sucked into the center.
 * They collide, creating a clean white flash.
 * Out of the convergence, the letters "C U T F L O W" emerge, expanding their letter spacing
 * as they settle.
 */
import {makeScene2D, Rect, Txt, Layout, Circle, Line} from '@motion-canvas/2d';
import {
  createRef, all, chain, waitFor, easeInOutCubic, easeOutExpo,
  easeOutBack, createSignal, Vector2, linear
} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.fill('#FFFFFF');

  const cameraGroup = createRef<Rect>();
  const elementsGroup = createRef<Layout>();
  const collisionFlash = createRef<Circle>();
  const logoText = createRef<Txt>();

  const letterSpacingSignal = createSignal(4);
  const logoScale = createSignal(0);
  const logoOpacity = createSignal(0);

  const FONT = 'Outfit, sans-serif';

  // 15 scattered geometric elements representing features
  const elementCount = 15;
  const elements = Array.from({length: elementCount}, (_, i) => {
    const ref = createRef<Rect>();
    // Pre-calculate positions
    const angle = (i * 2 * Math.PI) / elementCount;
    const dist = 300 + Math.sin(i * 3) * 150;
    const startPos = new Vector2(Math.cos(angle) * dist, Math.sin(angle) * dist);
    return {ref, startPos, index: i};
  });

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
      {/* Parallax Cloud of Elements */}
      <Layout ref={elementsGroup} position={[0, 0]} opacity={1}>
        {elements.map((el) => {
          const isCircle = el.index % 3 === 0;
          const isText = el.index % 3 === 1;
          return (
            <Rect
              ref={el.ref}
              width={isCircle ? 60 : (isText ? 140 : 100)}
              height={isCircle ? 60 : 40}
              radius={isCircle ? 30 : 8}
              stroke={'#E5E7EB'}
              lineWidth={1.5}
              fill={'#FAFAFA'}
              position={el.startPos}
              opacity={0.6}
            />
          );
        })}
      </Layout>

      {/* Collision flash circle */}
      <Circle
        ref={collisionFlash}
        size={0}
        fill={'rgba(99, 102, 241, 0.15)'}
        position={[0, 0]}
        opacity={0}
      />

      {/* The CUTFLOW logo */}
      <Txt
        ref={logoText}
        text={'CUTFLOW'}
        fontFamily={FONT}
        fontSize={100}
        fontWeight={800}
        fill={'#111111'}
        letterSpacing={() => letterSpacingSignal()}
        scale={() => logoScale()}
        opacity={() => logoOpacity()}
        position={[0, 0]}
      />
    </Rect>
  );

  // ── ANIMATION TIMELINE ────────────────────────────────────────────────────

  // Let the cloud drift in a subtle rotation
  yield* all(
    elementsGroup().rotation(25, 4.0, linear),
    elementsGroup().scale(0.9, 1.2, easeInOutCubic),
    chain(
      // 1. Initial drift
      cameraGroup().scale(1.1, 0.8, easeInOutCubic),
      // 2. Gravitational pull: elements rush to center
      all(
        ...elements.map((el) => el.ref().position(new Vector2(0, 0), 1.0, easeInOutCubic)),
        ...elements.map((el) => el.ref().opacity(0, 0.9, easeInOutCubic)),
        elementsGroup().scale(0.2, 1.0, easeInOutCubic),
        cameraGroup().scale(0.9, 1.0, easeInOutCubic)
      ),
      // 3. Collision: flash expansion, logo emergence
      all(
        collisionFlash().size(1600, 0.5, easeOutExpo),
        collisionFlash().opacity(1, 0.05).to(0, 0.45, easeOutExpo),
        logoOpacity(1, 0.4, easeOutExpo),
        logoScale(1.0, 0.75, easeOutBack),
        letterSpacingSignal(32, 1.25, easeOutExpo)
      ),
      // 4. Subtle logo hold & drift
      all(
        cameraGroup().position([0, -10], 1.2, easeInOutCubic),
        logoScale(0.95, 1.2, easeInOutCubic),
        logoOpacity(0.1, 1.2, easeInOutCubic) // Fade out to transition to Scene 7
      )
    )
  );
});
