import { convertFileSrc } from '@tauri-apps/api/core';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { TimelineState, BRollSegment } from '@/context/TimelineContext';
import type { TranscriptWord } from '@/hooks/useWhisper';
import type { CaptionStyle } from '@/context/CaptionContext';
import type { EffectFilters } from '@/components/TransformInspector';
import type { MotionGraphicsItem } from '@/context/MotionGraphicsContext';
import { Compositor, type RenderBRoll } from './Compositor';

export type BrowserExportQuality = 'high' | 'medium' | 'low';
export type BrowserExportResolution = 'source' | '2160' | '1080' | '720';

export interface BrowserExportOptions {
  quality: BrowserExportQuality;
  resolution: BrowserExportResolution;
  includeSubtitles: boolean;
  transcript: TranscriptWord[];
  captionStyle: CaptionStyle;
  effects: EffectFilters;
  bRolls: BRollSegment[];
  motionGraphics: MotionGraphicsItem[];
  fps?: number;
  onProgress?: (progress: number, message: string) => void;
}

interface LoadedBRoll {
  segment: BRollSegment;
  video: HTMLVideoElement;
}

interface VideoSize {
  width: number;
  height: number;
}

type MuxerVideoCodec = 'avc' | 'vp9';

interface SelectedVideoCodec {
  encoderCodec: string;
  muxerCodec: MuxerVideoCodec;
}

const QUALITY_BITRATES: Record<BrowserExportQuality, number> = {
  high: 12_000_000,
  medium: 6_000_000,
  low: 3_000_000,
};

const AUDIO_FRAME_SIZE = 1024;

