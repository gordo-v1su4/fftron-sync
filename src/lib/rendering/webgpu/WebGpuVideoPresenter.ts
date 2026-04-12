interface NavigatorGpuLike {
  requestAdapter: () => Promise<GPUAdapterLike | null>;
  getPreferredCanvasFormat?: () => string;
}

interface GPUAdapterLike {
  requestDevice: () => Promise<GPUDeviceLike>;
}

interface GPUExternalTextureLike {}

interface GPUQueueLike {
  submit: (commands: readonly unknown[]) => void;
  copyExternalImageToTexture?: (
    source: { source: HTMLVideoElement | HTMLCanvasElement },
    destination: { texture: GPUTextureLike },
    size: { width: number; height: number; depthOrArrayLayers?: number },
  ) => void;
  writeTexture?: (
    destination: { texture: GPUTextureLike },
    data: AllowSharedBufferSource,
    dataLayout: { bytesPerRow: number; rowsPerImage?: number; offset?: number },
    size: { width: number; height: number; depthOrArrayLayers?: number },
  ) => void;
}

interface GPUTextureLike {
  createView: () => unknown;
  destroy?: () => void;
}

interface GPURenderPassEncoderLike {
  setPipeline: (pipeline: unknown) => void;
  setBindGroup: (index: number, bindGroup: unknown) => void;
  draw: (vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number) => void;
  end: () => void;
}

interface GPUCommandEncoderLike {
  beginRenderPass: (descriptor: unknown) => GPURenderPassEncoderLike;
  finish: () => unknown;
}

interface GPUDeviceLike {
  queue: GPUQueueLike;
  importExternalTexture?: (descriptor: { source: HTMLVideoElement }) => GPUExternalTextureLike;
  createShaderModule: (descriptor: { code: string }) => unknown;
  createSampler: (descriptor: Record<string, unknown>) => unknown;
  createBindGroupLayout: (descriptor: unknown) => unknown;
  createPipelineLayout: (descriptor: unknown) => unknown;
  createRenderPipeline: (descriptor: unknown) => unknown;
  createBindGroup: (descriptor: unknown) => unknown;
  createCommandEncoder: () => GPUCommandEncoderLike;
  createTexture: (descriptor: Record<string, unknown>) => GPUTextureLike;
  destroy?: () => void;
}

interface GPUCanvasContextLike {
  configure: (descriptor: {
    device: GPUDeviceLike;
    format: string;
    alphaMode?: "opaque" | "premultiplied";
  }) => void;
  getCurrentTexture: () => GPUTextureLike;
}

const shaderCode = /* wgsl */ `
@group(0) @binding(0) var videoSampler : sampler;
@group(0) @binding(1) var videoTexture : texture_2d<f32>;

struct VertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VertexOut {
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  var uvs = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0),
  );

  var out : VertexOut;
  out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return textureSample(videoTexture, videoSampler, in.uv);
}
`;

const externalTextureShaderCode = /* wgsl */ `
@group(0) @binding(0) var videoSampler : sampler;
@group(0) @binding(1) var videoTexture : texture_external;

struct VertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VertexOut {
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  var uvs = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 0.0),
  );

  var out : VertexOut;
  out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return textureSampleBaseClampToEdge(videoTexture, videoSampler, in.uv);
}
`;

export class WebGpuVideoPresenter {
  private canvas: HTMLCanvasElement | null = null;
  private context: GPUCanvasContextLike | null = null;
  private device: GPUDeviceLike | null = null;
  private pipeline: unknown = null;
  private bindGroupLayout: unknown = null;
  private externalPipeline: unknown = null;
  private externalBindGroupLayout: unknown = null;
  private sampler: unknown = null;
  private format = "bgra8unorm";
  private sourceVideo: HTMLVideoElement | null = null;
  private sourceTexture: GPUTextureLike | null = null;
  private textureSize = { width: 0, height: 0 };
  private transferCanvas: HTMLCanvasElement | null = null;
  private transferContext: CanvasRenderingContext2D | null = null;
  private useCopiedVideoFallback = false;
  private readonly textureUsage =
    ((globalThis as { GPUTextureUsage?: { TEXTURE_BINDING?: number; COPY_DST?: number; RENDER_ATTACHMENT?: number } }).GPUTextureUsage?.TEXTURE_BINDING ?? 0x04) |
    ((globalThis as { GPUTextureUsage?: { TEXTURE_BINDING?: number; COPY_DST?: number; RENDER_ATTACHMENT?: number } }).GPUTextureUsage?.COPY_DST ?? 0x08) |
    ((globalThis as { GPUTextureUsage?: { TEXTURE_BINDING?: number; COPY_DST?: number; RENDER_ATTACHMENT?: number } }).GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10);

