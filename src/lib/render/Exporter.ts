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
  if (runningInTauri() || !supportsWebCodecs) {
    try {
      options.onProgress?.(0, 'Running Tauri fallback exporter (MediaRecorder)');
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
      console.warn('[Exporter] Tauri MediaRecorder fallback failed, falling back to VideoEncoder path:', tauriFallbackErr);
      // continue to try VideoEncoder creation below
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

  const createEncoder = () => new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (err) {
        encoderError = err instanceof Error ? err : new Error(String(err));
        encoderClosed = true;
      }
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
      encoderClosed = true;
    },
  });

  try {
    // Try preferred hardware acceleration first, then fall back to software.
    videoEncoder = createEncoder();
    try {
      videoEncoder.configure({
        codec: codec.encoderCodec,
        width: outputSize.width,
        height: outputSize.height,
        bitrate: QUALITY_BITRATES[options.quality],
        framerate: fps,
        latencyMode: 'quality',
        hardwareAcceleration: 'prefer-hardware',
      });
    } catch (hwErr) {
      console.warn('[Exporter] hardware VideoEncoder.configure failed, trying prefer-software', hwErr);
      try {
        videoEncoder.configure({
          codec: codec.encoderCodec,
          width: outputSize.width,
          height: outputSize.height,
          bitrate: QUALITY_BITRATES[options.quality],
          framerate: fps,
          latencyMode: 'quality',
          hardwareAcceleration: 'prefer-software',
        });
      } catch (swErr) {
        // Close encoder and rethrow combined error
        try { videoEncoder.close(); } catch {}
        encoderClosed = true;
        throw new Error(`Encoder configure failed (hardware error: ${String(hwErr)}; software error: ${String(swErr)})`);
      }
    }
  } catch (createErr) {
    console.warn('[Exporter] VideoEncoder creation/configure failed:', createErr);
    // Try MediaRecorder fallback to produce a WebM when WebCodecs are unavailable
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
  const candidates: SelectedVideoCodec[] = [
    { encoderCodec: 'avc1.42001f', muxerCodec: 'avc' },
    { encoderCodec: 'vp09.00.10.08', muxerCodec: 'vp9' },
  ];

  for (const candidate of candidates) {
    const support = await VideoEncoder.isConfigSupported({
      codec: candidate.encoderCodec,
      width: size.width,
      height: size.height,
      bitrate,
      framerate: fps,
    }).catch(() => ({ supported: false }));

    if (support.supported) return candidate;
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

  const support = await AudioEncoder.isConfigSupported({
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels,
    bitrate: 192_000,
  }).catch(() => ({ supported: false }));

  if (!support.supported) return null;

  onProgress?.(0.03, 'Prepared source audio...');
  return { buffer: output, numberOfChannels, sampleRate };
}

async function encodeAudioTrack(preparedAudio: PreparedAudio, muxer: Muxer<ArrayBufferTarget>) {
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (error) => {
      throw error;
    },
  });

  encoder.configure({
    codec: 'mp4a.40.2',
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
      format: 'f32-planar',
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
  }

  await encoder.flush();
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
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
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

  // ensure temp dir exists
  await mkdir(tempPrefix, { baseDir: BaseDirectory.Temp, recursive: true });

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
      });

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
      if (!blob) throw new Error('Canvas toBlob failed');
      const arrayBuffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);

      const filename = `${tempPrefix}/frame_${String(frameIndex + 1).padStart(5, '0')}.png`;
      await writeFile(filename, uint8, { baseDir: BaseDirectory.Temp });

      frameIndex += 1;
      const progress = Math.min(0.8, (frameIndex / Math.max(1, Math.ceil(keepSegments.reduce((t, s) => t + (s.end - s.start), 0) * fps))) * 0.8);
      options.onProgress?.(progress, `Rendering frames... ${Math.round(progress * 100)}%`);
    }
  }

  // Write ASS subtitles if present
  if (options.includeSubtitles && Array.isArray(options.transcript) && options.transcript.length > 0) {
    const { generateSrtForExport } = await import('@/lib/export/subtitles');
    const ass = generateSrtForExport(options.transcript as any, state.edl, options.captionStyle);
    if (ass && ass.length > 0) {
      await writeTextFile(`${tempPrefix}/subtitles.ass`, ass, { baseDir: BaseDirectory.Temp });
    }
  }

  options.onProgress?.(0.85, 'Encoding with native ffmpeg...');
  await invoke('export_frames_to_mp4', { temp_prefix: tempPrefix, output_path: outputPath, fps, source_video_path: state.source_video_path });
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
