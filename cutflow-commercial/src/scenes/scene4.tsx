/**
 * SCENE 4 — 12s to 16s
 * Reimagined as "The Dimension of Form" (Arc/Linear style).
 * A single central frame with rotating nested indigo rings (abstract video artwork).
 * The frame splits dynamically in a cell-division motion, expanding into three formats:
 * Wide (16:9), Vertical (9:16), and Square (1:1).
 * The inner rings scale and re-compose themselves inside each format as the camera pans.
 */
import {makeScene2D, Rect, Circle, Layout} from '@motion-canvas/2d';
import {
  createRef, all, chain, waitFor, easeInOutCubic, easeOutExpo,
  easeOutBack, createSignal, Vector2, linear
} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.fill('#FFFFFF');

  const cameraGroup = createRef<Rect>();

  // Individual frame references
  const frameWide = createRef<Rect>();
  const frameVert = createRef<Rect>();
  const frameSquare = createRef<Rect>();

  // Positions and scales for the split
  const posWide = createSignal(new Vector2(0, 0));
  const posVert = createSignal(new Vector2(0, 0));
  const posSquare = createSignal(new Vector2(0, 0));

  const scaleWide = createSignal(1);
  const scaleVert = createSignal(0); // starts hidden
  const scaleSquare = createSignal(0); // starts hidden

  // Rotation of internal rings
  const ringRot = createSignal(0);

  view.add(
    <Rect
      ref={cameraGroup}
      width={3840}
      height={2160}
      clip={true}
      fill={'#FFFFFF'}
      scale={1.25}
      position={[0, 0]}
    >
      {/* ── Wide Format Frame (16:9) ── */}
      <Rect
        ref={frameWide}
        width={720}
        height={405}
        radius={24}
        stroke={'#E5E7EB'}
        lineWidth={2.5}
        fill={'#FAFAFA'}
        shadowColor={'rgba(0,0,0,0.03)'}
        shadowBlur={30}
        position={() => posWide()}
        scale={() => scaleWide()}
        clip={true}
      >
        <Layout rotation={() => ringRot()}>
          <Circle size={280} stroke={'#6366F1'} lineWidth={3} opacity={0.15} />
          <Circle size={180} stroke={'#8B5CF6'} lineWidth={3.5} />
          <Circle size={80} stroke={'#6366F1'} lineWidth={4} />
          <Circle size={24} fill={'#111111'} />
        </Layout>
      </Rect>

      {/* ── Square Format Frame (1:1) ── */}
      <Rect
        ref={frameSquare}
        width={480}
        height={480}
        radius={24}
        stroke={'#E5E7EB'}
        lineWidth={2.5}
        fill={'#FAFAFA'}
        shadowColor={'rgba(0,0,0,0.03)'}
        shadowBlur={30}
        position={() => posSquare()}
        scale={() => scaleSquare()}
        clip={true}
      >
        <Layout rotation={() => -ringRot() * 1.2}>
          <Circle size={320} stroke={'#6366F1'} lineWidth={3} opacity={0.15} />
          <Circle size={220} stroke={'#8B5CF6'} lineWidth={3.5} />
          <Circle size={100} stroke={'#6366F1'} lineWidth={4} />
          <Circle size={24} fill={'#111111'} />
        </Layout>
      </Rect>

      {/* ── Vertical Format Frame (9:16) ── */}
      <Rect
        ref={frameVert}
        width={340}
        height={600}
        radius={24}
        stroke={'#E5E7EB'}
        lineWidth={2.5}
        fill={'#FAFAFA'}
        shadowColor={'rgba(0,0,0,0.03)'}
        shadowBlur={30}
        position={() => posVert()}
        scale={() => scaleVert()}
        clip={true}
      >
        <Layout rotation={() => ringRot() * 0.8}>
          <Circle size={240} stroke={'#6366F1'} lineWidth={3} opacity={0.15} />
          <Circle size={150} stroke={'#8B5CF6'} lineWidth={3.5} />
          <Circle size={70} stroke={'#6366F1'} lineWidth={4} />
          <Circle size={20} fill={'#111111'} />
        </Layout>
      </Rect>
    </Rect>
  );

  // ── ANIMATION TIMELINE ────────────────────────────────────────────────────

  // Run the rotation signal continuously (4 seconds total)
  yield* all(
    ringRot(360, 4.0, linear),
    chain(
      // 1. Initial drift
      cameraGroup().position([0, -15], 0.6, easeInOutCubic),
      // 2. The Split (Cell-division)
      all(
        // Wide frame slides left
        posWide(new Vector2(-660, 0), 1.6, easeInOutCubic),
        scaleWide(0.9, 1.6, easeInOutCubic),

        // Square frame emerges in the center
        scaleSquare(1.0, 1.4, easeOutBack),
        posSquare(new Vector2(0, 0), 1.6, easeInOutCubic),

        // Vertical frame emerges and slides right
        scaleVert(0.9, 1.4, easeOutBack),
        posVert(new Vector2(660, 0), 1.6, easeInOutCubic),

        // Camera pulls back and pans diagonally to reveal the layout
        cameraGroup().scale(0.95, 1.6, easeInOutCubic),
        cameraGroup().position([0, 10], 1.6, easeInOutCubic)
      ),
      // 3. Float and settle
      all(
        posWide(new Vector2(-680, 20), 1.2, easeInOutCubic),
        posVert(new Vector2(680, -20), 1.2, easeInOutCubic),
        cameraGroup().position([10, -10], 1.2, easeInOutCubic)
      ),
      // 4. Fade out all frames for next scene
      all(
        scaleWide(0, 0.55, easeInOutCubic),
        scaleVert(0, 0.55, easeInOutCubic),
        scaleSquare(0, 0.55, easeInOutCubic),
        cameraGroup().scale(1.15, 0.55, easeInOutCubic)
      )
    )
  );
});