export async function exportTimelineToMp4(
  state: TimelineState,
  options: BrowserExportOptions,
): Promise<Blob> {
  // Don't assert WebCodecs immediately — prefer fallback in Tauri or when WebCodecs aren't available.

  const keepSegments = state.edl
    .filter((segment) => segment.segment_type === 'keep' && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);

  if (!state.source_video_path) {
    throw new Error('No source video loaded');
  }

  if (keepSegments.length === 0) {
    throw new Error("No segments marked as 'keep'");
  }

  const fps = options.fps ?? 30;
  const sourceVideo = await loadVideoElement(state.source_video_path, false);
  const sourceSize = getVideoElementSize(sourceVideo);
  const outputSize = resolveOutputSize(sourceSize, state.aspectRatio, options.resolution);
  const outputDuration = keepSegments.reduce((total, segment) => total + segment.end - segment.start, 0);
  const totalFrames = Math.max(1, Math.ceil(outputDuration * fps));
  const FRAMES_PER_BATCH = 30;
  const frameDurationMicros = Math.round(1_000_000 / fps);

  const supportsWebCodecs = typeof (window as any).VideoEncoder !== 'undefined' && typeof (window as any).VideoFrame !== 'undefined';
  // NOTE: codec/muxer are created later only when WebCodecs are available

  const canvas = document.createElement('canvas');
  const compositor = new Compositor(canvas);
  compositor.setSize(outputSize.width, outputSize.height);

  const loadedBRolls = await Promise.all(
    options.bRolls
      .filter((segment) => segment.path && !segment.path.startsWith('mock://') && !segment.path.startsWith('appdata/'))
      .map(async (segment): Promise<LoadedBRoll> => ({
        segment,
        video: await loadVideoElement(segment.path, true),
      })),
  );

  function runningInTauri() {
    try {
      const w = window as any;
      return !!(w.__TAURI__ || w.__TAURI_IPC__ || w.__TAURI_METADATA__);
    } catch {
      return false;
    }
  }

  // encoder variables and factory will be defined after muxer is created

  // If we're running inside Tauri, or WebCodecs aren't available, prefer the MediaRecorder fallback first
  if (runningInTauri()) {
    throw new Error('Use exportTimelineToTauriMp4 for native exports when running inside Tauri.');
  }

  if (!supportsWebCodecs) {
    try {
      options.onProgress?.(0, 'WebCodecs unavailable — using MediaRecorder fallback');
      const webm = await recordCanvasStreamFallback({
        canvas,
        compositor,
        keepSegments,
        loadedBRolls,
        sourceVideo,
        fps,
        frameDurationMicros,
        totalFrames,
        options,
      });
      return webm;
    } catch (tauriFallbackErr) {
      console.warn('[Exporter] MediaRecorder fallback failed, cannot proceed with WebCodecs path:', tauriFallbackErr);
      throw new Error('WebCodecs not available and MediaRecorder fallback failed');
    }
  }

  // Now that we've tried (or skipped) the fallback, ensure WebCodecs are present before proceeding with encoder path
  if (!supportsWebCodecs) {
    throw new Error('WebCodecs are not available and the MediaRecorder fallback failed');
  }

  // Prepare codec, audio and muxer (WebCodecs path)
  const codec = await selectVideoCodec(outputSize, QUALITY_BITRATES[options.quality], fps);
  const preparedAudio = await prepareAudioTrack(state.source_video_path, keepSegments, options.onProgress);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: codec.muxerCodec,
      width: outputSize.width,
      height: outputSize.height,
      frameRate: fps,
    },
    audio: preparedAudio
      ? {
          codec: 'aac',
          numberOfChannels: preparedAudio.numberOfChannels,
          sampleRate: preparedAudio.sampleRate,
        }
      : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

    let encoderError: Error | null = null;
    let encoderClosed = false;
    let videoEncoder: VideoEncoder | null = null;

  const encoderOutput = (chunk: any, meta: any) => {
    try {
      muxer.addVideoChunk(chunk, meta);
    } catch (err) {
      encoderError = err instanceof Error ? err : new Error(String(err));
      encoderClosed = true;
    }
  };

  const encoderErrorHandler = (err: any) => {
    encoderError = err instanceof Error ? err : new Error(String(err));
    encoderClosed = true;
  };

  // Try to construct the encoder; if constructor fails, fall back immediately
  try {
    // @ts-ignore - some environments have slightly different ctor shapes
    videoEncoder = new (VideoEncoder as any)({ output: encoderOutput, error: encoderErrorHandler });
  } catch (ctorErr) {
    console.warn('[Exporter] VideoEncoder constructor failed:', ctorErr);
    try {
      options.onProgress?.(0, 'Encoder unavailable — falling back to MediaRecorder');
      const webm = await recordCanvasStreamFallback({
        canvas,
        compositor,
        keepSegments,
        loadedBRolls,
        sourceVideo,
        fps,
        frameDurationMicros,
        totalFrames,
        options,
      });
      return webm;
    } catch (fallbackErr) {
      console.error('[Exporter] MediaRecorder fallback failed:', fallbackErr);
      throw new Error(`Encoder creation error. Also failed recording fallback: ${String(fallbackErr)}`);
    }
  }

  // Attempt multiple configure strategies. Some webviews reject the hardwareAcceleration hint.
  const configureAttempts: any[] = [
    { hardwareAcceleration: 'prefer-hardware' },
    { hardwareAcceleration: 'prefer-software' },
    {}, // final attempt without hardwareAcceleration
  ];

  let configured = false;
  let lastConfigError: any = null;
  for (const cfgExtra of configureAttempts) {
    try {
      const cfg: any = {
        codec: codec.encoderCodec,
        width: outputSize.width,
        height: outputSize.height,
        bitrate: QUALITY_BITRATES[options.quality],
        framerate: fps,
        latencyMode: 'quality',
        ...cfgExtra,
      };
      // @ts-ignore
      videoEncoder.configure(cfg);
      configured = true;
      break;
    } catch (configErr) {
      lastConfigError = configErr;
      console.warn('[Exporter] VideoEncoder.configure attempt failed:', cfgExtra, configErr);
    }
  }

  if (!configured) {
    try { videoEncoder.close(); } catch {}
    encoderClosed = true;
    console.error('[Exporter] All VideoEncoder.configure attempts failed:', lastConfigError);
    try {
      options.onProgress?.(0, 'Encoder unavailable — falling back to MediaRecorder');
      const webm = await recordCanvasStreamFallback({
        canvas,
        compositor,
        keepSegments,
        loadedBRolls,
        sourceVideo,
        fps,
        frameDurationMicros,
        totalFrames,
        options,
      });
      return webm;
    } catch (fallbackErr) {
      console.error('[Exporter] MediaRecorder fallback failed:', fallbackErr);
      throw new Error(`Encoder configure failed: ${String(lastConfigError)}. MediaRecorder fallback also failed: ${String(fallbackErr)}`);
    }
  }

  options.onProgress?.(0, 'Encoding video frames...');

  let outputFrameIndex = 0;
  const frameDurationSeconds = 1 / fps;
  // frameDurationMicros already computed above

  try {
    for (const segment of keepSegments) {
      const segmentFrames = Math.max(1, Math.ceil((segment.end - segment.start) * fps));

      for (let frameInSegment = 0; frameInSegment < segmentFrames; frameInSegment += 1) {
        const sourceTimestamp = Math.min(segment.start + frameInSegment * frameDurationSeconds, segment.end - 0.000_001);
        const outputTimestampMicros = Math.round(outputFrameIndex * frameDurationMicros);

        await seekVideo(sourceVideo, sourceTimestamp);

        const activeBRolls = await getActiveBRolls(loadedBRolls, sourceTimestamp);
        compositor.renderFrame({
          timestamp: sourceTimestamp,
          source: sourceVideo,
          bRolls: activeBRolls,
          transcript: options.transcript,
          captionsVisible: options.includeSubtitles,
          captionStyle: options.captionStyle,
          motionGraphics: options.motionGraphics,
          effects: options.effects,
          subtitlePosition: (options.captionStyle as any)?.position ?? 'bottom',
        });

        if (encoderClosed) {
          throw encoderError ?? new Error('VideoEncoder closed unexpectedly');
        }

        let frame: VideoFrame | null = null;
        try {
          frame = new VideoFrame(canvas, {
            timestamp: outputTimestampMicros,
            duration: frameDurationMicros,
          });

          if (encoderClosed) {
            throw encoderError ?? new Error('VideoEncoder closed unexpectedly');
          }

          try {
            videoEncoder.encode(frame, { keyFrame: outputFrameIndex % (fps * 2) === 0 });
          } catch (err) {
            encoderError = err instanceof Error ? err : new Error(String(err));
            throw encoderError;
          }
        } finally {
          try { frame?.close(); } catch {}
        }

        outputFrameIndex += 1;
        if (videoEncoder.encodeQueueSize > 6) {
          await waitForEncoderDrain();
        }

        if (encoderError) throw encoderError;

        if (outputFrameIndex % 5 === 0 || outputFrameIndex === totalFrames) {
          const progress = Math.min(0.85, (outputFrameIndex / totalFrames) * 0.85);
          options.onProgress?.(progress, `Encoding video frames... ${Math.round(progress * 100)}%`);
        }
      }
    }

    if (encoderError) throw encoderError;

    try {
      await videoEncoder.flush();
    } catch (err) {
      encoderError = err instanceof Error ? err : new Error(String(err));
      encoderClosed = true;
      try { videoEncoder.close(); } catch {}
      throw encoderError;
    }

    // close encoder now that we flushed all frames
    encoderClosed = true;
    try { videoEncoder.close(); } catch {}
  } catch (err) {
    encoderClosed = true;
    try { videoEncoder.close(); } catch {}
    disposeVideos([sourceVideo, ...loadedBRolls.map((item) => item.video)]);
    try { muxer.finalize(); } catch {}
    throw err;
  }

  if (preparedAudio) {
    options.onProgress?.(0.9, 'Encoding audio...');
    await encodeAudioTrack(preparedAudio, muxer);
  }

  muxer.finalize();
  options.onProgress?.(1, 'Finalizing MP4...');

  disposeVideos([sourceVideo, ...loadedBRolls.map((item) => item.video)]);
  return new Blob([target.buffer], { type: 'video/mp4' });
}

