import { encodeImage, type EncodedImage, type EncodeOptions } from "./encode";
import type { ProcessRequest, ProcessResponse } from "./image.worker";

/**
 * Worker 门面。Worker 不可用（构建环境不支持 / 浏览器限制）时
 * 自动退化为主线程处理，功能不降级，只是少了一点主线程余量。
 */

export const DEFAULT_ENCODE: EncodeOptions = { maxEdge: 1600, quality: 0.82, mime: "image/webp" };

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;

interface Pending {
  resolve: (value: EncodedImage) => void;
  reject: (err: Error) => void;
}

const pending = new Map<string, Pending>();

function failAll(err: Error) {
  for (const [, p] of pending) p.reject(err);
  pending.clear();
}

function ensureWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;

  try {
    const w = new Worker(new URL("./image.worker.ts", import.meta.url));
    w.onmessage = (event: MessageEvent<ProcessResponse>) => {
      const msg = event.data;
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(new Error(msg.error));
    };
    w.onerror = () => {
      workerBroken = true;
      failAll(new Error("图片处理线程异常"));
    };
    worker = w;
    return w;
  } catch {
    workerBroken = true;
    return null;
  }
}

async function onMainThread(file: File, opts: EncodeOptions): Promise<EncodedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    return await encodeImage(bitmap, opts);
  } finally {
    bitmap.close();
  }
}

export async function processImage(file: File, opts: EncodeOptions = DEFAULT_ENCODE): Promise<EncodedImage> {
  const w = ensureWorker();
  if (!w) return onMainThread(file, opts);

  seq += 1;
  const id = `${Date.now()}-${seq}`;

  return new Promise<EncodedImage>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: ProcessRequest = { id, file, ...opts };
    try {
      w.postMessage(req);
    } catch (err) {
      pending.delete(id);
      workerBroken = true;
      void onMainThread(file, opts).then(resolve, reject);
      void err;
    }
  });
}

export type { EncodedImage, EncodeOptions };
