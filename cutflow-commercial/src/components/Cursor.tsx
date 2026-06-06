import {Node, NodeProps, Path, Circle} from '@motion-canvas/2d';
import {createRef, all, easeOutBack, easeOutExpo, easeInOutCubic, SimpleSignal, createSignal, Vector2, TimingFunction} from '@motion-canvas/core';

export interface CursorProps extends NodeProps {
  initialPosition?: Vector2;
}

export class Cursor extends Node {
  private readonly pointerRef = createRef<Path>();
  private readonly clickRingRef = createRef<Circle>();
  public readonly scaleSignal = createSignal(1);

  public constructor(props: CursorProps) {
    super(props);
    this.position(props.initialPosition ?? Vector2.zero);

    this.add(
      <>
        {/* Click Ring Ripple Effect */}
        <Circle
          ref={this.clickRingRef}
          size={0}
          stroke={"#8B5CF6"}
          lineWidth={4}
          opacity={0}
        />
        {/* Sleek Vector Cursor */}
        <Path
          ref={this.pointerRef}
          data="M 0 0 L 22 22 L 12.5 24 L 7 35.5 Z"
          fill={"#111111"}
          stroke={"#FFFFFF"}
          lineWidth={2.5}
          shadowColor={"rgba(0, 0, 0, 0.15)"}
          shadowBlur={15}
          shadowOffset={[2, 6]}
          scale={() => this.scaleSignal()}
          offset={[-1, -1]}
        />
      </>
    );
  }

  /**
   * Triggers a clicking animation: shrinks the pointer slightly and emits a ripple wave.
   */
  public *click(duration = 0.35) {
    this.clickRingRef().size(0);
    this.clickRingRef().opacity(0.8);
    this.clickRingRef().lineWidth(4);

    yield* all(
      this.scaleSignal(0.8, duration * 0.3).to(1.1, duration * 0.4).to(1.0, duration * 0.3),
      this.clickRingRef().size(100, duration, easeOutExpo),
      this.clickRingRef().opacity(0, duration, easeOutExpo),
      this.clickRingRef().lineWidth(0, duration, easeOutExpo)
    );
  }

  /**
   * Moves the cursor to a target position with smooth spring-like easing.
   */
  public *cursorMoveTo(target: Vector2 | {x: number; y: number}, duration: number, ease: TimingFunction = easeInOutCubic) {
    const targetVec = target instanceof Vector2 ? target : new Vector2(target.x, target.y);
    yield* this.position(targetVec, duration, ease);
  }
}
