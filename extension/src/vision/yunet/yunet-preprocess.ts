import * as ort from 'onnxruntime-web';
import type { PreprocessMetadata } from './yunet-types.js';

export async function preprocessYuNet(
  imgBitmap: ImageBitmap,
  targetWidth: number,
  targetHeight: number
): Promise<{ tensor: ort.Tensor; metadata: PreprocessMetadata }> {
  const sourceWidth = imgBitmap.width;
  const sourceHeight = imgBitmap.height;

  // Calculate scale preserving aspect ratio, but cap upscaling to 1.5x to prevent hallucinations
  const scaleX = targetWidth / sourceWidth;
  const scaleY = targetHeight / sourceHeight;
  const scale = Math.min(Math.min(scaleX, scaleY), 1.5);

  const modelWidth = Math.round(sourceWidth * scale);
  const modelHeight = Math.round(sourceHeight * scale);

  // Pad to required stride alignment (32 for YuNet)
  const paddedWidth = Math.ceil(modelWidth / 32) * 32;
  const paddedHeight = Math.ceil(modelHeight / 32) * 32;

  const offsetX = 0;
  const offsetY = 0;

  const canvas = new OffscreenCanvas(paddedWidth, paddedHeight);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Failed to get 2d context for YuNet preprocessing');
  }

  // Draw black padding
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, paddedWidth, paddedHeight);

  // Draw scaled image
  ctx.drawImage(imgBitmap, offsetX, offsetY, modelWidth, modelHeight);

  const imageData = ctx.getImageData(0, 0, paddedWidth, paddedHeight);
  const data = imageData.data;

  // YuNet expects CHW layout, BGR channel order, and float32 values [0..255]
  const float32Data = new Float32Array(3 * paddedWidth * paddedHeight);
  
  const channelSize = paddedWidth * paddedHeight;
  for (let i = 0; i < channelSize; i++) {
    // RGBA to BGR
    float32Data[i] = data[i * 4 + 2]!;                 // B -> Channel 0
    float32Data[channelSize + i] = data[i * 4 + 1]!;   // G -> Channel 1
    float32Data[2 * channelSize + i] = data[i * 4 + 0]!; // R -> Channel 2
  }

  const tensor = new ort.Tensor('float32', float32Data, [1, 3, paddedHeight, paddedWidth]);
  
  return {
    tensor,
    metadata: {
      sourceWidth,
      sourceHeight,
      modelWidth,
      modelHeight,
      scale,
      offsetX,
      offsetY,
      paddedWidth,
      paddedHeight
    }
  };
}
