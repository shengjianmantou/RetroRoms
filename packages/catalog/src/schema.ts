export const CURRENT_SCHEMA_VERSION = 1;

export const SCHEMA_V1 = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS library (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  library_uuid TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roots (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('source', 'processed')),
  path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(kind, path)
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  warning_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS content_observations (
  id TEXT PRIMARY KEY,
  scan_run_id TEXT NOT NULL REFERENCES scan_runs(id),
  root_id TEXT NOT NULL REFERENCES roots(id),
  relative_path TEXT NOT NULL,
  virtual_path TEXT NOT NULL,
  container_chain_json TEXT NOT NULL DEFAULT '[]',
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  crc32 TEXT NOT NULL,
  sha1 TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  UNIQUE(root_id, virtual_path, sha256)
);

CREATE INDEX IF NOT EXISTS observation_sha1_idx ON content_observations(sha1);
CREATE INDEX IF NOT EXISTS observation_sha256_idx ON content_observations(sha256);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  canonical_title TEXT NOT NULL,
  sort_title TEXT NOT NULL,
  series_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS editions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id),
  system_key TEXT NOT NULL,
  region TEXT,
  languages_json TEXT NOT NULL DEFAULT '[]',
  revision TEXT,
  identity_source TEXT NOT NULL CHECK (identity_source IN ('dat', 'serial', 'hash', 'filename', 'user')),
  preferred INTEGER NOT NULL DEFAULT 0 CHECK (preferred IN (0, 1)),
  UNIQUE(game_id, system_key, region, languages_json, revision)
);

CREATE TABLE IF NOT EXISTS edition_content (
  edition_id TEXT NOT NULL REFERENCES editions(id),
  sha256 TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'rom',
  PRIMARY KEY(edition_id, sha256, role)
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id),
  processed_root_id TEXT NOT NULL REFERENCES roots(id),
  relative_path TEXT NOT NULL,
  output_policy TEXT NOT NULL CHECK (output_policy IN ('auto', 'compressed', 'uncompressed', 'preserve')),
  package_format TEXT NOT NULL,
  package_sha256 TEXT NOT NULL,
  content_manifest_json TEXT NOT NULL,
  exported_at TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  UNIQUE(processed_root_id, relative_path)
);
`;

