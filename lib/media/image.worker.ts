import { encodeImage, type EncodedImage, type EncodeOptions } from "./encode";

/**
 * 图片处理 Worker：解码 → 缩放 → 重编码 → blurhash。
 * 放在 Worker 是为了不让 20MB 原图的解码在主线程造成掉帧。
 */

export interface ProcessRequest extends EncodeOptions {
  id: string;
  file: File;
}

export type ProcessResponse =
  | { id: string; ok: true; result: EncodedImage }
  | { id: string; ok: false; error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ProcessRequest>) => void) | null;
  postMessage: (message: ProcessResponse) => void;
};

scope.onmessage = async (event: MessageEvent<ProcessRequest>) => {
  const { id, file, maxEdge, quality, mime } = event.data;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const result = await encodeImage(bitmap, { maxEdge, quality, mime });
      scope.postMessage({ id, ok: true, result });
    } finally {
      bitmap.close();
    }
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : "图片处理失败" });
  }
};
