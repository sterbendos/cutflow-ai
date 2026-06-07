import { convertFileSrc } from '@tauri-apps/api/core';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { TimelineState, BRollSegment } from '@/context/TimelineContext';
import type { CaptionStyle } from '@/context/CaptionContext';
import { Compositor, type RenderBRoll } from './Compositor';

export type BrowserExportQuality = 'high' | 'medium' | 'low';
export type BrowserExportResolution = 'source' | '2160' | '1080' | '720';

export interface BrowserExportOptions {
  quality: BrowserExportQuality;
  resolution: BrowserExportResolution;
  includeSubtitles: boolean;
  transcript: any;
  captionStyle: CaptionStyle;
  effects: any;
  bRolls: BRollSegment[];
  motionGraphics: any;
  onProgress?: (progress: number, message: string) => void;
  fps?: number;
}

type VideoSize = { width: number; height: number };

type SelectedVideoCodec = {
  encoderCodec: string;
  muxerCodec: 'avc' | 'vp9';
};

type LoadedBRoll = { segment: BRollSegment; video: HTMLVideoElement };

const FRAMES_PER_BATCH = 30;


const QUALITY_BITRATES: Record<BrowserExportQuality, number> = {
  high: 10_000_000,
  medium: 6_000_000,
  low: 3_000_000,
};

