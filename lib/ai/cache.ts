import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { aiAnnotations } from "@/lib/db/schema";
import type { AnnotationOutput } from "./schemas";

/**
 * 内容寻址缓存：hash(prompt_version + model + 内容哈希)。
 * 重生成/重复打开不再重复付费；prompt_version 变更即换新键。
 */

export interface CachedAnnotation {
  content: AnnotationOutput;
  model: string;
  providerId: string | null;
  createdAt: string;
}

export async function findCachedAnnotation(userId: string, inputHash: string): Promise<CachedAnnotation | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(aiAnnotations)
    .where(and(eq(aiAnnotations.userId, userId), eq(aiAnnotations.inputHash, inputHash)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    content: row.contentJson as AnnotationOutput,
    model: row.model,
    providerId: row.providerId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function saveAnnotation(input: {
  entryId: string;
  userId: string;
  type: string;
  content: unknown;
  providerId: string | null;
  model: string;
  promptVersion: string;
  inputHash: string;
}): Promise<void> {
  const db = await getDb();
  await db
    .insert(aiAnnotations)
    .values({
      id: crypto.randomUUID(),
      entryId: input.entryId,
      userId: input.userId,
      type: input.type,
      contentJson: input.content as object,
      providerId: input.providerId,
      model: input.model,
      promptVersion: input.promptVersion,
      inputHash: input.inputHash,
    })
    .onConflictDoUpdate({
      target: [aiAnnotations.entryId, aiAnnotations.type, aiAnnotations.promptVersion],
      set: {
        contentJson: input.content as object,
        providerId: input.providerId,
        model: input.model,
        inputHash: input.inputHash,
      },
    });
}
