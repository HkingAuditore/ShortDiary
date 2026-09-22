import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** 触发器统一维护 updated_at，避免每个 repo 都记得写 */
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  loginId: text("login_id").notNull().unique(),
  email: text("email").unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  preferences: jsonb("preferences").$type<UserPreferences>().notNull().default({}),
  ...timestamps,
});

export interface UserPreferences {
  defaultHome?: "timeline" | "today";
  privacyMode?: boolean;
  moodAnalysis?: boolean;
  simpleMode?: boolean;
  autoAnnotate?: boolean;
}

/** 邀请码：一码一人，used_by 置位即失效（对应迁移 0005） */
export const inviteCodes = pgTable("invite_codes", {
  id: uuid("id").primaryKey(),
  code: text("code").notNull().unique(),
  /** 生成者（审计用） */
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  /** 使用者；非空即已消耗 */
  usedBy: uuid("used_by").references(() => users.id, { onDelete: "set null" }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  ...timestamps,
});

export const entries = pgTable(
  "entries",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    /** sha256(content)：AI 缓存键与去重依据 */
    contentHash: text("content_hash").notNull(),
    /** 「属于哪一天」（用户时区） */
    entryDate: date("entry_date").notNull(),
    /** 用户声明的发生时刻（可补记） */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    starred: boolean("starred").notNull().default(false),
    source: text("source").notNull().default("web"),
    aiStatus: text("ai_status").notNull().default("pending"),
  },
  (t) => [
    // 时间线主查询：按用户 + 日期倒序游标翻页（部分索引缩小体积）
    index("idx_entries_timeline")
      .on(t.userId, t.entryDate.desc(), t.createdAt.desc(), t.id.desc())
      .where(sql`deleted_at IS NULL`),
    index("idx_entries_range").on(t.userId, t.entryDate).where(sql`deleted_at IS NULL`),
    index("idx_entries_starred")
      .on(t.userId, t.entryDate.desc())
      .where(sql`starred AND deleted_at IS NULL`),
    index("idx_entries_content_trgm").using("gin", t.content.op("gin_trgm_ops")),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id").references(() => entries.id, { onDelete: "cascade" }),
    cosKey: text("cos_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    blurhash: text("blurhash"),
    alt: text("alt"),
    sortOrder: smallint("sort_order").notNull().default(0),
    status: text("status").notNull().default("pending"),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_assets_entry").on(t.entryId, t.sortOrder).where(sql`deleted_at IS NULL`),
    index("idx_assets_gc").on(t.createdAt).where(sql`status = 'pending'`),
    index("idx_assets_user").on(t.userId, t.createdAt.desc()),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    colorToken: text("color_token").notNull().default("sage"),
    source: text("source").notNull().default("manual"),
    ...timestamps,
  },
  (t) => [uniqueIndex("uniq_tags_user_name").on(t.userId, t.name)],
);

export const entryTags = pgTable(
  "entry_tags",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("manual"),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.tagId] }), index("idx_entry_tags_tag").on(t.tagId, t.entryId)],
);

export const aiProviders = pgTable(
  "ai_providers",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    protocol: text("protocol").notNull(),
    baseUrl: text("base_url").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    keyIv: text("key_iv").notNull(),
    keyTag: text("key_tag").notNull(),
    keyHint: text("key_hint").notNull(),
    capabilities: jsonb("capabilities").$type<ProviderCapabilities>().notNull().default({}),
    isDefault: boolean("is_default").notNull().default(false),
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    lastTestOk: boolean("last_test_ok"),
    ...timestamps,
  },
  (t) => [index("idx_providers_user").on(t.userId, t.isDefault.desc())],
);

export interface ProviderCapabilities {
  vision?: boolean;
  embedding?: boolean;
  json?: boolean;
  overrides?: ProviderOverrides;
}

export interface ProviderOverrides {
  supportsJsonMode?: boolean;
  supportsSystemRole?: boolean;
  maxContextTokens?: number;
  responseWrapper?: "openai" | "anthropic" | "gemini";
}

export const aiModels = pgTable(
  "ai_models",
  {
    id: uuid("id").primaryKey(),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => aiProviders.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    modelName: text("model_name").notNull(),
  },
  (t) => [uniqueIndex("uniq_models_provider_role").on(t.providerId, t.role)],
);

export const aiAnnotations = pgTable(
  "ai_annotations",
  {
    id: uuid("id").primaryKey(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    type: text("type").notNull(),
    contentJson: jsonb("content_json").notNull(),
    providerId: uuid("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputHash: text("input_hash").notNull(),
    ...timestamps,
  },
  (t) => [
    index("idx_ann_entry").on(t.entryId),
    uniqueIndex("uniq_ann_entry_type").on(t.entryId, t.type, t.promptVersion),
    index("idx_ann_cache").on(t.inputHash),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    contentJson: jsonb("content_json").notNull().default({}),
    providerId: uuid("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
    model: text("model").notNull().default(""),
    promptVersion: text("prompt_version").notNull(),
    status: text("status").notNull().default("pending"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("idx_reviews_list").on(t.userId, t.type, t.startDate.desc()),
    uniqueIndex("uniq_reviews_idem").on(t.userId, t.type, t.startDate, t.promptVersion),
  ],
);

export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  providerId: uuid("provider_id"),
  model: text("model").notNull(),
  task: text("task").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  cached: boolean("cached").notNull().default(false),
  ok: boolean("ok").notNull().default(true),
  ...timestamps,
});

/** V1 任务队列：表结构按 BullMQ 语义设计，后续可平滑替换为 Redis 实现 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [index("idx_jobs_pickup").on(t.status, t.runAfter).where(sql`status IN ('queued','running')`)],
);

export const exports = pgTable(
  "exports",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("idx_exports_user").on(t.userId, t.createdAt.desc())],
);

export type User = typeof users.$inferSelect;
export type Entry = typeof entries.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type AiProvider = typeof aiProviders.$inferSelect;
export type AiModel = typeof aiModels.$inferSelect;
export type AiAnnotation = typeof aiAnnotations.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Job = typeof jobs.$inferSelect;
