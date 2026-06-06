/**
 * SCENE 2 — 4s to 8s
 * Reimagined as "The Synthesis of Flow" (Arc/Linear style).
 * Floating white panels with gaps (silences) between them.
 * Gaps compress to 0. Panels slide together and snap magnetically with spring bounce.
 * Fused panels morph into a single seamless bar with a purple gradient flash.
 */
import {makeScene2D, Rect, Txt, Layout, Circle, Gradient} from '@motion-canvas/2d';
import {
  createRef, all, chain, waitFor, easeInOutCubic, easeOutExpo,
  easeOutBack, easeInOutQuart, createSignal, Vector2, linear
} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.fill('#FFFFFF');

  const cameraGroup = createRef<Rect>();
  const layoutContainer = createRef<Layout>();

  // Signals for the empty gaps
  const gap1W = createSignal(240);
  const gap2W = createSignal(180);
  const gap3W = createSignal(220);

  // Position offsets for the spring snap bounce
  const snap1 = createSignal(new Vector2(0, 0));
  const snap2 = createSignal(new Vector2(0, 0));
  const snap3 = createSignal(new Vector2(0, 0));

  // Visual cues for the merging joints
  const flash1 = createRef<Circle>();
  const flash2 = createRef<Circle>();
  const flash3 = createRef<Circle>();

  // Inner border opacity (fades out as they merge)
  const borderOpacity = createSignal(1);
  const fusionGradient = createSignal(0); // Fuses into single gradient

  const FONT = 'Outfit, sans-serif';

  view.add(
    <Rect
      ref={cameraGroup}
      width={3840}
      height={2160}
      clip={true}
      fill={'#FFFFFF'}
      scale={1.1}
      position={[0, 0]}
    >
      <Layout
        ref={layoutContainer}
        layout={true}
        direction={'row'}
        alignItems={'center'}
        justifyContent={'center'}
        gap={0}
      >
        {/* Panel 1 */}
        <Rect
          width={400}
          height={320}
          fill={'#FAFAFA'}
          radius={16}
          stroke={'#E5E7EB'}
          lineWidth={2}
          shadowColor={'rgba(0,0,0,0.03)'}
          shadowBlur={20}
          position={() => snap1()}
        />

        {/* Gap 1 (Silence) */}
        <Rect
          width={() => gap1W()}
          height={320}
          fill={'#FEF2F2'}
          stroke={'#FCA5A5'}
          lineWidth={1.5}
          lineDash={[6, 4]}
          radius={8}
          alignItems={'center'}
          justifyContent={'center'}
          clip={true}
          opacity={() => gap1W() > 10 ? 1 : 0}
        >
          <Txt
            text={'SILENCE'}
            fontFamily={FONT}
            fontSize={20}
            fontWeight={700}
            fill={'#EF4444'}
            letterSpacing={2}
            opacity={() => gap1W() > 120 ? 0.7 : 0}
          />
        </Rect>

        {/* Panel 2 */}
        <Rect
          width={480}
          height={320}
          fill={'#FAFAFA'}
          radius={16}
          stroke={'#E5E7EB'}
          lineWidth={2}
          shadowColor={'rgba(0,0,0,0.03)'}
          shadowBlur={20}
          position={() => snap2()}
        />

        {/* Gap 2 (Silence) */}
        <Rect
          width={() => gap2W()}
          height={320}
          fill={'#FEF2F2'}
          stroke={'#FCA5A5'}
          lineWidth={1.5}
          lineDash={[6, 4]}
          radius={8}
          alignItems={'center'}
          justifyContent={'center'}
          clip={true}
          opacity={() => gap2W() > 10 ? 1 : 0}
        >
          <Txt
            text={'SILENCE'}
            fontFamily={FONT}
            fontSize={20}
            fontWeight={700}
            fill={'#EF4444'}
            letterSpacing={2}
            opacity={() => gap2W() > 120 ? 0.7 : 0}
          />
        </Rect>

        {/* Panel 3 */}
        <Rect
          width={420}
          height={320}
          fill={'#FAFAFA'}
          radius={16}
          stroke={'#E5E7EB'}
          lineWidth={2}
          shadowColor={'rgba(0,0,0,0.03)'}
          shadowBlur={20}
          position={() => snap3()}
        />

        {/* Gap 3 (Silence) */}
        <Rect
          width={() => gap3W()}
          height={320}
          fill={'#FEF2F2'}
          stroke={'#FCA5A5'}
          lineWidth={1.5}
          lineDash={[6, 4]}
          radius={8}
          alignItems={'center'}
          justifyContent={'center'}
          clip={true}
          opacity={() => gap3W() > 10 ? 1 : 0}
        >
          <Txt
            text={'SILENCE'}
            fontFamily={FONT}
            fontSize={20}
            fontWeight={700}
            fill={'#EF4444'}
            letterSpacing={2}
            opacity={() => gap3W() > 120 ? 0.7 : 0}
          />
        </Rect>

        {/* Panel 4 */}
        <Rect
          width={520}
          height={320}
          fill={'#FAFAFA'}
          radius={16}
          stroke={'#E5E7EB'}
          lineWidth={2}
          shadowColor={'rgba(0,0,0,0.03)'}
          shadowBlur={20}
        />
      </Layout>

      {/* Unified Overlay Gradient (revealed after snap) */}
      <Rect
        width={1820}
        height={320}
        radius={16}
        fill={() => new Gradient({
          type: 'linear',
          from: [-910, 0],
          to: [910, 0],
          stops: [
            {offset: 0, color: '#6366F1'},
            {offset: 1, color: '#8B5CF6'}
          ]
        })}
        opacity={() => fusionGradient()}
        position={[0, 0]}
      />

      {/* Snap Flashes */}
      <Circle
        ref={flash1}
        size={0}
        stroke={'#6366F1'}
        lineWidth={3}
        position={[-470, 0]}
        opacity={0}
      />
      <Circle
        ref={flash2}
        size={0}
        stroke={'#6366F1'}
        lineWidth={3}
        position={[10, 0]}
        opacity={0}
      />
      <Circle
        ref={flash3}
        size={0}
        stroke={'#6366F1'}
        lineWidth={3}
        position={[450, 0]}
        opacity={0}
      />
    </Rect>
  );

  // ── ANIMATION TIMELINE ────────────────────────────────────────────────────

  // 1. Initial drift
  yield* cameraGroup().position([0, -30], 1.0, easeInOutCubic);

  // 2. Sequential silence gap collapse & snap springs
  yield* all(
    // Gap 1 collapses
    gap1W(0, 0.6, easeInOutQuart),
    chain(
      waitFor(0.55),
      all(
        snap1(new Vector2(-15, 0), 0.12, easeOutBack).to(new Vector2(0, 0), 0.22, easeOutBack),
        flash1().size(220, 0.45, easeOutExpo),
        flash1().opacity(1, 0.05).to(0, 0.4, easeOutExpo)
      )
    ),

    // Gap 2 collapses
    chain(
      waitFor(0.35),
      gap2W(0, 0.6, easeInOutQuart)
    ),
    chain(
      waitFor(0.9),
      all(
        snap2(new Vector2(-15, 0), 0.12, easeOutBack).to(new Vector2(0, 0), 0.22, easeOutBack),
        flash2().size(220, 0.45, easeOutExpo),
        flash2().opacity(1, 0.05).to(0, 0.4, easeOutExpo)
      )
    ),

    // Gap 3 collapses
    chain(
      waitFor(0.7),
      gap3W(0, 0.6, easeInOutQuart)
    ),
    chain(
      waitFor(1.25),
      all(
        snap3(new Vector2(-15, 0), 0.12, easeOutBack).to(new Vector2(0, 0), 0.22, easeOutBack),
        flash3().size(220, 0.45, easeOutExpo),
        flash3().opacity(1, 0.05).to(0, 0.4, easeOutExpo)
      )
    )
  );

  // 3. Fusion: The separate panels blend into a single premium gradient bar
  yield* all(
    fusionGradient(1, 0.75, easeOutExpo),
    cameraGroup().scale(1.0, 1.0, easeInOutCubic),
    cameraGroup().position([0, 0], 1.0, easeInOutCubic)
  );

  // 4. Shrink and fade the unified bar to set up next scene
  yield* all(
    fusionGradient(0.2, 0.6, easeInOutCubic),
    layoutContainer().scale(0.8, 0.6, easeInOutCubic),
    layoutContainer().opacity(0, 0.6, easeInOutCubic)
  );
  yield* waitFor(0.2);
});