function assertWebCodecsAvailable() {
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
    throw new Error('WebCodecs VideoEncoder is not available in this browser/webview.');
  }
}

async function selectVideoCodec(size: VideoSize, bitrate: number, fps: number): Promise<SelectedVideoCodec> {
  function getH264CodecForHeight(height: number) {
    if (height <= 720) return 'avc1.42001f';
    if (height <= 1080) return 'avc1.4d0034';
    return 'avc1.64003e';
  }

  const h264Variants = [
    getH264CodecForHeight(size.height),
    'avc1.42E01E',
    'avc1.42001E',
    'avc1.4D401E',
    'avc1.640028',
  ];

  // de-duplicate while preserving order
  const uniqueH264: string[] = [];
  for (const v of h264Variants) {
    if (!uniqueH264.includes(v)) uniqueH264.push(v);
  }

  const candidates: SelectedVideoCodec[] = [
    ...uniqueH264.map((c) => ({ encoderCodec: c, muxerCodec: 'avc' })),
    { encoderCodec: 'vp09.00.10.08', muxerCodec: 'vp9' },
  ];

  for (const candidate of candidates) {
    const support = await (VideoEncoder as any).isConfigSupported({
      codec: candidate.encoderCodec,
      width: size.width,
      height: size.height,
      bitrate,
      framerate: fps,
    }).catch(() => ({ supported: false }));

    if (support && support.supported) return candidate;
  }

  throw new Error('No supported WebCodecs video encoder was found for MP4 export.');
}

