import { createFile } from 'mp4box';

export interface DecodedVideoTrack {
  id: number;
  codec: string;
  width: number;
  height: number;
  timescale: number;
  duration: number;
}

export interface DecoderSample {
  data: Uint8Array;
  timestamp: number;
  duration: number;
  type: EncodedVideoChunkType;
}

export type DecoderFrameCallback = (frame: VideoFrame) => void;

interface Mp4VideoTrack {
  id: number;
  codec: string;
  video?: {
    width?: number;
    height?: number;
  };
  track_width?: number;
  track_height?: number;
  timescale: number;
  duration: number;
}

interface Mp4Sample {
  data: Uint8Array;
  cts: number;
  dts: number;
  duration: number;
  is_sync: boolean;
}

export class WebCodecsMp4Decoder {
  private track: DecodedVideoTrack | null = null;
  private decoder: VideoDecoder | null = null;

  static isSupported() {
    return typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';
  }

  async inspect(fileBuffer: ArrayBuffer): Promise<DecodedVideoTrack> {
    const mp4 = createFile() as any;
    const info = await new Promise<any>((resolve, reject) => {
      mp4.onReady = resolve;
      mp4.onError = reject;

      const buffer = fileBuffer as ArrayBuffer & { fileStart: number };
      buffer.fileStart = 0;
      mp4.appendBuffer(buffer);
      mp4.flush();
    });

    const videoTrack = (info.videoTracks as Mp4VideoTrack[] | undefined)?.[0];
    if (!videoTrack) {
      throw new Error('No video track found in MP4 source');
    }

    this.track = {
      id: videoTrack.id,
      codec: videoTrack.codec,
      width: videoTrack.video?.width ?? videoTrack.track_width ?? 0,
      height: videoTrack.video?.height ?? videoTrack.track_height ?? 0,
      timescale: videoTrack.timescale,
      duration: videoTrack.duration / videoTrack.timescale,
    };

    return this.track;
  }

  async decodeSamples(
    samples: DecoderSample[],
    track: DecodedVideoTrack,
    onFrame: DecoderFrameCallback,
    description?: BufferSource,
  ) {
    if (!WebCodecsMp4Decoder.isSupported()) {
      throw new Error('WebCodecs VideoDecoder is not available');
    }

    this.decoder?.close();
    this.decoder = new VideoDecoder({
      output: onFrame,
      error: (error) => {
        throw error;
      },
    });

    const support = await VideoDecoder.isConfigSupported({
      codec: track.codec,
      codedWidth: track.width,
      codedHeight: track.height,
      description,
    }).catch(() => ({ supported: false }));

    if (!support.supported) {
      throw new Error(`Unsupported WebCodecs decoder codec: ${track.codec}`);
    }

    this.decoder.configure({
      codec: track.codec,
      codedWidth: track.width,
      codedHeight: track.height,
      description,
    });

    for (const sample of samples) {
      this.decoder.decode(new EncodedVideoChunk({
        type: sample.type,
        timestamp: sample.timestamp,
        duration: sample.duration,
        data: sample.data,
      }));
    }

    await this.decoder.flush();
  }

  sampleFromMp4(sample: Mp4Sample): DecoderSample {
    const track = this.track;
    if (!track) {
      throw new Error('Call inspect() before converting MP4 samples');
    }

    return {
      data: sample.data,
      timestamp: Math.round((sample.cts / track.timescale) * 1_000_000),
      duration: Math.round((sample.duration / track.timescale) * 1_000_000),
      type: sample.is_sync ? 'key' : 'delta',
    };
  }

  close() {
    this.decoder?.close();
    this.decoder = null;
  }
}
