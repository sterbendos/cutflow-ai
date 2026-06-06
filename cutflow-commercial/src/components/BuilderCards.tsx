import {Node, NodeProps, Rect, Txt, Layout, Circle} from '@motion-canvas/2d';
import {createRef, all, easeOutBack, easeInOutCubic, easeOutExpo, chain, waitFor} from '@motion-canvas/core';

export interface BuilderCardProps extends NodeProps {
  label: string;
  sublabel?: string;
  accentColor?: string;
  delay?: number;
}

export class BuilderCard extends Node {
  private readonly cardRef = createRef<Rect>();
  private readonly contentRef = createRef<Layout>();

  public constructor(props: BuilderCardProps) {
    super(props);
    const label = props.label;
    const sublabel = props.sublabel ?? '';
    const accentColor = props.accentColor ?? '#8B5CF6';

    this.add(
      <Rect
        ref={this.cardRef}
        width={360}
        height={sublabel ? 110 : 72}
        fill={'#FFFFFF'}
        radius={16}
        stroke={accentColor}
        lineWidth={1.5}
        shadowColor={'rgba(139, 92, 246, 0.12)'}
        shadowBlur={32}
        shadowOffset={[0, 8]}
        scale={0}
        opacity={0}
        layout={true}
        direction={'row'}
        alignItems={'center'}
        padding={[0, 24]}
        gap={16}
      >
        {/* Accent dot */}
        <Circle
          width={10}
          height={10}
          fill={accentColor}
        />
        <Layout
          ref={this.contentRef}
          layout={true}
          direction={'column'}
          gap={4}
          grow={1}
        >
          <Txt
            text={label}
            fontFamily={'Outfit, sans-serif'}
            fontSize={22}
            fontWeight={700}
            fill={'#111111'}
            letterSpacing={0.5}
          />
          {sublabel ? (
            <Txt
              text={sublabel}
              fontFamily={'Outfit, sans-serif'}
              fontSize={16}
              fontWeight={400}
              fill={'#6B7280'}
            />
          ) : null}
        </Layout>
      </Rect>
    );
  }

  public *appear(delay = 0) {
    if (delay > 0) yield* waitFor(delay);
    yield* all(
      this.cardRef().scale(1, 0.7, easeOutBack),
      this.cardRef().opacity(1, 0.4, easeOutExpo),
    );
  }

  public *disappear(duration = 0.4) {
    yield* all(
      this.cardRef().scale(0, duration, easeInOutCubic),
      this.cardRef().opacity(0, duration, easeInOutCubic),
    );
  }

  public *floatTo(x: number, y: number, duration: number) {
    yield* this.position([x, y], duration, easeInOutCubic);
  }
}

// ── Badge Node ──────────────────────────────────────────────────────────────
export interface BadgeProps extends NodeProps {
  label: string;
  color?: string;
}

export class Badge extends Node {
  private readonly pillRef = createRef<Rect>();

  public constructor(props: BadgeProps) {
    super(props);
    const color = props.color ?? '#6366F1';

    this.add(
      <Rect
        ref={this.pillRef}
        height={48}
        padding={[0, 24]}
        fill={`${color}18`}
        radius={24}
        stroke={color}
        lineWidth={1.5}
        scale={0}
        opacity={0}
        layout={true}
        alignItems={'center'}
        justifyContent={'center'}
      >
        <Txt
          text={props.label}
          fontFamily={'Outfit, sans-serif'}
          fontSize={20}
          fontWeight={600}
          fill={color}
          letterSpacing={1}
        />
      </Rect>
    );
  }

  public *appear(delay = 0) {
    if (delay > 0) yield* waitFor(delay);
    yield* all(
      this.pillRef().scale(1, 0.6, easeOutBack),
      this.pillRef().opacity(1, 0.35, easeOutExpo),
    );
  }

  public *disappear(duration = 0.35) {
    yield* all(
      this.pillRef().scale(0, duration, easeInOutCubic),
      this.pillRef().opacity(0, duration, easeInOutCubic),
    );
  }
}
