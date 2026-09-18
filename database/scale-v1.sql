-- PARABLE Scale Foundation V1
-- PostgreSQL migration for the hot mutable state tier.
-- This is intentionally additive and can be activated when a production
-- transactional database is provisioned. Netlify Blobs remains appropriate
-- for immutable snapshots, assets, claim-check payloads and archives.

CREATE TABLE IF NOT EXISTS project_revisions (
  project_id TEXT PRIMARY KEY,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS continuity_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  story_version TEXT NOT NULL,
  scene_id TEXT,
  shot_id TEXT,
  event_type TEXT NOT NULL,
  parent_revision BIGINT NOT NULL,
  revision BIGINT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, revision)
);

CREATE INDEX IF NOT EXISTS continuity_events_project_story_idx
  ON continuity_events (project_id, story_version, revision DESC);

CREATE INDEX IF NOT EXISTS continuity_events_scene_idx
  ON continuity_events (project_id, story_version, scene_id, revision);

CREATE TABLE IF NOT EXISTS continuity_snapshots (
  project_id TEXT NOT NULL,
  story_version TEXT NOT NULL,
  revision BIGINT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, story_version, revision)
);

CREATE INDEX IF NOT EXISTS continuity_snapshots_latest_idx
  ON continuity_snapshots (project_id, story_version, revision DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved','completed','failed')),
  result_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS durable_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','processing','succeeded','failed')),
  payload_hash TEXT NOT NULL,
  idempotency_key TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  result_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS durable_jobs_project_status_idx
  ON durable_jobs (project_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS durable_jobs_idempotency_idx
  ON durable_jobs (project_id, kind, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Transaction pattern for a continuity mutation:
--
-- BEGIN;
-- INSERT INTO project_revisions(project_id, revision)
-- VALUES ($1, 0)
-- ON CONFLICT (project_id) DO NOTHING;
--
-- SELECT revision
-- FROM project_revisions
-- WHERE project_id = $1
-- FOR UPDATE;
--
-- Compare the selected revision to the caller's expected revision.
-- If they differ, return HTTP 409 and force the caller to reload/rebase.
--
-- INSERT the immutable continuity_events row at revision + 1.
-- INSERT the matching continuity_snapshots row.
-- UPDATE project_revisions SET revision = revision + 1.
-- COMMIT;
--
-- This removes last-write-wins ambiguity for simultaneous editors on one project.
