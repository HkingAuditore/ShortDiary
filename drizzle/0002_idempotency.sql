-- 0002_idempotency：写接口的幂等记录（Idempotency-Key 头）
CREATE TABLE IF NOT EXISTS idempotency_records (
  key           text PRIMARY KEY,
  response_json jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_idem_created ON idempotency_records (created_at);
