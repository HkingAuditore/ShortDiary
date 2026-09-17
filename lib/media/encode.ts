import { encode as blurhashEncode } from "blurhash";

/**
 * 图片编码：缩放 + 重编码 + blurhash。
 * Worker 与主线程兜底共用同一份实现，避免两条代码路径行为不一致。
 */

export interface EncodeOptions {
  maxEdge: number;
  quality: number;
  mime: string;
}

export interface EncodedImage {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  blurhash: string | null;
  sizeBytes: number;
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx2D = CanvasRenderingContext2D;

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  return el;
}

function context2d(canvas: AnyCanvas): Ctx2D {
  return canvas.getContext("2d") as unknown as Ctx2D;
}

function canvasToBlob(canvas: AnyCanvas, mime: string, quality: number): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: mime, quality });
  }
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("画布导出失败"))),
      mime,
      quality,
    );
  });
}

function computeBlurhash(source: CanvasImageSource, ratio: number): string | null {
  const width = 32;
  const height = Math.max(1, Math.round(width * ratio));
  try {
    const canvas = createCanvas(width, height);
    const ctx = context2d(canvas);
    ctx.drawImage(source, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    return blurhashEncode(new Uint8ClampedArray(data), width, height, 4, 3);
  } catch {
    return null;
  }
}

export async function encodeImage(source: ImageBitmap, opts: EncodeOptions): Promise<EncodedImage> {
  const scale = Math.min(1, opts.maxEdge / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const ratio = height / width;

  const blurhash = computeBlurhash(source as CanvasImageSource, ratio);

  const canvas = createCanvas(width, height);
  const ctx = context2d(canvas);
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);

  let blob = await canvasToBlob(canvas, opts.mime, opts.quality);
  let quality = opts.quality;

  // 单图上限 5MB：仍超限时逐级降质量，最多两轮
  for (let i = 0; i < 2 && blob.size > 5 * 1024 * 1024; i += 1) {
    quality = Math.max(0.4, quality - 0.2);
    blob = await canvasToBlob(canvas, opts.mime, quality);
  }

  return { blob, mime: opts.mime, width, height, blurhash, sizeBytes: blob.size };
}