  private getAlignedBytesPerRow(width: number): number {
    const unaligned = width * 4;
    return Math.ceil(unaligned / 256) * 256;
  }

  private supportsExternalTexture(): boolean {
    return typeof navigator !== 'undefined' &&
      !/Firefox\//.test(navigator.userAgent) &&
      Boolean(this.device?.importExternalTexture);
  }

  private shouldUseCopiedVideoFallback(): boolean {
    return typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);
  }

  async attach(canvas: HTMLCanvasElement): Promise<void> {
    const gpu = (navigator as Navigator & { gpu?: NavigatorGpuLike }).gpu;
    if (!gpu) throw new Error("navigator.gpu is unavailable");

    const adapter = await gpu.requestAdapter();
    if (!adapter) throw new Error("WebGPU adapter is unavailable");

    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu") as GPUCanvasContextLike | null;
    if (!context) throw new Error("webgpu canvas context is unavailable");

    const format = gpu.getPreferredCanvasFormat?.() ?? this.format;
    context.configure({
      device,
      format,
      alphaMode: "opaque",
    });

    const shaderModule = device.createShaderModule({ code: shaderCode });
    const externalShaderModule = device.createShaderModule({ code: externalTextureShaderCode });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: 2,
          sampler: { type: "filtering" },
        },
        {
          binding: 1,
          visibility: 2,
          texture: { sampleType: "float" },
        },
      ],
    });
    const externalBindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: 2,
          sampler: { type: "filtering" },
        },
        {
          binding: 1,
          visibility: 2,
          externalTexture: {},
        },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });
    const externalPipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [externalBindGroupLayout],
    });
    const pipeline = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [{ format }],
      },
      primitive: {
        topology: "triangle-list",
      },
    });
    const externalPipeline = device.createRenderPipeline({
      layout: externalPipelineLayout,
      vertex: {
        module: externalShaderModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: externalShaderModule,
        entryPoint: "fs_main",
        targets: [{ format }],
      },
      primitive: {
        topology: "triangle-list",
      },
    });
    const sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });

    this.canvas = canvas;
    this.context = context;
    this.device = device;
    this.transferCanvas = document.createElement('canvas');
    this.transferContext = this.transferCanvas.getContext('2d', { willReadFrequently: true });
    this.useCopiedVideoFallback = this.shouldUseCopiedVideoFallback();
    this.pipeline = pipeline;
    this.bindGroupLayout = bindGroupLayout;
    this.externalPipeline = externalPipeline;
    this.externalBindGroupLayout = externalBindGroupLayout;
    this.sampler = sampler;
    this.format = format;
    this.syncCanvasSize();
  }

  detach(): void {
    this.sourceVideo = null;
    this.transferContext = null;
    this.transferCanvas = null;
    this.sourceTexture?.destroy?.();
    this.sourceTexture = null;
    this.textureSize = { width: 0, height: 0 };
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.externalPipeline = null;
    this.externalBindGroupLayout = null;
    this.sampler = null;
    this.context = null;
    this.canvas = null;
    this.device?.destroy?.();
    this.device = null;
  }

  setSource(video: HTMLVideoElement | null): void {
    this.sourceVideo = video;
  }

  isReady(): boolean {
    return Boolean(this.canvas && this.context && this.device && this.pipeline && this.bindGroupLayout && this.sampler);
  }

  render(): boolean {
    if (!this.isReady() || !this.context || !this.device || !this.sourceVideo || this.sourceVideo.readyState < 2) {
      return false;
    }

    this.syncCanvasSize();
    let bindGroup: unknown;
    let pipeline = this.pipeline;

    if (this.supportsExternalTexture() && this.externalPipeline && this.externalBindGroupLayout) {
      if (this.sourceVideo.seeking || this.sourceVideo.readyState < 3) {
        return false;
      }
      let externalTexture: GPUExternalTextureLike | undefined;
      try {
        externalTexture = this.device.importExternalTexture?.({ source: this.sourceVideo });
      } catch {
        return false;
      }
      if (!externalTexture) {
        return false;
      }
      bindGroup = this.device.createBindGroup({
        layout: this.externalBindGroupLayout,
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: externalTexture },
        ],
      });
      pipeline = this.externalPipeline;
    } else if (this.useCopiedVideoFallback) {
      this.ensureSourceTexture(this.sourceVideo.videoWidth || 1, this.sourceVideo.videoHeight || 1);
      if (!this.sourceTexture || !this.transferCanvas || !this.transferContext) {
        throw new Error('WebGPU video texture upload is unavailable');
      }
      this.transferCanvas.width = this.textureSize.width;
      this.transferCanvas.height = this.textureSize.height;
      this.transferContext.drawImage(this.sourceVideo, 0, 0, this.textureSize.width, this.textureSize.height);
      if (this.device.queue.writeTexture) {
        const frameData = this.transferContext.getImageData(
          0,
          0,
          this.textureSize.width,
          this.textureSize.height,
        );
        const alignedBytesPerRow = this.getAlignedBytesPerRow(this.textureSize.width);
        const packed = new Uint8Array(alignedBytesPerRow * this.textureSize.height);
        const rowWidth = this.textureSize.width * 4;
        for (let row = 0; row < this.textureSize.height; row += 1) {
          const srcStart = row * rowWidth;
          const srcEnd = srcStart + rowWidth;
          const dstStart = row * alignedBytesPerRow;
          packed.set(frameData.data.subarray(srcStart, srcEnd), dstStart);
        }
        this.device.queue.writeTexture(
          { texture: this.sourceTexture },
          packed,
          { bytesPerRow: alignedBytesPerRow },
          { width: this.textureSize.width, height: this.textureSize.height, depthOrArrayLayers: 1 },
        );
      } else if (this.device.queue.copyExternalImageToTexture) {
        this.device.queue.copyExternalImageToTexture(
          { source: this.transferCanvas },
          { texture: this.sourceTexture },
          { width: this.textureSize.width, height: this.textureSize.height, depthOrArrayLayers: 1 },
        );
      } else {
        throw new Error('WebGPU upload queue path is unavailable');
      }
      bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: this.sourceTexture.createView() },
        ],
      });
    } else {
      throw new Error('WebGPU HTML video external textures are unavailable in this browser/adapter');
    }

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, 1, 0, 0);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
    return true;
  }

  private ensureSourceTexture(width: number, height: number): void {
    if (!this.device) return;
    if (this.sourceTexture && this.textureSize.width === width && this.textureSize.height === height) {
      return;
    }
    this.sourceTexture?.destroy?.();
    this.textureSize = { width, height };
    this.sourceTexture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: this.textureUsage,
    });
  }

  private syncCanvasSize(): void {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const container = this.canvas.parentElement;
    const containerWidth = Math.max(1, Math.round((container?.clientWidth ?? this.canvas.clientWidth) || 1));
    const containerHeight = Math.max(1, Math.round((container?.clientHeight ?? this.canvas.clientHeight) || 1));

    let displayWidth = containerWidth;
    let displayHeight = containerHeight;

    if (this.sourceVideo && this.sourceVideo.videoWidth > 0 && this.sourceVideo.videoHeight > 0) {
      const scale = Math.min(
        containerWidth / this.sourceVideo.videoWidth,
        containerHeight / this.sourceVideo.videoHeight,
      );
      displayWidth = Math.max(1, Math.round(this.sourceVideo.videoWidth * scale));
      displayHeight = Math.max(1, Math.round(this.sourceVideo.videoHeight * scale));
    }

    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;

    const width = Math.max(1, Math.round(displayWidth * dpr));
    const height = Math.max(1, Math.round(displayHeight * dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }
}
