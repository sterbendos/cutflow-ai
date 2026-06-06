import {Node, NodeProps, Txt, Rect, Layout} from '@motion-canvas/2d';
import {createRef, SimpleSignal, createSignal, all, easeInOutCubic} from '@motion-canvas/core';

export interface TypewriterProps extends NodeProps {
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fill?: string;
}

export class Typewriter extends Node {
  private readonly textRef = createRef<Txt>();
  private readonly caretRef = createRef<Rect>();
  public readonly visibleCount: SimpleSignal<number, this>;
  private readonly fullText: string;

  public constructor(props: TypewriterProps) {
    super(props);
    this.fullText = props.text;
    this.visibleCount = createSignal(0);

    const fontSize = props.fontSize ?? 48;
    const fontFamily = props.fontFamily ?? "Outfit, sans-serif";
    const fill = props.fill ?? "#111111";

    this.add(
      <Layout layout={true} direction={"row"} alignItems={"center"} gap={6}>
        <Txt
          ref={this.textRef}
          text={() => this.fullText.substring(0, Math.floor(this.visibleCount()))}
          fontFamily={fontFamily}
          fontSize={fontSize}
          fill={fill}
          letterSpacing={2}
          fontWeight={600}
        />
        <Rect
          ref={this.caretRef}
          width={4}
          height={fontSize * 0.9}
          fill={fill}
          opacity={1}
        />
      </Layout>
    );
  }

  /**
   * Types the text character-by-character over a specified duration.
   */
  public *type(duration: number) {
    yield* this.visibleCount(this.fullText.length, duration);
  }

  /**
   * Runs a caret blinking animation loop.
   */
  public *blinkCaret(duration: number) {
    const blinkDuration = 0.5; // half second per blink cycle
    const cycles = Math.floor(duration / blinkDuration);
    for (let i = 0; i < cycles; i++) {
      yield* this.caretRef().opacity(0, blinkDuration * 0.5).to(1, blinkDuration * 0.5);
    }
  }

  /**
   * Returns the width of the text node for positioning other elements relative to it.
   */
  public getTextWidth(): number {
    return this.textRef().size.x();
  }
}