async function loadVideoElement(path: string, muted: boolean): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.src = convertFileSrc(path);
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.muted = muted;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onError);
    };
    const onLoadedMetadata = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Failed to load video: ${path}`));
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.load();
  });

  return video;
}

function getVideoElementSize(video: HTMLVideoElement): VideoSize {
  return {
    width: video.videoWidth || 1920,
    height: video.videoHeight || 1080,
  };
}

function resolveOutputSize(
  sourceSize: VideoSize,
  aspectRatio: TimelineState['aspectRatio'],
  resolution: BrowserExportResolution,
): VideoSize {
  if (resolution === 'source') {
    return evenSize(sourceSize.width, sourceSize.height);
  }

  const height = Number(resolution);
  const ratio = parseAspectRatio(aspectRatio) ?? sourceSize.width / sourceSize.height;
  return evenSize(height * ratio, height);
}

function parseAspectRatio(aspectRatio: TimelineState['aspectRatio']) {
  const [width, height] = aspectRatio.split(':').map(Number);
  if (!width || !height) return null;
  return width / height;
}

function evenSize(width: number, height: number): VideoSize {
  return {
    width: Math.max(2, Math.round(width / 2) * 2),
    height: Math.max(2, Math.round(height / 2) * 2),
  };
}

async function getActiveBRolls(loadedBRolls: LoadedBRoll[], timestamp: number): Promise<RenderBRoll[]> {
  const active: RenderBRoll[] = [];

  for (const item of loadedBRolls) {
    const { segment, video } = item;
    if (timestamp < segment.start || timestamp >= segment.start + segment.duration) continue;

    await seekVideo(video, timestamp - segment.start);
    active.push({ segment, source: video });
  }

  return active;
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const duration = Number.isFinite(video.duration) ? video.duration : time;
  const clamped = Math.max(0, Math.min(time, Math.max(0, duration - 0.001)));

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Math.abs(video.currentTime - clamped) < 0.015) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out seeking to ${clamped.toFixed(3)}s`));
    }, 5000);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video seek failed'));
    };

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = clamped;
  });
}

