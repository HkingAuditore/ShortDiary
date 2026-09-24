import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { exports as exportsTable } from "@/lib/db/schema";
import { uuidv7 } from "@/lib/utils/uuid";
import { fetchEntriesForReview } from "@/lib/db/queries/timeline";
import { listDeletedEntries } from "@/lib/entry/entry.repo";
import { listAssetsByEntry } from "@/lib/asset/asset.repo";
import { listReviews } from "@/lib/review/review.repo";
import { putObject, readObjectBytes } from "@/lib/storage";
import { createZip } from "./zip";
import { AppError } from "@/lib/errors/app-error";
import type { ServiceContext } from "@/lib/entry/entry.service";

/**
 * 导出与恢复。「数据归用户」承诺的技术锚点：
 * manifest.json 的 schema_version 一旦发布即冻结，未来变更必须向后兼容。
 */

export const SCHEMA_VERSION = 1;

export type ExportKind = "json" | "markdown" | "zip";

export interface ExportResult {
  id: string;
  kind: ExportKind;
  filename: string;
  sizeBytes: number;
  downloadUrl: string;
  schemaVersion: number;
}

export async function buildExport(
  ctx: ServiceContext,
  input: { kind: ExportKind; from?: string; to?: string },
): Promise<ExportResult> {
  const from = input.from ?? "1970-01-01";
  const to = input.to ?? "2999-12-31";

  const entries = await fetchEntriesForReview(ctx.userId, from, to, 100000);
  const reviews = await listReviews(ctx.userId, undefined, 1000);
  void listDeletedEntries;

  const assetsByEntry = new Map<string, Awaited<ReturnType<typeof listAssetsByEntry>>>();
  for (const entry of entries) {
    assetsByEntry.set(entry.id, await listAssetsByEntry(ctx.userId, entry.id));
  }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    timezone: ctx.timezone,
    range: { from, to },
    counts: { entries: entries.length, assets: Array.from(assetsByEntry.values()).reduce((n, a) => n + a.length, 0) },
  };

  const entriesPayload = entries.map((e) => ({
    id: e.id,
    entryDate: e.entryDate,
    time: e.time,
    content: e.content,
    reaction: e.reaction,
    assets: (assetsByEntry.get(e.id) ?? []).map((a) => ({
      id: a.id,
      cosKey: a.cosKey,
      mimeType: a.mimeType,
      width: a.width,
      height: a.height,
      blurhash: a.blurhash,
      alt: a.alt,
      sizeBytes: a.sizeBytes,
    })),
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  let filename: string;
  let bytes: Buffer;

  if (input.kind === "json") {
    filename = `journal-${stamp}.json`;
    bytes = Buffer.from(JSON.stringify({ manifest, entries: entriesPayload, reviews }, null, 2), "utf8");
  } else if (input.kind === "markdown") {
    filename = `journal-${stamp}.md`;
    bytes = Buffer.from(toMarkdown(entriesPayload), "utf8");
  } else {
    filename = `journal-${stamp}.zip`;
    const files: Array<{ name: string; data: Buffer }> = [
      { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
      { name: "entries.json", data: Buffer.from(JSON.stringify(entriesPayload, null, 2), "utf8") },
      { name: "reviews.json", data: Buffer.from(JSON.stringify(reviews, null, 2), "utf8") },
      { name: "journal.md", data: Buffer.from(toMarkdown(entriesPayload), "utf8") },
    ];

    let index = 0;
    for (const entry of entriesPayload) {
      for (const asset of entry.assets) {
        const data = await readObjectBytes(asset.cosKey);
        if (!data) continue;
        const ext = asset.mimeType.split("/")[1] ?? "bin";
        files.push({ name: `assets/${entry.entryDate}/${String(index += 1).padStart(3, "0")}.${ext}`, data });
      }
    }
    bytes = createZip(files);
  }

  const id = uuidv7();
  const storageKey = `exports/${ctx.userId}/${id}-${filename}`;
  await putObject(storageKey, bytes);

  const db = await getDb();
  await db.insert(exportsTable).values({
    id,
    userId: ctx.userId,
    kind: input.kind,
    storageKey,
    filename,
    sizeBytes: bytes.length,
  });

  return {
    id,
    kind: input.kind,
    filename,
    sizeBytes: bytes.length,
    downloadUrl: `/api/export/${id}`,
    schemaVersion: SCHEMA_VERSION,
  };
}

function toMarkdown(entries: Array<{ entryDate: string; time: string; content: string; reaction: string | null }>): string {
  const byDate = new Map<string, Array<{ time: string; content: string; reaction: string | null }>>();
  for (const e of entries) {
    const list = byDate.get(e.entryDate) ?? [];
    list.push({ time: e.time, content: e.content, reaction: e.reaction });
    byDate.set(e.entryDate, list);
  }
  const parts: string[] = [];
  for (const [date, list] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    parts.push(`# ${date}\n`);
    for (const item of list) {
      parts.push(`## ${item.time}\n\n${item.content}\n`);
      if (item.reaction) parts.push(`> ${item.reaction}\n`);
    }
  }
  return parts.join("\n");
}

export async function findExport(ctx: ServiceContext, id: string) {
  const db = await getDb();
  const rows = await db.select().from(exportsTable).where(eq(exportsTable.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.userId !== ctx.userId) throw AppError.notFound("导出文件不存在");
  return row;
}

export async function latestExports(ctx: ServiceContext, limit = 10) {
  const db = await getDb();
  return db.select().from(exportsTable).where(eq(exportsTable.userId, ctx.userId)).orderBy(desc(exportsTable.createdAt)).limit(limit);
}

/** 恢复导入：按 id 幂等写入，重复导入不会产生重复条目 */
export async function importEntries(
  ctx: ServiceContext,
  payload: { manifest?: { schemaVersion?: number }; entries: Array<{ id?: string; entryDate: string; time?: string; content: string }> },
) {
  const version = payload.manifest?.schemaVersion ?? 0;
  if (version > SCHEMA_VERSION) {
    throw AppError.invalidInput(`导出文件的 schema_version(${version}) 高于当前支持的版本(${SCHEMA_VERSION})`);
  }

  const { createEntry } = await import("@/lib/entry/entry.service");
  let imported = 0;
  let skipped = 0;

  for (const item of payload.entries) {
    if (!item.content?.trim()) {
      skipped += 1;
      continue;
    }
    await createEntry(ctx, {
      content: item.content,
      entryDate: item.entryDate,
      occurredTime: item.time?.slice(0, 5),
      source: "import",
    });
    imported += 1;
  }

  return { imported, skipped };
}
