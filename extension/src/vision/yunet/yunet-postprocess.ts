import * as ort from 'onnxruntime-web';
import type { FaceBox } from '@contracts/index.js';
import type { YuNetConfig, PreprocessMetadata } from './yunet-types.js';

export function computeIoU(box1: number[], box2: number[]): number {
  const x1 = Math.max(box1[0]!, box2[0]!);
  const y1 = Math.max(box1[1]!, box2[1]!);
  const x2 = Math.min(box1[0]! + box1[2]!, box2[0]! + box2[2]!);
  const y2 = Math.min(box1[1]! + box1[3]!, box2[1]! + box2[3]!);
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  const inter = w * h;
  const area1 = box1[2]! * box1[3]!;
  const area2 = box2[2]! * box2[3]!;
  return inter / (area1 + area2 - inter);
}

export function computeIoM(box1: number[], box2: number[]): number {
  const x1 = Math.max(box1[0]!, box2[0]!);
  const y1 = Math.max(box1[1]!, box2[1]!);
  const x2 = Math.min(box1[0]! + box1[2]!, box2[0]! + box2[2]!);
  const y2 = Math.min(box1[1]! + box1[3]!, box2[1]! + box2[3]!);
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  const inter = w * h;
  const area1 = box1[2]! * box1[3]!;
  const area2 = box2[2]! * box2[3]!;
  return inter / Math.min(area1, area2);
}

export function postprocessYuNet(
  tensors: Record<string, ort.Tensor>,
  config: YuNetConfig,
  metadata: PreprocessMetadata
): FaceBox[] {
  let candidates: { box: number[], score: number }[] = [];
  
  const strides = [8, 16, 32];

  for (const stride of strides) {
    const clsTensor = tensors[`cls_${stride}`];
    const objTensor = tensors[`obj_${stride}`];
    const bboxTensor = tensors[`bbox_${stride}`];
    
    if (!clsTensor || !objTensor || !bboxTensor) continue;
    
    const clsData = clsTensor.data as Float32Array;
    const objData = objTensor.data as Float32Array;
    const bboxData = bboxTensor.data as Float32Array;
    
    const cols = Math.floor(metadata.paddedWidth / stride);
    const rows = Math.floor(metadata.paddedHeight / stride);
    
    // Log the actual shapes to know if it's CHW or HWC
    console.log(`[YuNet Dims] stride=${stride} bbox=${bboxTensor.dims.join(',')} obj=${objTensor.dims.join(',')}`);
    
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < cols; column++) {
        const idx = row * cols + column;
        
        // 1. Calculate Score (Anchor-free OpenCV YuNet uses sqrt(cls * obj))
        const cls = Math.max(0, Math.min(1, clsData[idx]!));
        const obj = Math.max(0, Math.min(1, objData[idx]!));
        const score = Math.sqrt(cls * obj);
        
        if (score >= config.scoreThreshold) {
          // 2. Decode Bounding Box
          const cx = (column + bboxData[idx * 4 + 0]!) * stride;
          const cy = (row + bboxData[idx * 4 + 1]!) * stride;
          const w = Math.exp(bboxData[idx * 4 + 2]!) * stride;
          const h = Math.exp(bboxData[idx * 4 + 3]!) * stride;
          
          const x = cx - w / 2;
          const y = cy - h / 2;
          
          candidates.push({ box: [x, y, w, h], score });
        }
      }
    }
  }

  // Debug log
  console.log(`[YUNET DECODER] Raw Candidates found: ${candidates.length} (Threshold: ${config.scoreThreshold})`);

  // NMS
  candidates.sort((a, b) => b.score - a.score);
  const kept: FaceBox[] = [];
  const active = new Array(candidates.length).fill(true);

  for (let i = 0; i < candidates.length; i++) {
    if (!active[i]) continue;
    const cand = candidates[i]!;
    
    // 3. Coordinate Transformation
    // Convert from detector padded space back to original frame space
    // x_frame = (x_padded - offsetX) / scale
    const bx = (cand.box[0]! - metadata.offsetX) / metadata.scale;
    const by = (cand.box[1]! - metadata.offsetY) / metadata.scale;
    const bw = cand.box[2]! / metadata.scale;
    const bh = cand.box[3]! / metadata.scale;
    
    // 4. Clip Boxes Safely
    const clipX = Math.max(0, bx);
    const clipY = Math.max(0, by);
    const clipW = Math.min(metadata.sourceWidth - clipX, bw - (clipX - bx));
    const clipH = Math.min(metadata.sourceHeight - clipY, bh - (clipY - by));
    
    if (clipW >= 8 && clipH >= 8) {
      kept.push({
        bbox: [
          Math.round(clipX),
          Math.round(clipY),
          Math.round(clipW),
          Math.round(clipH)
        ],
        confidence: cand.score,
        coordinateSpace: 'frame'
      });
    }
    
    if (kept.length >= config.topK) break;

    for (let j = i + 1; j < candidates.length; j++) {
      if (active[j]) {
        const iou = computeIoU(cand.box, candidates[j]!.box);
        if (iou > config.nmsThreshold) {
          active[j] = false;
        }
      }
    }
  }

  console.log(`[FACEBOX] Final decoded faces after NMS and coordinate clipping: ${kept.length}`);
  return kept;
}
