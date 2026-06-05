// CutFlow AI — Face Detection Web Worker
// Runs YOLOv8n ONNX inference to detect person bounding boxes.
// Only class 0 (person) is returned. Face region is estimated as
// the top 38% of the person bounding box.
//
// Messages received: { type: 'detect', imageData: ImageData, width: number, height: number }
// Messages sent:     { type: 'result', boxes: FaceBox[] }
//                    { type: 'ready' }
//                    { type: 'error', message: string }

import * as ort from 'onnxruntime-web/wasm';

export interface FaceBox {
  /** Normalized 0-1 coords of the estimated face region */
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

// ── Config ────────────────────────────────────────────────────────────────────
const MODEL_URL = '/yolov8n.onnx';
const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.35;
const IOU_THRESHOLD = 0.45;
const PERSON_CLASS = 0;
// Fraction of person box height used as face estimate (top portion)
const FACE_HEIGHT_FRACTION = 0.38;

// ── ONNX Session ─────────────────────────────────────────────────────────────
let session: ort.InferenceSession | null = null;

async function loadModel(): Promise<void> {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  // Serve WASM binaries from our local public/ort-wasm/ directory
  // using an absolute URL so Vite's static analyzer ignores it during dev.
  ort.env.wasm.wasmPaths = self.location.origin + '/ort-wasm/';

  session = await ort.InferenceSession.create(MODEL_URL, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  self.postMessage({ type: 'ready' });
}

// ── Preprocessing ─────────────────────────────────────────────────────────────
function preprocess(imageData: ImageData): { tensor: ort.Tensor; scale: number; padW: number; padH: number } {
  const { width: srcW, height: srcH, data } = imageData;
  const scale = INPUT_SIZE / Math.max(srcW, srcH);
  const newW = Math.round(srcW * scale);
  const newH = Math.round(srcH * scale);
  const padW = INPUT_SIZE - newW;
  const padH = INPUT_SIZE - newH;

  // Build a float32 CHW tensor (RGB, normalized 0-1) with letterbox padding
  const floatData = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  // Fill with 0 (black padding)

  // Blit scaled pixels row by row using nearest-neighbour
  for (let py = 0; py < newH; py++) {
    const srcY = Math.min(Math.round(py / scale), srcH - 1);
    for (let px = 0; px < newW; px++) {
      const srcX = Math.min(Math.round(px / scale), srcW - 1);
      const srcIdx = (srcY * srcW + srcX) * 4;
      const r = data[srcIdx]     / 255;
      const g = data[srcIdx + 1] / 255;
      const b = data[srcIdx + 2] / 255;
      // CHW layout: channel * H * W
      floatData[0 * INPUT_SIZE * INPUT_SIZE + py * INPUT_SIZE + px] = r;
      floatData[1 * INPUT_SIZE * INPUT_SIZE + py * INPUT_SIZE + px] = g;
      floatData[2 * INPUT_SIZE * INPUT_SIZE + py * INPUT_SIZE + px] = b;
    }
  }

  const tensor = new ort.Tensor('float32', floatData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  return { tensor, scale, padW, padH };
}

// ── NMS (simple greedy) ───────────────────────────────────────────────────────
function iou(a: number[], b: number[]): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const aArea = (a[2] - a[0]) * (a[3] - a[1]);
  const bArea = (b[2] - b[0]) * (b[3] - b[1]);
  return inter / (aArea + bArea - inter + 1e-6);
}

function nms(boxes: number[][], scores: number[]): number[] {
  const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  const keep: number[] = [];
  const suppressed = new Set<number>();
  for (const i of order) {
    if (suppressed.has(i)) continue;
    keep.push(i);
    for (const j of order) {
      if (j !== i && !suppressed.has(j) && iou(boxes[i], boxes[j]) > IOU_THRESHOLD) {
        suppressed.add(j);
      }
    }
  }
  return keep;
}

// ── Postprocessing ────────────────────────────────────────────────────────────
function postprocess(
  output: ort.Tensor,
  scale: number,
  srcW: number,
  srcH: number
): FaceBox[] {
  // YOLOv8 output shape: [1, 84, 8400] — 4 bbox + 80 classes
  const data = output.data as Float32Array;
  const numPreds = 8400;

  const personBoxes: number[][] = [];
  const personScores: number[] = [];

  for (let i = 0; i < numPreds; i++) {
    // data layout: [attr][pred] since shape is [1, 84, 8400]
    const cx = data[0 * numPreds + i];
    const cy = data[1 * numPreds + i];
    const bw = data[2 * numPreds + i];
    const bh = data[3 * numPreds + i];

    // Find max class score
    let maxScore = 0;
    let maxClass = -1;
    for (let c = 0; c < 80; c++) {
      const s = data[(4 + c) * numPreds + i];
      if (s > maxScore) { maxScore = s; maxClass = c; }
    }

    if (maxClass !== PERSON_CLASS || maxScore < CONF_THRESHOLD) continue;

    // Convert cx,cy,w,h → x1,y1,x2,y2 (in INPUT_SIZE space)
    let x1 = cx - bw / 2;
    let y1 = cy - bh / 2;
    let x2 = cx + bw / 2;
    let y2 = cy + bh / 2;

    // Unscale back to source image coords
    x1 = Math.max(0, Math.min(srcW, x1 / scale));
    y1 = Math.max(0, Math.min(srcH, y1 / scale));
    x2 = Math.max(0, Math.min(srcW, x2 / scale));
    y2 = Math.max(0, Math.min(srcH, y2 / scale));

    personBoxes.push([x1, y1, x2, y2]);
    personScores.push(maxScore);
  }

  if (personBoxes.length === 0) return [];

  const kept = nms(personBoxes, personScores);

  return kept.map(idx => {
    const [x1, y1, x2, y2] = personBoxes[idx];
    const personW = x2 - x1;
    const personH = y2 - y1;

    // Estimate face = top FACE_HEIGHT_FRACTION of person box
    const faceH = personH * FACE_HEIGHT_FRACTION;

    return {
      x: x1 / srcW,
      y: y1 / srcH,
      w: personW / srcW,
      h: faceH / srcH,
      confidence: personScores[idx],
    };
  });
}

// ── Inference ─────────────────────────────────────────────────────────────────
async function detect(imageData: ImageData): Promise<FaceBox[]> {
  if (!session) throw new Error('Model not loaded');

  const { tensor, scale } = preprocess(imageData);
  const inputName = session.inputNames[0];
  const feeds: Record<string, ort.Tensor> = { [inputName]: tensor };

  const results = await session.run(feeds);
  const outputName = session.outputNames[0];
  const output = results[outputName];

  return postprocess(output, scale, imageData.width, imageData.height);
}

// ── Message handler ───────────────────────────────────────────────────────────
loadModel().catch(err => {
  self.postMessage({ type: 'error', message: `Failed to load YOLO model: ${err?.message ?? err}` });
});

self.addEventListener('message', async (e: MessageEvent) => {
  if (e.data?.type !== 'detect') return;

  const { imageData } = e.data as { imageData: ImageData };

  try {
    const boxes = await detect(imageData);
    self.postMessage({ type: 'result', boxes });
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err) });
  }
});
