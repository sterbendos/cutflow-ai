/**
 * SCENE 5 — 16s to 20s
 * Reimagined as "The Creator Assembled" (Arc/Linear style).
 * A central minimalist avatar silhouette.
 * Semi-transparent badges and pills representing editing disciplines, skills,
 * and sparks fly in from offscreen.
 * They magnetically snap into a structured, orbiting halo around the avatar.
 * The central node blooms with a rich indigo-to-pink gradient.
 */
import {makeScene2D, Rect, Txt, Layout, Circle, Path, Gradient} from '@motion-canvas/2d';
import {
  createRef, all, chain, waitFor, easeInOutCubic, easeOutExpo,
  easeOutBack, createSignal, Vector2, linear
} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.fill('#FFFFFF');

  const cameraGroup = createRef<Rect>();
  const avatarNode = createRef<Circle>();
  const avatarGlow = createRef<Circle>();

  // Orbit parameters
  const orbitRadius = createSignal(700); // starts far away
  const orbitRot = createSignal(0);
  const badgeScale = createSignal(0);

  const FONT = 'Outfit, sans-serif';

  // Define 6 badges with symbolic values and angular positions
  const badgeData = [
    {angle: 0,   type: 'pill',   text: 'EDITOR'},
    {angle: 60,  type: 'circle', icon: 'lens'},
    {angle: 120, type: 'pill',   text: 'DESIGN'},
    {angle: 180, type: 'circle', icon: 'spark'},
    {angle: 240, type: 'pill',   text: 'MOTION'},
    {angle: 300, type: 'circle', icon: 'flow'}
  ];

  const badges = badgeData.map((b) => {
    const ref = createRef<Rect>();
    return {ref, ...b};
  });

  view.add(
    <Rect
      ref={cameraGroup}
      width={3840}
      height={2160}
      clip={true}
      fill={'#FFFFFF'}
      scale={1.1}
    >
      {/* Pulse glow behind avatar */}
      <Circle
        ref={avatarGlow}
        size={340}
        fill={new Gradient({
          type: 'radial',
          from: [0, 0],
          to: [170, 170],
          stops: [
            {offset: 0, color: 'rgba(99, 102, 241, 0.25)'},
            {offset: 1, color: 'rgba(139, 92, 246, 0)'}
          ]
        })}
        opacity={0}
      />

      {/* ── Central Avatar Circle ── */}
      <Circle
        ref={avatarNode}
        size={240}
        fill={'#FAFAFA'}
        stroke={'#E5E7EB'}
        lineWidth={2.5}
        shadowColor={'rgba(0,0,0,0.06)'}
        shadowBlur={40}
        scale={0}
      >
        {/* Minimalist Profile/Silhouette Symbol */}
        <Path
          data={'M 0 -45 A 25 25 0 1 0 0 5 A 25 25 0 1 0 0 -45 Z M -60 50 A 60 40 0 0 1 60 50 Z'}
          fill={new Gradient({
            type: 'linear',
            from: [0, -60],
            to: [0, 60],
            stops: [
              {offset: 0, color: '#6366F1'},
              {offset: 1, color: '#8B5CF6'}
            ]
          })}
          scale={1.25}
        />
      </Circle>

      {/* ── Orbiting Halo Badges ── */}
      {badges.map((b) => {
        // Position computed dynamically along the orbit circle
        const posFunc = () => {
          const baseAngleRad = (b.angle * Math.PI) / 180;
          const currentAngleRad = baseAngleRad + (orbitRot() * Math.PI) / 180;
          const r = orbitRadius();
          return new Vector2(
            Math.cos(currentAngleRad) * r,
            Math.sin(currentAngleRad) * r
          );
        };

        if (b.type === 'pill') {
          return (
            <Rect
              ref={b.ref}
              height={64}
              padding={[0, 32]}
              radius={32}
              fill={'#FAFAFA'}
              stroke={'#E5E7EB'}
              lineWidth={1.5}
              shadowColor={'rgba(0,0,0,0.03)'}
              shadowBlur={15}
              position={posFunc}
              scale={() => badgeScale()}
              layout={true}
              alignItems={'center'}
              justifyContent={'center'}
            >
              <Txt
                text={b.text || ''}
                fontFamily={FONT}
                fontSize={20}
                fontWeight={700}
                fill={'#374151'}
                letterSpacing={1.5}
              />
            </Rect>
          );
        } else {
          // Circle with symbolic graphical icon
          return (
            <Rect
              ref={b.ref}
              width={64}
              height={64}
              radius={32}
              fill={'#FAFAFA'}
              stroke={'#E5E7EB'}
              lineWidth={1.5}
              shadowColor={'rgba(0,0,0,0.03)'}
              shadowBlur={15}
              position={posFunc}
              scale={() => badgeScale()}
              alignItems={'center'}
              justifyContent={'center'}
            >
              {b.icon === 'lens' && (
                <Circle size={24} stroke={'#6366F1'} lineWidth={3}>
                  <Circle size={8} fill={'#6366F1'} />
                </Circle>
              )}
              {b.icon === 'spark' && (
                <Path
                  data={'M 0 -12 L 3 -3 L 12 0 L 3 3 L 0 12 L -3 3 L -12 0 L -3 -3 Z'}
                  fill={'#8B5CF6'}
                  scale={1.1}
                />
              )}
              {b.icon === 'flow' && (
                <Path
                  data={'M -10 -10 C 10 -10 -10 10 10 10'}
                  stroke={'#6366F1'}
                  lineWidth={3}
                  lineCap={'round'}
                  scale={1.2}
                />
              )}
            </Rect>
          );
        }
      })}
    </Rect>
  );

  // ── ANIMATION TIMELINE ────────────────────────────────────────────────────

  // Run orbit rotation continuously (4s total duration)
  yield* all(
    orbitRot(120, 4.0, linear),
    chain(
      // 1. Central avatar scales up, camera drifts
      all(
        avatarNode().scale(1.0, 0.75, easeOutBack),
        cameraGroup().position([0, -20], 0.75, easeInOutCubic)
      ),
      // 2. Halo badges fly in from offscreen and orbit
      all(
        orbitRadius(260, 1.6, easeInOutCubic),
        badgeScale(1.0, 1.4, easeOutBack),
        avatarGlow().opacity(1, 1.4, easeInOutCubic),
        cameraGroup().scale(0.95, 1.6, easeInOutCubic),
        cameraGroup().position([0, 10], 1.6, easeInOutCubic)
      ),
      // 3. Float and rotate
      all(
        cameraGroup().position([0, 0], 1.0, easeInOutCubic),
        cameraGroup().scale(0.9, 1.0, easeInOutCubic)
      ),
      // 4. Fade out all elements for next scene
      all(
        avatarNode().scale(0, 0.65, easeInOutCubic),
        avatarGlow().opacity(0, 0.65, easeInOutCubic),
        badgeScale(0, 0.65, easeInOutCubic),
        orbitRadius(100, 0.65, easeInOutCubic),
        cameraGroup().scale(1.2, 0.65, easeInOutCubic)
      )
    )
  );
});
