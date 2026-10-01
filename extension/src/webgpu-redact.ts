// WebGPU constants
const GPU_TEXTURE_USAGE = {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};

const GPU_BUFFER_USAGE = {
  MAP_READ: 0x01,
  COPY_SRC: 0x04,
  COPY_DST: 0x08,
  STORAGE: 0x80,
};

const GPU_MAP_MODE = {
  READ: 0x01,
};

export async function redactImageWebGPU(
  bitmap: ImageBitmap,
  boxes: { rx: number; ry: number; rw: number; rh: number }[]
): Promise<Blob | null> {
  const nav = navigator as any;
  if (!nav.gpu) {
    console.warn('[WebGPU] WebGPU not supported on this browser.');
    return null;
  }

  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      console.warn('[WebGPU] No adapter found.');
      return null;
    }

    const device = await adapter.requestDevice();

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('webgpu') as any;
    if (!context) return null;

    const presentationFormat = nav.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format: presentationFormat,
      alphaMode: 'premultiplied'
    });

    // We can't directly read back from a canvas texture natively without a copy buffer,
    // so it's easier to use a storage buffer or render pipeline.
    // For simplicity, we just use a compute shader to copy image -> buffer while blacking out boxes.
    
    // Create source texture
    const srcTexture = device.createTexture({
      size: [bitmap.width, bitmap.height, 1],
      format: 'rgba8unorm',
      usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST | GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: srcTexture },
      [bitmap.width, bitmap.height]
    );

    // Create boxes buffer
    // Float32Array: [rx, ry, rw, rh] per box, plus boxCount at start
    const boxData = new Float32Array(4 + boxes.length * 4);
    boxData[0] = boxes.length;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      boxData[4 + i * 4] = b.rx;
      boxData[5 + i * 4] = b.ry;
      boxData[6 + i * 4] = b.rw;
      boxData[7 + i * 4] = b.rh;
    }

    const boxBuffer = device.createBuffer({
      size: Math.max(16, boxData.byteLength), // min 16 bytes
      usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
    });
    device.queue.writeBuffer(boxBuffer, 0, boxData);

    const shaderCode = `
      struct Box {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
      }

      struct Boxes {
        count: f32,
        pad1: f32,
        pad2: f32,
        pad3: f32,
        data: array<Box>,
      }

      @group(0) @binding(0) var srcTex: texture_2d<f32>;
      @group(0) @binding(1) var outTex: texture_storage_2d<rgba8unorm, write>;
      @group(0) @binding(2) var<storage, read> boxes: Boxes;

      @compute @workgroup_size(8, 8)
      fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
        let coords = vec2<i32>(global_id.xy);
        let texDims = textureDimensions(srcTex);
        
        if (coords.x >= i32(texDims.x) || coords.y >= i32(texDims.y)) {
          return;
        }
        
        let cx = f32(coords.x);
        let cy = f32(coords.y);
        var pixel = textureLoad(srcTex, coords, 0);

        let count = i32(boxes.count);
        var masked = false;
        
        for (var i = 0; i < count; i = i + 1) {
          let b = boxes.data[i];
          if (cx >= b.x && cx < (b.x + b.w) && cy >= b.y && cy < (b.y + b.h)) {
            masked = true;
            break;
          }
        }

        if (masked) {
          pixel = vec4<f32>(0.0, 0.0, 0.0, 1.0);
        }

        textureStore(outTex, coords, pixel);
      }
    `;

    const module = device.createShaderModule({ code: shaderCode });

    const outTexture = device.createTexture({
      size: [bitmap.width, bitmap.height, 1],
      format: 'rgba8unorm',
      usage: GPU_TEXTURE_USAGE.STORAGE_BINDING | GPU_TEXTURE_USAGE.COPY_SRC | GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
    });

    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: srcTexture.createView() },
        { binding: 1, resource: outTexture.createView() },
        { binding: 2, resource: { buffer: boxBuffer } },
      ],
    });

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(
      Math.ceil(bitmap.width / 8),
      Math.ceil(bitmap.height / 8)
    );
    passEncoder.end();

    // To read back, copy outTexture to a COPY_DST buffer
    const bytesPerRow = Math.ceil((bitmap.width * 4) / 256) * 256;
    const outputBuffer = device.createBuffer({
      size: bytesPerRow * bitmap.height,
      usage: GPU_BUFFER_USAGE.MAP_READ | GPU_BUFFER_USAGE.COPY_DST,
    });

    commandEncoder.copyTextureToBuffer(
      { texture: outTexture },
      { buffer: outputBuffer, bytesPerRow, rowsPerImage: bitmap.height },
      [bitmap.width, bitmap.height]
    );

    device.queue.submit([commandEncoder.finish()]);

    await outputBuffer.mapAsync(GPU_MAP_MODE.READ);
    const resultBuffer = outputBuffer.getMappedRange();
    
    // We must put this into an ImageData to return as a Blob.
    const imageData = new ImageData(bitmap.width, bitmap.height);
    const resultView = new Uint8Array(resultBuffer);
    
    if (bytesPerRow === bitmap.width * 4) {
      imageData.data.set(resultView);
    } else {
      for (let y = 0; y < bitmap.height; y++) {
        const srcRow = new Uint8Array(resultBuffer, y * bytesPerRow, bitmap.width * 4);
        imageData.data.set(srcRow, y * bitmap.width * 4);
      }
    }
    
    outputBuffer.unmap();
    
    // Draw ImageData back to a 2D canvas to get a Blob (since we can't easily Blob from ImageData)
    const renderCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const renderCtx = renderCanvas.getContext('2d');
    renderCtx!.putImageData(imageData, 0, 0);

    return await renderCanvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
    
  } catch (err) {
    console.error('[WebGPU] Redaction failed, falling back to 2D Canvas:', err);
    return null;
  }
}