function waitForEncoderDrain(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

interface PreparedAudio {
  buffer: AudioBuffer;
  numberOfChannels: number;
  sampleRate: number;
  codec: string;
  format: string;
}

async function prepareAudioTrack(
  sourcePath: string,
  keepSegments: TimelineState['edl'],
  onProgress?: BrowserExportOptions['onProgress'],
): Promise<PreparedAudio | null> {
  if (!('AudioEncoder' in window) || !('AudioData' in window)) {
    return null;
  }

  const sourceUrl = convertFileSrc(sourcePath);
  const audioBuffer = await fetch(sourceUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then(async (buffer) => {
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioContextCtor();
      try {
        return await audioContext.decodeAudioData(buffer.slice(0));
      } finally {
        await audioContext.close();
      }
    })
    .catch(() => null);

  if (!audioBuffer) return null;

  const numberOfChannels = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  const outputLength = keepSegments.reduce(
    (total, segment) => total + Math.max(0, Math.round((segment.end - segment.start) * sampleRate)),
    0,
  );

  if (outputLength <= 0) return null;

  const OfflineAudioContextCtor = window.OfflineAudioContext || (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const offlineContext = new OfflineAudioContextCtor(numberOfChannels, outputLength, sampleRate);
  const output = offlineContext.createBuffer(numberOfChannels, outputLength, sampleRate);
  let writeOffset = 0;

  for (const segment of keepSegments) {
    const readStart = Math.max(0, Math.floor(segment.start * sampleRate));
    const readEnd = Math.min(audioBuffer.length, Math.floor(segment.end * sampleRate));
    const framesToCopy = Math.max(0, readEnd - readStart);

    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      const source = audioBuffer.getChannelData(channel);
      const target = output.getChannelData(channel);
      target.set(source.subarray(readStart, readEnd), writeOffset);
    }

    writeOffset += framesToCopy;
  }

  // Try multiple audio codecs and choose the first supported one
  const audioCandidates = [
    { codec: 'mp4a.40.2', format: 'f32-planar' },
    { codec: 'opus', format: 'f32-planar' },
  ];

  for (const candidate of audioCandidates) {
    // @ts-ignore - some browsers may not support isConfigSupported
    const support = await (AudioEncoder as any).isConfigSupported({
      codec: candidate.codec,
      sampleRate,
      numberOfChannels,
      bitrate: 192_000,
    }).catch(() => ({ supported: false }));

    if (support && support.supported) {
      onProgress?.(0.03, 'Prepared source audio...');
      return { buffer: output, numberOfChannels, sampleRate, codec: candidate.codec, format: candidate.format };
    }
  }

  return null;
}

async function encodeAudioTrack(preparedAudio: PreparedAudio, muxer: Muxer<ArrayBufferTarget>) {
  let audioEncoderError: Error | null = null;

  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (error) => {
      audioEncoderError = error instanceof Error ? error : new Error(String(error));
    },
  });

  encoder.configure({
    codec: preparedAudio.codec,
    sampleRate: preparedAudio.sampleRate,
    numberOfChannels: preparedAudio.numberOfChannels,
    bitrate: 192_000,
  });

  for (let offset = 0; offset < preparedAudio.buffer.length; offset += AUDIO_FRAME_SIZE) {
    const frames = Math.min(AUDIO_FRAME_SIZE, preparedAudio.buffer.length - offset);
    const data = new Float32Array(frames * preparedAudio.numberOfChannels);

    for (let channel = 0; channel < preparedAudio.numberOfChannels; channel += 1) {
      const channelData = preparedAudio.buffer.getChannelData(channel).subarray(offset, offset + frames);
      data.set(channelData, channel * frames);
    }

    const audioData = new AudioData({
      format: preparedAudio.format as any,
      sampleRate: preparedAudio.sampleRate,
      numberOfFrames: frames,
      numberOfChannels: preparedAudio.numberOfChannels,
      timestamp: Math.round((offset / preparedAudio.sampleRate) * 1_000_000),
      data,
    });

    encoder.encode(audioData);
    audioData.close();

    if (encoder.encodeQueueSize > 12) {
      await waitForEncoderDrain();
    }

    if (audioEncoderError) break;
  }

  await encoder.flush();
  if (audioEncoderError) throw audioEncoderError;
}

// MediaRecorder fallback: render frames to canvas and capture via captureStream
async function recordCanvasStreamFallback(opts: {
  canvas: HTMLCanvasElement;
  compositor: Compositor;
  keepSegments: TimelineState['edl'];
  loadedBRolls: { segment: BRollSegment; video: HTMLVideoElement }[];
  sourceVideo: HTMLVideoElement;
  fps: number;
  frameDurationMicros: number;
  totalFrames: number;
  options: BrowserExportOptions;
}): Promise<Blob> {
  const { canvas, compositor, keepSegments, loadedBRolls, sourceVideo, fps, frameDurationMicros, totalFrames, options } = opts;

  // Choose mimeType
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    // try mp4 containers if MediaRecorder supports it in some webviews
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
  ];
  let mime: string | null = null;
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) {
      mime = c;
      break;
    }
  }
  if (!mime) mime = 'video/webm';

  const stream = (canvas as HTMLCanvasElement).captureStream(Math.max(1, fps));
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime as string });

  recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      try {
        const blob = new Blob(chunks, { type: mime as string });
        resolve(blob);
      } catch (e) { reject(e); }
    };
    recorder.onerror = (ev) => reject(new Error('MediaRecorder error: ' + (ev as any).error));
  });

  recorder.start();

  let outputFrameIndex = 0;
  try {
    for (const segment of keepSegments) {
      const segmentFrames = Math.max(1, Math.ceil((segment.end - segment.start) * fps));

      for (let frameInSegment = 0; frameInSegment < segmentFrames; frameInSegment += 1) {
        const sourceTimestamp = Math.min(segment.start + frameInSegment * (1 / fps), segment.end - 0.000_001);

        await seekVideo(sourceVideo, sourceTimestamp);

        const activeBRolls = await getActiveBRolls(loadedBRolls, sourceTimestamp);
        compositor.renderFrame({
          timestamp: sourceTimestamp,
          source: sourceVideo,
          bRolls: activeBRolls,
          transcript: options.transcript,
          captionsVisible: options.includeSubtitles,
          captionStyle: options.captionStyle,
          motionGraphics: options.motionGraphics,
          effects: options.effects,
          subtitlePosition: (options.captionStyle as any)?.position ?? 'bottom',
        });

        outputFrameIndex += 1;
        if (outputFrameIndex % 5 === 0 || outputFrameIndex === totalFrames) {
          const progress = Math.min(0.95, (outputFrameIndex / totalFrames) * 0.95);
          options.onProgress?.(progress, `Recording frames... ${Math.round(progress * 100)}%`);
        }

        // Allow the canvas update to be captured; wait approximately one frame
        await new Promise((r) => setTimeout(r, Math.max(1, Math.round(1000 / fps))));
      }
    }
  } catch (e) {
    try { recorder.stop(); } catch {}
    throw e;
  }

  // Stop recording and return blob
  try {
    recorder.stop();
  } catch (e) {}

  return stopPromise;
}

