PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  account_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  scratch_username TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '🙂',
  bio TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'ja',
  theme TEXT NOT NULL DEFAULT 'black',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_codes (
  id TEXT PRIMARY KEY,
  account_name TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_codes_account ON login_codes(account_name);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
