-- 0001_init：初始 schema（对应实施计划 §4）
-- 约定：主键 UUIDv7（应用层生成，时间有序）；时间字段统一 timestamptz（UTC 存储）；
--       所有业务表必带 user_id，所有查询强制带 user_id（多用户隔离预留）。

-- 中文关键词检索：pg_trgm 的 trigram 对 2~4 字中文词效果可接受，
-- 优于无中文分词器时 tsvector/simple 的单字切分。
-- 运行环境不支持时静默降级为 ILIKE（见下方 GIN 索引的条件创建）。
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm 不可用，检索将降级为 ILIKE：%', SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY,
  login_id      text UNIQUE NOT NULL,
  email         text UNIQUE,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  timezone      text NOT NULL DEFAULT 'Asia/Shanghai',
  preferences   jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entries (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content      text NOT NULL,
  content_hash text NOT NULL,
  entry_date   date NOT NULL,
  occurred_at  timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  starred      boolean NOT NULL DEFAULT false,
  source       text NOT NULL DEFAULT 'web',
  ai_status    text NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_entries_timeline
  ON entries (user_id, entry_date DESC, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_entries_range
  ON entries (user_id, entry_date) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_entries_starred
  ON entries (user_id, entry_date DESC) WHERE starred AND deleted_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_entries_content_trgm
      ON entries USING gin (content gin_trgm_ops);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS assets (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id    uuid REFERENCES entries(id) ON DELETE CASCADE,
  cos_key     text NOT NULL UNIQUE,
  mime_type   text NOT NULL,
  width       int  NOT NULL,
  height      int  NOT NULL,
  size_bytes  int  NOT NULL,
  blurhash    text,
  alt         text,
  sort_order  smallint NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_assets_entry ON assets (entry_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_assets_gc    ON assets (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_assets_user  ON assets (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tags (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color_token text NOT NULL DEFAULT 'sage',
  source      text NOT NULL DEFAULT 'manual',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tags_user_name ON tags (user_id, name);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id   uuid NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
  source   text NOT NULL DEFAULT 'manual',
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags (tag_id, entry_id);

CREATE TABLE IF NOT EXISTS ai_providers (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  protocol      text NOT NULL,
  base_url      text NOT NULL,
  encrypted_key text NOT NULL,
  key_iv        text NOT NULL,
  key_tag       text NOT NULL,
  key_hint      text NOT NULL,
  capabilities  jsonb NOT NULL DEFAULT '{}',
  is_default    boolean NOT NULL DEFAULT false,
  last_test_at  timestamptz,
  last_test_ok  boolean,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_providers_user ON ai_providers (user_id, is_default DESC);

CREATE TABLE IF NOT EXISTS ai_models (
  id          uuid PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  role        text NOT NULL,
  model_name  text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_models_provider_role ON ai_models (provider_id, role);

CREATE TABLE IF NOT EXISTS ai_annotations (
  id             uuid PRIMARY KEY,
  entry_id       uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  type           text NOT NULL,
  content_json   jsonb NOT NULL,
  provider_id    uuid REFERENCES ai_providers(id) ON DELETE SET NULL,
  model          text NOT NULL,
  prompt_version text NOT NULL,
  input_hash     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ann_entry ON ai_annotations (entry_id);
CREATE INDEX IF NOT EXISTS idx_ann_cache ON ai_annotations (input_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ann_entry_type ON ai_annotations (entry_id, type, prompt_version);

CREATE TABLE IF NOT EXISTS reviews (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           text NOT NULL,
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  content_json   jsonb NOT NULL DEFAULT '{}',
  provider_id    uuid REFERENCES ai_providers(id) ON DELETE SET NULL,
  model          text NOT NULL DEFAULT '',
  prompt_version text NOT NULL,
  status         text NOT NULL DEFAULT 'pending',
  generated_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_list ON reviews (user_id, type, start_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_reviews_idem ON reviews (user_id, type, start_date, prompt_version);

CREATE TABLE IF NOT EXISTS ai_usage (
  id                uuid PRIMARY KEY,
  user_id           uuid NOT NULL,
  provider_id       uuid,
  model             text NOT NULL,
  task              text NOT NULL,
  prompt_tokens     int NOT NULL DEFAULT 0,
  completion_tokens int NOT NULL DEFAULT 0,
  latency_ms        int NOT NULL DEFAULT 0,
  cached            boolean NOT NULL DEFAULT false,
  ok                boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON ai_usage (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id               uuid PRIMARY KEY,
  type             text NOT NULL,
  payload          jsonb NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'queued',
  attempts         int NOT NULL DEFAULT 0,
  max_attempts     int NOT NULL DEFAULT 3,
  run_after        timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_pickup ON jobs (status, run_after) WHERE status IN ('queued','running');

-- updated_at 统一由触发器维护
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','entries','assets','tags','ai_providers','ai_annotations','reviews','ai_usage','jobs']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END $$;