export async function exportTimelineFramesToPngSequence(
  state: TimelineState,
  options: BrowserExportOptions & { fps?: number; onProgress?: (p: number, m: string) => void },
  relativeDir: string,
): Promise<{ dir: string; frameCount: number; assPath?: string | null }> {
  // Only used in Tauri path. This writes PNG frames to AppLocalData/<relativeDir>
  const keepSegments = state.edl
    .filter((segment) => segment.segment_type === 'keep' && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);

  if (!state.source_video_path) throw new Error('No source video loaded');
  if (keepSegments.length === 0) throw new Error("No segments marked as 'keep'");

  const fps = options.fps ?? 30;
  const sourceVideo = await loadVideoElement(state.source_video_path, false);
  const sourceSize = getVideoElementSize(sourceVideo);
  const outputSize = resolveOutputSize(sourceSize, state.aspectRatio, options.resolution);
  const outputDuration = keepSegments.reduce((total, segment) => total + segment.end - segment.start, 0);
  const totalFrames = Math.max(1, Math.ceil(outputDuration * fps));

  const canvas = document.createElement('canvas');
  const compositor = new Compositor(canvas);
  compositor.setSize(outputSize.width, outputSize.height);

  const loadedBRolls = await Promise.all(
    options.bRolls
      .filter((segment) => segment.path && !segment.path.startsWith('mock://') && !segment.path.startsWith('appdata/'))
      .map(async (segment): Promise<LoadedBRoll> => ({
        segment,
        video: await loadVideoElement(segment.path, true),
      })),
  );

  // Create temp directory under AppLocalData
  const { writeFile, writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
  const { appLocalDataDir, join } = await import('@tauri-apps/api/path');

  await mkdir(relativeDir, { baseDir: BaseDirectory.AppLocalData, recursive: true });

  let frameIndex = 0;

  try {
    for (const segment of keepSegments) {
      const segmentFrames = Math.max(1, Math.ceil((segment.end - segment.start) * fps));

      for (let i = 0; i < segmentFrames; i += 1) {
        const sourceTimestamp = Math.min(segment.start + i * (1 / fps), segment.end - 0.000_001);

        await seekVideo(sourceVideo, sourceTimestamp);

        const activeBRolls = await getActiveBRolls(loadedBRolls, sourceTimestamp);
        compositor.renderFrame({
          timestamp: sourceTimestamp,
          source: sourceVideo,
          bRolls: activeBRolls,
          transcript: options.transcript,
          captionsVisible: options.includeSubtitles,
          captionStyle: options.captionStyle,
          motionGraphics: options.motionGraphics,
          effects: options.effects,
          subtitlePosition: (options.captionStyle as any)?.position ?? 'bottom',
        });

        // Export PNG
        // eslint-disable-next-line no-await-in-loop
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
        if (!blob) throw new Error('Canvas toBlob failed');
        const arrayBuffer = await blob.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);

        const filename = `${relativeDir}/frame_${String(frameIndex + 1).padStart(5, '0')}.png`;
        // eslint-disable-next-line no-await-in-loop
        await writeFile(filename, uint8, { baseDir: BaseDirectory.AppLocalData });

        frameIndex += 1;
        if (frameIndex % FRAMES_PER_BATCH === 0) {
          // yield to the event loop so the UI remains responsive
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 0));
        }
        const progress = Math.min(0.95, (frameIndex / totalFrames) * 0.95);
        options.onProgress?.(progress, `Rendering frames... ${Math.round(progress * 100)}%`);
      }
    }

    // Write ASS subtitles if present
    let assPath: string | null = null;
    if (options.includeSubtitles && Array.isArray(options.transcript) && options.transcript.length > 0) {
      const { generateSrtForExport } = await import('@/lib/export/subtitles');
      const ass = generateSrtForExport(options.transcript as any, state.edl, options.captionStyle);
      if (ass && ass.length > 0) {
        const assFilename = `${relativeDir}/subs.ass`;
        await writeTextFile(assFilename, ass, { baseDir: BaseDirectory.AppLocalData });
        const appData = await appLocalDataDir();
        assPath = await join(appData, relativeDir, 'subs.ass');
      }
    }

    const appData = await appLocalDataDir();
    const absoluteDir = await join(appData, relativeDir);
    return { dir: absoluteDir, frameCount: frameIndex, assPath };
  } finally {
    disposeVideos([sourceVideo, ...loadedBRolls.map((item) => item.video)]);
  }
}

