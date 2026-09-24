-- ============================================
-- schema.sql - Cloudflare D1 (SQLite)
-- Chuyển đổi từ 10 Mongoose model gốc trong backend/models
-- ============================================

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  avatar TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',           -- 'user' | 'admin'
  is_verified INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  plan_name TEXT,                               -- '1month' | '2month' | NULL
  plan_expires_at TEXT,
  google_id TEXT,
  token_version INTEGER NOT NULL DEFAULT 0,
  referral_code TEXT UNIQUE,
  referred_by TEXT REFERENCES users(id),
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS otps (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  otp TEXT NOT NULL,
  type TEXT NOT NULL,                           -- 'register' | 'reset'
  pending_username TEXT,
  pending_email TEXT,
  pending_password_hash TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_otps_email_type ON otps(email, type);

CREATE TABLE IF NOT EXISTS boxes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  box_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',        -- 'active' | 'paused'
  anti_spam INTEGER NOT NULL DEFAULT 1,
  auto_kick INTEGER NOT NULL DEFAULT 0,
  warn_before_kick INTEGER NOT NULL DEFAULT 1,
  banned_keywords TEXT NOT NULL DEFAULT '[]',   -- JSON array string
  messages_processed INTEGER NOT NULL DEFAULT 0,
  members_kicked INTEGER NOT NULL DEFAULT 0,
  spam_blocked INTEGER NOT NULL DEFAULT 0,
  warnings_issued INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_boxes_owner ON boxes(owner_id);

CREATE TABLE IF NOT EXISTS box_logs (
  id TEXT PRIMARY KEY,
  box_id TEXT NOT NULL REFERENCES boxes(id),
  type TEXT NOT NULL,                           -- 'kick' | 'spam' | 'warn' | 'info'
  message TEXT NOT NULL,
  target_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_boxlogs_box_created ON box_logs(box_id, created_at DESC);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES users(id),
  player_name TEXT NOT NULL,
  kill INTEGER NOT NULL DEFAULT 0,
  top INTEGER NOT NULL DEFAULT 99,
  damage REAL NOT NULL DEFAULT 0,
  score REAL NOT NULL,
  season TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_matches_player ON matches(player_name);
CREATE INDEX IF NOT EXISTS idx_matches_created ON matches(created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT 'all',           -- 'all' | 'active' | 'expired'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_reads (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(notification_id, user_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  plan_name TEXT NOT NULL,
  amount REAL NOT NULL,
  original_amount REAL NOT NULL,
  voucher_code TEXT,
  transaction_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',       -- 'pending' | 'paid' | 'failed'
  method TEXT NOT NULL DEFAULT 'momo',          -- 'momo' | 'banking'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);

CREATE TABLE IF NOT EXISTS vouchers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,                           -- 'percent' | 'fixed'
  value REAL NOT NULL,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  excerpt TEXT DEFAULT '',
  content TEXT NOT NULL,
  cover_image TEXT DEFAULT '',
  author_id TEXT REFERENCES users(id),
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT DEFAULT '',
  message TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
