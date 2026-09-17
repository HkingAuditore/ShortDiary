-- 0003_exports：导出包记录
CREATE TABLE IF NOT EXISTS exports (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,        -- json | markdown | zip
  storage_key text NOT NULL,
  filename    text NOT NULL,
  size_bytes  int  NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exports_user ON exports (user_id, created_at DESC);
