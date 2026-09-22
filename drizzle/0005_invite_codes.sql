-- 0005_invite_codes：邀请码注册
-- 一码一人：used_by 置位即失效；注册接口在事务里 SELECT ... FOR UPDATE 抢码，
-- 并发提交同一个码时只有一个事务能成功。

CREATE TABLE IF NOT EXISTS invite_codes (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  used_by uuid REFERENCES users(id) ON DELETE SET NULL,
  used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS trg_invite_codes_updated_at ON invite_codes';
  EXECUTE 'CREATE TRIGGER trg_invite_codes_updated_at BEFORE UPDATE ON invite_codes FOR EACH ROW EXECUTE FUNCTION set_updated_at()';
END $$;

CREATE INDEX IF NOT EXISTS idx_invite_codes_unused ON invite_codes (code) WHERE used_by IS NULL;
