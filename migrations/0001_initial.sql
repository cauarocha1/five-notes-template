CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS sync_ops (
  op_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  entity TEXT NOT NULL CHECK (entity IN ('folder', 'note')),
  entity_id TEXT NOT NULL,
  accepted_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS change_log (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL CHECK (entity IN ('folder', 'note')),
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_notes_folder_updated ON notes(folder_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_log_sequence ON change_log(sequence);
