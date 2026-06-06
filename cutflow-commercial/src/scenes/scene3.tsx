/**
 * SCENE 3 — 8s to 12s
 * Reimagined as "The Word Manifest" (Arc/Linear style).
 * An oscillating voice wave at the top sheds particles.
 * As each particle drops and hits the canvas, a word materializes in kinetic typography:
 * "Flowing from sound to word."
 * The wave then flattens out, representing speech resolved into clear text.
 */
import {makeScene2D, Rect, Txt, Layout, Circle, Line} from '@motion-canvas/2d';
import {
  createRef, all, chain, waitFor, easeInOutCubic, easeOutExpo,
  easeOutBack, easeInCubic, linear, createSignal, Vector2
} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.fill('#FFFFFF');

  const cameraGroup = createRef<Rect>();
  const waveContainer = createRef<Layout>();
  const textContainer = createRef<Layout>();

  // Word refs
  const w1 = createRef<Txt>();
  const w2 = createRef<Txt>();
  const w3 = createRef<Txt>();
  const w4 = createRef<Txt>();
  const w5 = createRef<Txt>();

  // Particle refs
  const p1 = createRef<Circle>();
  const p2 = createRef<Circle>();
  const p3 = createRef<Circle>();
  const p4 = createRef<Circle>();
  const p5 = createRef<Circle>();

  // Signals for wave oscillation control
  const waveDampening = createSignal(1); // 1 = max oscillation, 0 = flat line
  const time = createSignal(0);

  const FONT = 'Outfit, sans-serif';

  // We have 24 bars in the audio wave
  const barCount = 24;
  const bars = Array.from({length: barCount}, (_, i) => {
    const ref = createRef<Rect>();
    return {ref, index: i};
  });

  view.add(
    <Rect
      ref={cameraGroup}
      width={3840}
      height={2160}
      clip={true}
      fill={'#FFFFFF'}
      scale={1.15}
      position={[0, 0]}
    >
      {/* ── Top Voice Wave ── */}
      <Layout
        ref={waveContainer}
        layout={true}
        direction={'row'}
        alignItems={'center'}
        justifyContent={'center'}
        gap={12}
        position={[0, -250]}
      >
        {bars.map((bar) => (
          <Rect
            ref={bar.ref}
            width={12}
            height={() => {
              const t = time();
              const d = waveDampening();
              // Create dynamic wave oscillation
              const offset = bar.index * 0.4;
              const baseHeight = 40 + Math.sin(t * 15 + offset) * 120;
              return 20 + baseHeight * d;
            }}
            radius={6}
            fill={'#E5E7EB'}
            stroke={'#6366F1'}
            lineWidth={() => {
              const d = waveDampening();
              return d > 0.1 ? 1.5 : 0;
            }}
          />
        ))}
      </Layout>

      {/* ── Dropping Particles ── */}
      <Circle ref={p1} size={20} fill={'#6366F1'} position={[-440, -250]} opacity={0} />
      <Circle ref={p2} size={20} fill={'#6366F1'} position={[-200, -250]} opacity={0} />
      <Circle ref={p3} size={20} fill={'#8B5CF6'} position={[20, -250]}  opacity={0} />
      <Circle ref={p4} size={20} fill={'#6366F1'} position={[240, -250]}  opacity={0} />
      <Circle ref={p5} size={20} fill={'#8B5CF6'} position={[440, -250]}  opacity={0} />

      {/* ── Bottom Text Sentence ── */}
      <Layout
        ref={textContainer}
        layout={true}
        direction={'row'}
        alignItems={'center'}
        justifyContent={'center'}
        gap={28}
        position={[0, 150]}
      >
        <Txt
          ref={w1}
          text={'Flowing'}
          fontFamily={FONT}
          fontSize={68}
          fontWeight={600}
          fill={'#111111'}
          opacity={0}
          scale={0.5}
        />
        <Txt
          ref={w2}
          text={'from'}
          fontFamily={FONT}
          fontSize={68}
          fontWeight={600}
          fill={'#6B7280'}
          opacity={0}
          scale={0.5}
        />
        <Txt
          ref={w3}
          text={'sound'}
          fontFamily={FONT}
          fontSize={68}
          fontWeight={700}
          fill={'#6366F1'}
          opacity={0}
          scale={0.5}
        />
        <Txt
          ref={w4}
          text={'to'}
          fontFamily={FONT}
          fontSize={68}
          fontWeight={600}
          fill={'#6B7280'}
          opacity={0}
          scale={0.5}
        />
        <Txt
          ref={w5}
          text={'word.'}
          fontFamily={FONT}
          fontSize={68}
          fontWeight={700}
          fill={'#8B5CF6'}
          opacity={0}
          scale={0.5}
        />
      </Layout>
    </Rect>
  );

  // Helper generator to drop a particle and spawn a word
  function* dropAndSpawn(
    particle: Circle,
    word: Txt,
    targetX: number
  ) {
    yield* chain(
      // 1. Reveal particle at wave
      all(
        particle.opacity(1, 0.15),
        particle.position([targetX, -250], 0)
      ),
      // 2. Drop particle rapidly down to baseline
      particle.position([targetX, 100], 0.35, easeInCubic),
      // 3. Dissolve particle as it hits, spawning the word
      all(
        particle.scale(2.5, 0.2, easeOutExpo),
        particle.opacity(0, 0.2, easeOutExpo),
        word.opacity(1, 0.35, easeOutExpo),
        word.scale(1, 0.35, easeOutBack)
      )
    );
  }

  // ── ANIMATION TIMELINE ────────────────────────────────────────────────────

  // Run the time accumulator to animate the wave height oscillation in parallel
  yield* all(
    time(4, 4.0, linear),
    chain(
      // Initial pan/drift
      cameraGroup().position([0, -20], 0.6, easeInOutCubic),
      // Drop words one-by-one with staggered timing
      all(
        // Drop particles and reveal text
        chain(
          dropAndSpawn(p1(), w1(), -440),
          dropAndSpawn(p2(), w2(), -200),
          dropAndSpawn(p3(), w3(), 20),
          dropAndSpawn(p4(), w4(), 240),
          dropAndSpawn(p5(), w5(), 440)
        ),
        // Camera pulls back gently to capture the full sentence
        cameraGroup().scale(1.0, 2.5, easeInOutCubic),
        cameraGroup().position([0, 0], 2.5, easeInOutCubic)
      ),
      // Dampen the voice waveform to a flat line
      all(
        waveDampening(0, 0.6, easeInOutCubic),
        // Subtle drift down of typography
        textContainer().position([0, 120], 0.6, easeInOutCubic)
      ),
      // Set up exit for the next scene
      all(
        textContainer().opacity(0, 0.45, easeInOutCubic),
        waveContainer().opacity(0, 0.45, easeInOutCubic),
        textContainer().scale(0.85, 0.45, easeInOutCubic)
      )
    )
  );
});