export async function exportTimelineToTauriMp4(
  state: TimelineState,
  options: BrowserExportOptions & { fps?: number; onProgress?: (p: number, m: string) => void },
  outputPath: string,
  projectName?: string,
): Promise<string> {
  const fps = options.fps ?? 30;
  const tempPrefix = `cutflow_export_${crypto.randomUUID()}`;

  const { writeFile, writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
  const { invoke } = await import('@tauri-apps/api/core');
  const { appLocalDataDir, join } = await import('@tauri-apps/api/path');

  // ensure temp dir exists under AppLocalData
  await mkdir(tempPrefix, { baseDir: BaseDirectory.AppLocalData, recursive: true });

  // Render frames into temp dir
  const canvas = document.createElement('canvas');
  const compositor = new Compositor(canvas);
  const sourceVideo = await loadVideoElement(state.source_video_path, false);
  const sourceSize = getVideoElementSize(sourceVideo);
  const outputSize = resolveOutputSize(sourceSize, state.aspectRatio, options.resolution);
  compositor.setSize(outputSize.width, outputSize.height);

  const loadedBRolls = await Promise.all(
    options.bRolls
      .filter((segment) => segment.path && !segment.path.startsWith('mock://') && !segment.path.startsWith('appdata/'))
      .map(async (segment): Promise<LoadedBRoll> => ({
        segment,
        video: await loadVideoElement(segment.path, true),
      })),
  );

  const keepSegments = state.edl
    .filter((segment) => segment.segment_type === 'keep' && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);
  const totalOutputDuration = keepSegments.reduce((t, s) => t + (s.end - s.start), 0);
  const totalFrames = Math.max(1, Math.ceil(totalOutputDuration * fps));
  const FRAMES_PER_BATCH = 30;

  let frameIndex = 0;
  for (const segment of keepSegments) {
    const segmentFrames = Math.max(1, Math.ceil((segment.end - segment.start) * fps));
    for (let i = 0; i < segmentFrames; i += 1) {
      const sourceTimestamp = Math.min(segment.start + i * (1 / fps), segment.end - 0.000_001);
      await seekVideo(sourceVideo, sourceTimestamp);
      const activeBRolls = await getActiveBRolls(loadedBRolls, sourceTimestamp);
      compositor.renderFrame({
        timestamp: sourceTimestamp,
        source: sourceVideo,
        bRolls: activeBRolls,
        transcript: options.transcript,
        captionsVisible: options.includeSubtitles,
        captionStyle: options.captionStyle,
        motionGraphics: options.motionGraphics,
        effects: options.effects,
        subtitlePosition: (options.captionStyle as any)?.position ?? 'bottom',
      });

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
      if (!blob) throw new Error('Canvas toBlob failed');
      const arrayBuffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);

      const filename = `${tempPrefix}/frame_${String(frameIndex + 1).padStart(5, '0')}.png`;
      await writeFile(filename, uint8, { baseDir: BaseDirectory.AppLocalData });

      frameIndex += 1;
      if (frameIndex % FRAMES_PER_BATCH === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
      const progress = Math.min(0.8, (frameIndex / totalFrames) * 0.8);
      options.onProgress?.(progress, `Rendering frames... ${Math.round(progress * 100)}%`);
    }
  }

  // Write ASS subtitles if present
  if (options.includeSubtitles && Array.isArray(options.transcript) && options.transcript.length > 0) {
    const { generateSrtForExport } = await import('@/lib/export/subtitles');
    const ass = generateSrtForExport(options.transcript as any, state.edl, options.captionStyle);
    if (ass && ass.length > 0) {
      await writeTextFile(`${tempPrefix}/subtitles.ass`, ass, { baseDir: BaseDirectory.AppLocalData });
    }
  }

  // Try to extract edited audio and write it to AppLocalData/tempPrefix/audio.wav
  let audioAbsPath: string | null = null;
  try {
    if (state.source_video_path) {
      const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AudioContextCtor) {
        const audioContext = new AudioContextCtor();
        try {
          const sourceUrl = convertFileSrc(state.source_video_path);
          const resp = await fetch(sourceUrl);
          if (resp.ok) {
            const ab = await resp.arrayBuffer();
            const decoded = await audioContext.decodeAudioData(ab.slice(0));

            const channels = Math.min(2, decoded.numberOfChannels);
            const sampleRate = decoded.sampleRate;
            const totalFrames = keepSegments.reduce((sum, seg) => sum + Math.max(0, Math.round((seg.end - seg.start) * sampleRate)), 0);
            if (totalFrames > 0) {
              const edited = audioContext.createBuffer(channels, totalFrames, sampleRate);
              let writeOffset = 0;
              for (const seg of keepSegments) {
                const startFrame = Math.max(0, Math.floor(seg.start * sampleRate));
                const endFrame = Math.min(decoded.length, Math.floor(seg.end * sampleRate));
                const framesToCopy = Math.max(0, endFrame - startFrame);
                for (let ch = 0; ch < channels; ch += 1) {
                  const sourceData = decoded.getChannelData(ch);
                  const targetData = edited.getChannelData(ch);
                  targetData.set(sourceData.subarray(startFrame, startFrame + framesToCopy), writeOffset);
                }
                writeOffset += framesToCopy;
              }

              const wavBytes = audioBufferToWav(edited);
              await writeFile(`${tempPrefix}/audio.wav`, wavBytes, { baseDir: BaseDirectory.AppLocalData });
              const appData = await appLocalDataDir();
              audioAbsPath = await join(appData, tempPrefix, 'audio.wav');
            }
          }
        } finally {
          try { await audioContext.close(); } catch {}
        }
      }
    }
  } catch (e) {
    console.warn('[Exporter] failed to extract edited audio:', e);
    options.onProgress?.(0.5, 'Warning: Could not extract edited audio, using original audio track');
  }

  options.onProgress?.(0.85, 'Encoding with native ffmpeg...');
  const appData = await appLocalDataDir();
  const tempDirAbs = await join(appData, tempPrefix);
  await invoke('export_frames_to_mp4', { temp_dir: tempDirAbs, output_path: outputPath, fps, source_video_path: state.source_video_path, audio_path: audioAbsPath });
  options.onProgress?.(1, 'Export complete');

  disposeVideos([sourceVideo, ...loadedBRolls.map((i) => i.video)]);
  return outputPath;
}

function disposeVideos(videos: HTMLVideoElement[]) {
  videos.forEach((video) => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  });
}

function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const bufferSize = 44 + dataSize;
  const view = new DataView(new ArrayBuffer(bufferSize));
  let offset = 0;

  function writeString(s: string) {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  }

  writeString('RIFF');
  view.setUint32(offset, 36 + dataSize, true); offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true); offset += 4; // subchunk1 size
  view.setUint16(offset, 1, true); offset += 2; // PCM
  view.setUint16(offset, numChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2; // bits per sample
  writeString('data');
  view.setUint32(offset, dataSize, true); offset += 4;

  // Interleave and write samples
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i] || 0));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, Math.round(intSample), true);
      offset += 2;
    }
  }

  return new Uint8Array(view.buffer);
}
