-- Yönetici sistemi şeması (Cloudflare D1).
-- Uygulama bu ifadeleri her izolatta bir kez kendisi çalıştırır
-- (app/lib/admin-db.ts). Bu dosya elle kurulum ve gözden geçirme içindir:
--   npx wrangler d1 execute <veritabani> --file=migrations/0001_admin.sql

CREATE TABLE IF NOT EXISTS admin_accounts (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role_code TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  created_by TEXT,
  revoked_at TEXT,
  revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_accounts_role ON admin_accounts (role_code, status);

-- Gönderilen ve gönderilmeyi bekleyen bildirimler. Gövdede şifre maskelidir.
CREATE TABLE IF NOT EXISTS admin_mail_outbox (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_mail_created ON admin_mail_outbox (created_at DESC);

-- Oturumlar: yalnizca jeton ozeti saklanir, ham jeton hicbir yerde tutulmaz.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_account ON admin_sessions (account_id);

-- Denetim izi: parola, oturum jetonu veya API anahtari yazilmaz.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_email TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log (created_at DESC);
