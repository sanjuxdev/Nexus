import type { FaceBox } from '@contracts/index.js';

export interface YuNetConfig {
  modelPath: string;
  inputSize: [number, number]; // [width, height]
  scoreThreshold: number;
  nmsThreshold: number;
  topK: number;
}

export interface PreprocessMetadata {
  sourceWidth: number;
  sourceHeight: number;
  modelWidth: number;
  modelHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  paddedWidth: number;
  paddedHeight: number;
}
