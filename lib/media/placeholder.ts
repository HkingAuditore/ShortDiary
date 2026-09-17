import { decode as blurhashDecode } from "blurhash";

/**
 * blurhash → 极小 data URL，用作图片占位。
 * 结果按 hash 缓存：同一张图在滚动中反复出现只解码一次。
 */

const cache = new Map<string, string>();

export function blurhashToDataUrl(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const hit = cache.get(hash);
  if (hit !== undefined) return hit;

  try {
    const width = 32;
    const height = 32;
    const pixels = blurhashDecode(hash, width, height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    const url = canvas.toDataURL("image/webp", 0.6);
    cache.set(hash, url);
    return url;
  } catch {
    return null;
  }
}
