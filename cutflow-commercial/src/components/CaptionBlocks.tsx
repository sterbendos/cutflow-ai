import {Node, NodeProps, Txt, Layout} from '@motion-canvas/2d';
import {createRef, SimpleSignal, createSignal} from '@motion-canvas/core';

export interface CaptionBlocksProps extends NodeProps {
  words: string[];
  fontSize?: number;
  activeColor?: string;
  inactiveColor?: string;
  width?: number;
}

export class CaptionBlocks extends Node {
  private readonly containerRef = createRef<Layout>();
  public readonly activeWordIndex: SimpleSignal<number, this>;
  private readonly wordCount: number;

  public constructor(props: CaptionBlocksProps) {
    super(props);
    const words = props.words;
    this.wordCount = words.length;
    this.activeWordIndex = createSignal(-1);

    const fontSize = props.fontSize ?? 54;
    const activeColor = props.activeColor ?? "#8B5CF6";
    const inactiveColor = props.inactiveColor ?? "#94A3B8";
    const containerWidth = props.width ?? 1400;

    this.add(
      <Layout
        ref={this.containerRef}
        layout={true}
        wrap={"wrap"}
        justifyContent={"center"}
        gap={16}
        width={containerWidth}
      >
        {words.map((word, index) => {
          return (
            <Txt
              text={word}
              fontFamily={"Outfit, sans-serif"}
              fontSize={fontSize}
              fontWeight={700}
              letterSpacing={1}
              fill={() => {
                const activeIdx = this.activeWordIndex();
                return activeIdx === index ? activeColor : inactiveColor;
              }}
              scale={() => {
                const activeIdx = this.activeWordIndex();
                return activeIdx === index ? 1.15 : 1.0;
              }}
            />
          );
        })}
      </Layout>
    );
  }

  /**
   * Highlights words one by one in sequence.
   */
  public *highlightSequence(durationPerWord: number) {
    for (let i = 0; i < this.wordCount; i++) {
      this.activeWordIndex(i);
      yield* this.activeWordIndex(i, durationPerWord);
    }
    this.activeWordIndex(-1);
  }
}
