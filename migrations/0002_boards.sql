CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  scene_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_boards_folder_updated ON boards(folder_id, updated_at DESC);

ALTER TABLE sync_ops RENAME TO sync_ops_v1;
CREATE TABLE sync_ops (
  op_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  entity TEXT NOT NULL CHECK (entity IN ('folder', 'note', 'board')),
  entity_id TEXT NOT NULL,
  accepted_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO sync_ops (op_id, device_id, entity, entity_id, accepted_revision, created_at)
SELECT op_id, device_id, entity, entity_id, accepted_revision, created_at FROM sync_ops_v1;
DROP TABLE sync_ops_v1;

ALTER TABLE change_log RENAME TO change_log_v1;
CREATE TABLE change_log (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL CHECK (entity IN ('folder', 'note', 'board')),
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO change_log (sequence, entity, entity_id, revision, updated_at)
SELECT sequence, entity, entity_id, revision, updated_at FROM change_log_v1;
DROP TABLE change_log_v1;
CREATE INDEX idx_change_log_sequence ON change_log(sequence);
