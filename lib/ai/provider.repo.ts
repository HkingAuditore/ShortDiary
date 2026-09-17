import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { aiModels, aiProviders } from "@/lib/db/schema";
import type { AiModel, AiProvider, ProviderCapabilities } from "@/lib/db/schema";
import type { Protocol } from "./types";
import { uuidv7 } from "@/lib/utils/uuid";
import { decrypt, encrypt, maskSecret } from "@/lib/crypto/envelope";
import { AppError } from "@/lib/errors/app-error";

export interface ProviderView {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  keyHint: string;
  capabilities: ProviderCapabilities;
  isDefault: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  models: Array<{ role: string; modelName: string }>;
}

export interface ProviderWithSecret extends AiProvider {
  apiKey: string;
}

function toView(row: AiProvider, models: AiModel[]): ProviderView {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    baseUrl: row.baseUrl,
    keyHint: row.keyHint,
    capabilities: (row.capabilities ?? {}) as ProviderCapabilities,
    isDefault: row.isDefault,
    lastTestAt: row.lastTestAt ? row.lastTestAt.toISOString() : null,
    lastTestOk: row.lastTestOk,
    models: models
      .filter((m) => m.providerId === row.id)
      .map((m) => ({ role: m.role, modelName: m.modelName })),
  };
}

export async function listProviders(userId: string): Promise<ProviderView[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.userId, userId))
    .orderBy(desc(aiProviders.isDefault), asc(aiProviders.createdAt));

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const models = await db.select().from(aiModels).where(inArray(aiModels.providerId, ids));
  return rows.map((r) => toView(r, models));
}

export async function findProviderWithSecret(userId: string, id: string): Promise<ProviderWithSecret | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(aiProviders)
    .where(and(eq(aiProviders.id, id), eq(aiProviders.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, apiKey: decrypt({ ciphertext: row.encryptedKey, iv: row.keyIv, tag: row.keyTag }) };
}

/** 取默认 Provider；没有显式默认时取第一个 */
export async function findDefaultProvider(userId: string): Promise<ProviderWithSecret | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.userId, userId))
    .orderBy(desc(aiProviders.isDefault), asc(aiProviders.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, apiKey: decrypt({ ciphertext: row.encryptedKey, iv: row.keyIv, tag: row.keyTag }) };
}

export interface CreateProviderInput {
  name: string;
  protocol: string;
  baseUrl: string;
  apiKey: string;
  capabilities?: ProviderCapabilities;
  models: Array<{ role: string; modelName: string }>;
  isDefault?: boolean;
}

export async function createProvider(userId: string, input: CreateProviderInput): Promise<ProviderView> {
  const db = await getDb();
  const id = uuidv7();
  const enc = encrypt(input.apiKey);

  await db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx.update(aiProviders).set({ isDefault: false }).where(eq(aiProviders.userId, userId));
    }
    await tx.insert(aiProviders).values({
      id,
      userId,
      name: input.name,
      protocol: input.protocol,
      baseUrl: input.baseUrl.replace(/\/$/, ""),
      encryptedKey: enc.ciphertext,
      keyIv: enc.iv,
      keyTag: enc.tag,
      keyHint: maskSecret(input.apiKey),
      capabilities: input.capabilities ?? {},
      isDefault: input.isDefault ?? false,
    });
    if (input.models.length > 0) {
      await tx.insert(aiModels).values(input.models.map((m) => ({ id: uuidv7(), providerId: id, role: m.role, modelName: m.modelName })));
    }
  });

  const created = await findProviderWithSecret(userId, id);
  if (!created) throw new AppError("INTERNAL", "创建 Provider 失败");
  const models = await db.select().from(aiModels).where(eq(aiModels.providerId, id));
  return toView(created, models);
}

export async function updateProvider(
  userId: string,
  id: string,
  patch: {
    name?: string;
    protocol?: string;
    baseUrl?: string;
    apiKey?: string;
    capabilities?: ProviderCapabilities;
    models?: Array<{ role: string; modelName: string }>;
    isDefault?: boolean;
  },
): Promise<ProviderView> {
  const db = await getDb();
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.protocol !== undefined) set.protocol = patch.protocol;
  if (patch.baseUrl !== undefined) set.baseUrl = patch.baseUrl.replace(/\/$/, "");
  if (patch.capabilities !== undefined) set.capabilities = patch.capabilities;
  if (patch.apiKey !== undefined) {
    const enc = encrypt(patch.apiKey);
    set.encryptedKey = enc.ciphertext;
    set.keyIv = enc.iv;
    set.keyTag = enc.tag;
    set.keyHint = maskSecret(patch.apiKey);
  }
  if (patch.isDefault !== undefined) set.isDefault = patch.isDefault;

  await db.transaction(async (tx) => {
    if (patch.isDefault) {
      await tx.update(aiProviders).set({ isDefault: false }).where(eq(aiProviders.userId, userId));
    }
    if (Object.keys(set).length > 0) {
      const rows = await tx
        .update(aiProviders)
        .set(set)
        .where(and(eq(aiProviders.id, id), eq(aiProviders.userId, userId)))
        .returning({ id: aiProviders.id });
      if (rows.length === 0) throw new AppError("NOT_FOUND", "Provider 不存在");
    }
    if (patch.models) {
      await tx.delete(aiModels).where(eq(aiModels.providerId, id));
      if (patch.models.length > 0) {
        await tx
          .insert(aiModels)
          .values(patch.models.map((m) => ({ id: uuidv7(), providerId: id, role: m.role, modelName: m.modelName })));
      }
    }
  });

  const row = await findProviderWithSecret(userId, id);
  if (!row) throw new AppError("NOT_FOUND", "Provider 不存在");
  const models = await db.select().from(aiModels).where(eq(aiModels.providerId, id));
  return toView(row, models);
}

export async function deleteProvider(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .delete(aiProviders)
    .where(and(eq(aiProviders.id, id), eq(aiProviders.userId, userId)))
    .returning({ id: aiProviders.id });
  return rows.length > 0;
}

export async function recordTestResult(userId: string, id: string, ok: boolean): Promise<void> {
  const db = await getDb();
  await db
    .update(aiProviders)
    .set({ lastTestAt: new Date(), lastTestOk: ok })
    .where(and(eq(aiProviders.id, id), eq(aiProviders.userId, userId)));
}

export function modelOf(provider: ProviderWithSecret, role: "chat" | "vision" | "embedding", models: AiModel[]): string | null {
  const found = models.find((m) => m.providerId === provider.id && m.role === role);
  return found?.modelName ?? null;
}

export function protocolOf(provider: AiProvider): Protocol {
  const p = provider.protocol as Protocol;
  return p === "anthropic" || p === "gemini" ? p : "openai_compatible";
}
