-- One row per household; the whole household document is stored as JSON (a few KB).
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  doc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