export async function exportTimelineToMp4(
  state: TimelineState,
  options: BrowserExportOptions & { fps?: number },
): Promise<Blob> {
  assertWebCodecsAvailable();

  const fps = options.fps ?? 30;


  const sourceVideo = await loadVideoElement(state.source_video_path, false);
  const sourceSize = getVideoElementSize(sourceVideo);
  const outputSize = resolveOutputSize(sourceSize, state.aspectRatio, options.resolution);

  const keepSegments = state.edl
    .filter((segment) => segment.segment_type === 'keep' && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);

  const totalOutputDuration = keepSegments.reduce((t, s) => t + (s.end - s.start), 0);
  const totalFrames = Math.max(1, Math.ceil(totalOutputDuration * fps));

  // Canvas compositor
  const canvas = document.createElement('canvas');
  const compositor = new Compositor(canvas);
  compositor.setSize(outputSize.width, outputSize.height);

  // Load b-rolls
  const loadedBRolls: LoadedBRoll[] = await Promise.all(
    (options.bRolls ?? [])
      .filter((segment) => segment.path && !segment.path.startsWith('mock://') && !segment.path.startsWith('appdata/'))
      .map(async (segment): Promise<LoadedBRoll> => ({ segment, video: await loadVideoElement(segment.path, true) })),
  );

  const frameDurationMicros = Math.round(1_000_000 / fps);

  // Setup muxer
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: outputSize.width, height: outputSize.height },
    fastStart: 'in-memory',
    audio: options.includeSubtitles
      ? {
          codec: 'aac',
          sampleRate: 44100,
          numberOfChannels: 2,
        }
      : undefined,
  });

  const codec = await selectVideoCodec(outputSize, QUALITY_BITRATES[options.quality], fps);

  let encoderError: Error | null = null;
  let encoderClosed = false;
  let videoEncoder: VideoEncoder | null = null;

  const encoderOutput = (chunk: any, meta: any) => {
    if (!encoderClosed) muxer.addVideoChunk(chunk, meta);
  };

  const encoderErrorHandler = (err: any) => {
    encoderError = err instanceof Error ? err : new Error(String(err));
    encoderClosed = true;
  };

  try {
    // Some webviews have different ctor typing; keep it dynamic.
    // @ts-ignore
    videoEncoder = new (VideoEncoder as any)({ output: encoderOutput, error: encoderErrorHandler });
  } catch (ctorErr) {
    options.onProgress?.(0, 'Encoder unavailable — falling back to MediaRecorder');
    // Fallback: record canvas stream
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
  }

  // Configure attempts
  const configureAttempts: any[] = [
    { hardwareAcceleration: 'prefer-hardware' },
    { hardwareAcceleration: 'prefer-software' },
    {},
  ];

  let configured = false;


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
    }

  }

  if (!configured || !videoEncoder) {
    encoderClosed = true;
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
  }

  options.onProgress?.(0, 'Encoding video frames...');

  // Encode frames
  let outputFrameIndex = 0;

  try {
    for (const segment of keepSegments) {
      const segmentFrames = Math.max(1, Math.ceil((segment.end - segment.start) * fps));

      for (let frameInSegment = 0; frameInSegment < segmentFrames; frameInSegment += 1) {
        const sourceTimestamp = Math.min(segment.start + frameInSegment * (1 / fps), segment.end - 0.000_001);
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

        if (encoderClosed) throw encoderError ?? new Error('VideoEncoder closed unexpectedly');

        let frame: VideoFrame | null = null;
        try {
          frame = new VideoFrame(canvas, {
            timestamp: outputTimestampMicros,
            duration: frameDurationMicros,
          });

          if (encoderClosed) throw encoderError ?? new Error('VideoEncoder closed unexpectedly');

          // keyframe cadence
          videoEncoder.encode(frame, { keyFrame: outputFrameIndex % (fps * 2) === 0 });
        } finally {
          frame?.close();
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

    await videoEncoder.flush();
    encoderClosed = true;
    videoEncoder.close();
  } catch (err) {
    encoderClosed = true;
    try {
      videoEncoder?.close();
    } catch {}
    disposeVideos([sourceVideo, ...loadedBRolls.map((i) => i.video)]);
    try {
      muxer.finalize();
    } catch {}
    throw err;
  }

  // Note: Audio path is disabled here for now (browser path was previously unstable).
  // Native export uses ffmpeg sidecar + WAV mapping.

  muxer.finalize();
  options.onProgress?.(1, 'Finalizing MP4...');

  disposeVideos([sourceVideo, ...loadedBRolls.map((i) => i.video)]);
  // mp4-muxer writes into target.buffer
  return new Blob([target.buffer], { type: 'video/mp4' });
}

export async function exportTimelineFramesToPngSequence(
  state: TimelineState,
  options: BrowserExportOptions & { fps?: number; onProgress?: (p: number, m: string) => void },
  relativeDir: string,
): Promise<{ dir: string; frameCount: number; assPath?: string | null }> {
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
      .map(async (segment): Promise<LoadedBRoll> => ({ segment, video: await loadVideoElement(segment.path, true) })),
  );

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

        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
        if (!blob) throw new Error('Canvas toBlob failed');
        const arrayBuffer = await blob.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);

        const filename = `${relativeDir}/frame_${String(frameIndex + 1).padStart(5, '0')}.png`;
        await writeFile(filename, uint8, { baseDir: BaseDirectory.AppLocalData });

        frameIndex += 1;
        if (frameIndex % FRAMES_PER_BATCH === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }

        const progress = Math.min(0.95, (frameIndex / totalFrames) * 0.95);
        options.onProgress?.(progress, `Rendering frames... ${Math.round(progress * 100)}%`);
      }
    }

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
): Promise<string> {
  const fps = options.fps ?? 30;
  const tempPrefix = `cutflow_export_${crypto.randomUUID()}`;

  const { writeFile, writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
  const { invoke } = await import('@tauri-apps/api/core');
  const { appLocalDataDir, join } = await import('@tauri-apps/api/path');

  console.debug('[TauriExport] === START ===');

  await mkdir(tempPrefix, { baseDir: BaseDirectory.AppLocalData, recursive: true });

  const sourceVideo = await loadVideoElement(state.source_video_path, false);

  const canvas = document.createElement('canvas');
  const compositor = new Compositor(canvas);
  const sourceSize = getVideoElementSize(sourceVideo);
  const outputSize = resolveOutputSize(sourceSize, state.aspectRatio, options.resolution);
  compositor.setSize(outputSize.width, outputSize.height);

  const loadedBRolls: LoadedBRoll[] = await Promise.all(
    options.bRolls
      .filter((segment) => segment.path && !segment.path.startsWith('mock://') && !segment.path.startsWith('appdata/'))
      .map(async (segment): Promise<LoadedBRoll> => ({ segment, video: await loadVideoElement(segment.path, true) })),
  );

  const keepSegments = state.edl
    .filter((segment) => segment.segment_type === 'keep' && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);

  const totalOutputDuration = keepSegments.reduce((t, s) => t + (s.end - s.start), 0);
  const totalFrames = Math.max(1, Math.ceil(totalOutputDuration * fps));

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

        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
        if (!blob) throw new Error('Canvas toBlob failed');
        const arrayBuffer = await blob.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);

        const filename = `${tempPrefix}/frame_${String(frameIndex + 1).padStart(5, '0')}.png`;
        await writeFile(filename, uint8, { baseDir: BaseDirectory.AppLocalData });

        frameIndex += 1;
        if (frameIndex % FRAMES_PER_BATCH === 0) await new Promise((r) => setTimeout(r, 0));

        const progress = Math.min(0.8, (frameIndex / totalFrames) * 0.8);
        options.onProgress?.(progress, `Rendering frames... ${Math.round(progress * 100)}%`);
      }
    }

    // Subtitles (best-effort)
    try {
      if (options.includeSubtitles && Array.isArray(options.transcript) && options.transcript.length > 0) {
        const { generateSrtForExport } = await import('@/lib/export/subtitles');
        const ass = generateSrtForExport(options.transcript as any, state.edl, options.captionStyle);
        if (ass && ass.length > 0) {
          await writeTextFile(`${tempPrefix}/subtitles.ass`, ass, { baseDir: BaseDirectory.AppLocalData });
        }
      }
    } catch (e) {
      console.warn('[TauriExport] Subtitles failed (non-critical)', e);
    }

    // Audio extraction removed from this minimal reconstruction for stability.
    // Native ffmpeg export can run without audio.

    options.onProgress?.(0.85, 'Encoding with native ffmpeg...');

    const appData = await appLocalDataDir();
    const tempDirAbs = await join(appData, tempPrefix);

    await invoke('export_frames_to_mp4', { temp_dir: tempDirAbs, output_path: outputPath, fps });

    options.onProgress?.(1, 'Export complete');
  } finally {
    disposeVideos([sourceVideo, ...loadedBRolls.map((i) => i.video)]);
  }

  return outputPath;
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

  const uniqueH264: string[] = [];
  for (const v of h264Variants) {
    if (!uniqueH264.includes(v)) uniqueH264.push(v);
  }

  const candidates: SelectedVideoCodec[] = [
    ...uniqueH264.map((c) => ({ encoderCodec: c, muxerCodec: 'avc' as const })),
    { encoderCodec: 'vp09.00.10.08', muxerCodec: 'vp9' as const },
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
  const normalizedPath = typeof path === 'string' ? path.replace(/\\/g, '/') : path;
  const video = document.createElement('video');
  try {
    video.src = convertFileSrc(normalizedPath);
  } catch (e) {
    console.debug('[loadVideoElement] convertFileSrc failed, using normalized path', normalizedPath, e);
    video.src = normalizedPath;
  }
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.muted = muted;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout loading video: ${normalizedPath}`));
    }, 10000);

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onError);
    };

    const onLoadedMetadata = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error(`Failed to load video: ${normalizedPath}`));
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

function resolveOutputSize(sourceSize: VideoSize, aspectRatio: TimelineState['aspectRatio'], resolution: BrowserExportResolution): VideoSize {
  if (resolution === 'source') return evenSize(sourceSize.width, sourceSize.height);

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

async function recordCanvasStreamFallback(opts: {
  canvas: HTMLCanvasElement;
  compositor: Compositor;
  keepSegments: TimelineState['edl'];
  loadedBRolls: LoadedBRoll[];
  sourceVideo: HTMLVideoElement;
  fps: number;
  frameDurationMicros: number;
  totalFrames: number;
  options: BrowserExportOptions;
}): Promise<Blob> {
  const { canvas, compositor, keepSegments, loadedBRolls, sourceVideo, fps, totalFrames, options } = opts;

  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
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

  const stream = canvas.captureStream(Math.max(1, fps));
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime as string });

  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size) chunks.push(ev.data);
  };

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      try {
        resolve(new Blob(chunks, { type: mime as string }));
      } catch (e) {
        reject(e);
      }
    };
    recorder.onerror = (ev: any) => reject(new Error('MediaRecorder error: ' + (ev?.error ?? 'unknown')));
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

        await new Promise((r) => setTimeout(r, Math.max(1, Math.round(1000 / fps))));
      }
    }
  } finally {
    try {
      recorder.stop();
    } catch {}
  }

  return stopPromise;
}

function disposeVideos(videos: HTMLVideoElement[]) {
  videos.forEach((video) => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  });
}

