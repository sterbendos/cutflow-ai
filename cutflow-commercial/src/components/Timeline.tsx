import {Node, NodeProps, Rect, Layout, Txt, Line} from '@motion-canvas/2d';
import {createRef, all, easeInOutCubic, SimpleSignal, createSignal, Vector2} from '@motion-canvas/core';
import {Waveform} from './Waveform';

export interface TimelineProps extends NodeProps {
  width: number;
}

export class Timeline extends Node {
  public readonly gap1Width: SimpleSignal<number, this>;
  public readonly gap2Width: SimpleSignal<number, this>;

  public readonly clip1Ref = createRef<Rect>();
  public readonly clip2Ref = createRef<Rect>();
  public readonly clip3Ref = createRef<Rect>();

  public readonly gap1Ref = createRef<Rect>();
  public readonly gap2Ref = createRef<Rect>();

  public readonly playheadRef = createRef<Line>();
  public readonly playheadPos: SimpleSignal<number, this>;

  public readonly subtitleTrackRef = createRef<Rect>();
  public readonly subClip1Ref = createRef<Rect>();
  public readonly subClip2Ref = createRef<Rect>();
  public readonly subClip3Ref = createRef<Rect>();

  public constructor(props: TimelineProps) {
    super(props);
    const width = props.width;

    this.gap1Width = createSignal(180);
    this.gap2Width = createSignal(120);
    this.playheadPos = createSignal(-1100);

    this.add(
      <Node>
        {/* Main flex layout container for tracks */}
        <Layout layout={true} direction={"column"} gap={24} width={width} x={0} y={0}>
          {/* Track 1: Subtitles */}
          <Layout layout={true} direction={"row"} alignItems={"center"} gap={16}>
            {/* Label Panel */}
            <Rect
              width={180}
              height={80}
              fill={"#F9FAFB"}
              radius={8}
              stroke={"#E5E7EB"}
              lineWidth={1.5}
              justifyContent={"center"}
              alignItems={"center"}
            >
              <Txt text={"Subtitles"} fontFamily={"Outfit, sans-serif"} fontSize={18} fill={"#666666"} fontWeight={600} />
            </Rect>
            {/* Track Lane */}
            <Rect
              ref={this.subtitleTrackRef}
              grow={1}
              height={80}
              fill={"#F9FAFB"}
              radius={8}
              stroke={"#E5E7EB"}
              lineWidth={1.5}
              clip={true}
              layout={true}
              direction={"row"}
              alignItems={"center"}
              padding={[0, 40]}
              gap={80}
            >
              {/* Animated subtitle blocks for Scene 3 */}
              <Rect
                ref={this.subClip1Ref}
                width={320}
                height={48}
                fill={"#EEF2F6"}
                radius={6}
                stroke={"#CBD5E1"}
                lineWidth={1.5}
                scale={0}
                justifyContent={"center"}
                alignItems={"center"}
              >
                <Txt text={"This is a raw podcast..."} fontFamily={"Outfit, sans-serif"} fontSize={16} fill={"#475569"} fontWeight={500} />
              </Rect>
              <Rect
                ref={this.subClip2Ref}
                width={420}
                height={48}
                fill={"#EEF2F6"}
                radius={6}
                stroke={"#CBD5E1"}
                lineWidth={1.5}
                scale={0}
                justifyContent={"center"}
                alignItems={"center"}
              >
                <Txt text={"with some silences in between..."} fontFamily={"Outfit, sans-serif"} fontSize={16} fill={"#475569"} fontWeight={500} />
              </Rect>
              <Rect
                ref={this.subClip3Ref}
                width={340}
                height={48}
                fill={"#EEF2F6"}
                radius={6}
                stroke={"#CBD5E1"}
                lineWidth={1.5}
                scale={0}
                justifyContent={"center"}
                alignItems={"center"}
              >
                <Txt text={"that we want to auto-cut."} fontFamily={"Outfit, sans-serif"} fontSize={16} fill={"#475569"} fontWeight={500} />
              </Rect>
            </Rect>
          </Layout>

          {/* Track 2: Video Track */}
          <Layout layout={true} direction={"row"} alignItems={"center"} gap={16}>
            {/* Label Panel */}
            <Rect
              width={180}
              height={180}
              fill={"#F9FAFB"}
              radius={8}
              stroke={"#E5E7EB"}
              lineWidth={1.5}
              justifyContent={"center"}
              alignItems={"center"}
            >
              <Txt text={"Video 1"} fontFamily={"Outfit, sans-serif"} fontSize={18} fill={"#666666"} fontWeight={600} />
            </Rect>
            {/* Track Lane with clips inside */}
            <Rect
              grow={1}
              height={180}
              fill={"#F9FAFB"}
              radius={8}
              stroke={"#E5E7EB"}
              lineWidth={1.5}
              clip={true}
              layout={true}
              direction={"row"}
              alignItems={"center"}
              padding={12}
            >
              {/* Clip 1 */}
              <Rect
                ref={this.clip1Ref}
                width={560}
                height={156}
                fill={"#F5F3FF"}
                radius={8}
                stroke={"#C084FC"}
                lineWidth={1.5}
                alignItems={"center"}
                justifyContent={"center"}
              >
                <Waveform width={500} height={100} color={"#8B5CF6"} seed={11} barCount={30} />
              </Rect>

              {/* Gap 1 (AI Silence Segment) */}
              <Rect
                ref={this.gap1Ref}
                width={() => this.gap1Width()}
                height={156}
                fill={"#FEF2F2"}
                radius={8}
                stroke={"#FCA5A5"}
                lineWidth={1.5}
                lineDash={[6, 4]}
                justifyContent={"center"}
                alignItems={"center"}
                clip={true}
              >
                <Txt text={"Silence"} fontFamily={"Outfit, sans-serif"} fontSize={15} fill={"#EF4444"} fontWeight={600} opacity={() => this.gap1Width() > 50 ? 1 : 0} />
              </Rect>

              {/* Clip 2 */}
              <Rect
                ref={this.clip2Ref}
                width={760}
                height={156}
                fill={"#F5F3FF"}
                radius={8}
                stroke={"#C084FC"}
                lineWidth={1.5}
                alignItems={"center"}
                justifyContent={"center"}
              >
                <Waveform width={700} height={100} color={"#8B5CF6"} seed={22} barCount={40} />
              </Rect>

              {/* Gap 2 (AI Silence Segment) */}
              <Rect
                ref={this.gap2Ref}
                width={() => this.gap2Width()}
                height={156}
                fill={"#FEF2F2"}
                radius={8}
                stroke={"#FCA5A5"}
                lineWidth={1.5}
                lineDash={[6, 4]}
                justifyContent={"center"}
                alignItems={"center"}
                clip={true}
              >
                <Txt text={"Silence"} fontFamily={"Outfit, sans-serif"} fontSize={15} fill={"#EF4444"} fontWeight={600} opacity={() => this.gap2Width() > 50 ? 1 : 0} />
              </Rect>

              {/* Clip 3 */}
              <Rect
                ref={this.clip3Ref}
                width={680}
                height={156}
                fill={"#F5F3FF"}
                radius={8}
                stroke={"#C084FC"}
                lineWidth={1.5}
                alignItems={"center"}
                justifyContent={"center"}
              >
                <Waveform width={620} height={100} color={"#8B5CF6"} seed={33} barCount={35} />
              </Rect>
            </Rect>
          </Layout>

          {/* Track 3: Audio Track */}
          <Layout layout={true} direction={"row"} alignItems={"center"} gap={16}>
            {/* Label Panel */}
            <Rect
              width={180}
              height={80}
              fill={"#F9FAFB"}
              radius={8}
              stroke={"#E5E7EB"}
              lineWidth={1.5}
              justifyContent={"center"}
              alignItems={"center"}
            >
              <Txt text={"Audio 1"} fontFamily={"Outfit, sans-serif"} fontSize={18} fill={"#666666"} fontWeight={600} />
            </Rect>
            {/* Track Lane */}
            <Rect
              grow={1}
              height={80}
              fill={"#F9FAFB"}
              radius={8}
              stroke={"#E5E7EB"}
              lineWidth={1.5}
              clip={true}
              layout={true}
              direction={"row"}
              alignItems={"center"}
              padding={12}
            >
              <Rect grow={1} height={48} fill={"#ECFDF5"} radius={6} stroke={"#A7F3D0"} lineWidth={1.5} justifyContent={"center"} alignItems={"center"}>
                <Waveform width={width - 240} height={30} color={"#10B981"} seed={99} barCount={80} />
              </Rect>
            </Rect>
          </Layout>
        </Layout>

        {/* Absolute Playhead Overlay (Positions relative to center (0,0) of this component) */}
        <Line
          ref={this.playheadRef}
          points={[
            () => [this.playheadPos(), -210],
            () => [this.playheadPos(), 210],
          ]}
          stroke={"#EF4444"}
          lineWidth={3.5}
          lineCap={"round"}
          shadowColor={"rgba(0, 0, 0, 0.1)"}
          shadowBlur={10}
        />
        {/* Playhead handle marker */}
        <Rect
          width={20}
          height={20}
          fill={"#EF4444"}
          radius={4}
          position={() => [this.playheadPos(), -210]}
          rotation={45}
        />
      </Node>
    );
  }

  /**
   * Animates the collapse of silence gaps to zero width.
   */
  public *removeSilences(duration: number) {
    yield* all(
      this.gap1Width(0, duration, easeInOutCubic),
      this.gap2Width(0, duration, easeInOutCubic)
    );
  }
}
