-- 0004_exports_updated_at：补齐 exports.updated_at
-- 0003 建表时漏了 updated_at，而 schema 里 exports 使用了 timestamps（created_at + updated_at），
-- 导致插入导出记录时报 column "updated_at" does not exist。这里补齐列并挂上统一触发器。

ALTER TABLE exports ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS trg_exports_updated_at ON exports';
  EXECUTE 'CREATE TRIGGER trg_exports_updated_at BEFORE UPDATE ON exports FOR EACH ROW EXECUTE FUNCTION set_updated_at()';
END $$;
