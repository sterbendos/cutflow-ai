import {Node, NodeProps, Rect, Layout} from '@motion-canvas/2d';
import {createRef, all, easeInOutCubic, range} from '@motion-canvas/core';

export interface WaveformProps extends NodeProps {
  width: number;
  height: number;
  color?: string;
  seed?: number;
  barCount?: number;
}

export class Waveform extends Node {
  private readonly layoutRef = createRef<Layout>();

  public constructor(props: WaveformProps) {
    super(props);
    const barCount = props.barCount ?? 24;
    const height = props.height;
    const width = props.width;
    const color = props.color ?? "#6366F1";
    const seed = props.seed ?? 42;

    const heights = this.getHeights(barCount, seed);
    const barGap = 4;
    const barWidth = (width - (barCount - 1) * barGap) / barCount;

    this.add(
      <Layout
        ref={this.layoutRef}
        direction={"row"}
        alignItems={"center"}
        justifyContent={"center"}
        gap={barGap}
        height={height}
        width={width}
      >
        {range(barCount).map(i => {
          const barHeight = heights[i] * height;
          return (
            <Rect
              width={barWidth}
              height={barHeight}
              radius={barWidth / 2}
              fill={color}
            />
          );
        })}
      </Layout>
    );
  }

  private getHeights(count: number, seed: number): number[] {
    const heights: number[] = [];
    let x = seed;
    for (let i = 0; i < count; i++) {
      x = (x * 1664525 + 1013904223) % 4294967296;
      const rand = x / 4294967296;
      const progress = i / count;
      const envelope = Math.sin(progress * Math.PI);
      const heightVal = 0.15 + 0.85 * envelope * (0.3 + 0.7 * rand);
      heights.push(heightVal);
    }
    return heights;
  }

  /**
   * Animates the amplitude (height) scale of all waveform bars.
   */
  public *scaleWave(targetScale: number, duration: number, ease = easeInOutCubic) {
    const children = this.layoutRef().children() as Rect[];
    const anims = children.map(child => child.scale.y(targetScale, duration, ease));
    yield* all(...anims);
  }
}
