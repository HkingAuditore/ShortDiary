import type { Job } from "@/lib/db/schema";
import { deleteAssets, findOrphanAssets, markAssetsOrphan } from "@/lib/asset/asset.repo";
import { deleteObject } from "@/lib/storage";
import { storageLogger } from "@/lib/obs/logger";

/**
 * 孤儿文件回收：24h 未被任何 Entry 引用的临时对象先标记 orphan 再删除，
 * COS 侧另有生命周期规则兜底。
 */
export async function runGcJob(_job: Job): Promise<void> {
  const orphans = await findOrphanAssets(24, 200);
  if (orphans.length === 0) return;

  await markAssetsOrphan(orphans.map((a) => a.id));

  let removed = 0;
  for (const asset of orphans) {
    try {
      await deleteObject(asset.cosKey);
      removed += 1;
    } catch (err) {
      storageLogger.warn({ err }, "孤儿文件删除失败");
    }
  }
  await deleteAssets(orphans.map((a) => a.id));
  storageLogger.info({ scanned: orphans.length, removed }, "孤儿文件回收完成");
}
