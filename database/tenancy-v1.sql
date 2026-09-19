-- PARABLE Tenancy Foundation V1
-- Provider-neutral workspace and authorization schema.
-- This migration is prepared for the transactional production state tier.
-- It does not choose or provision an identity provider by itself.

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  identity_provider TEXT NOT NULL,
  identity_subject TEXT NOT NULL,
  display_name TEXT,
  email_normalized TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (identity_provider, identity_subject)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','reviewer','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS workspace_memberships_user_idx
  ON workspace_memberships (user_id, status);

CREATE TABLE IF NOT EXISTS workspace_projects (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id),
  UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS workspace_projects_workspace_idx
  ON workspace_projects (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_access_audit (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('allowed','denied')),
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_access_audit_lookup_idx
  ON project_access_audit (workspace_id, project_id, created_at DESC);

-- Authorization invariant:
-- every project read/write must resolve:
--   authenticated identity -> app_users -> active workspace membership
--   -> workspace_projects ownership -> permitted role/action.
--
-- Never authorize a project only because a caller knows its project_id.
--
-- Role intent:
-- owner/admin  : workspace administration + all project actions
-- editor       : write story/directing/continuity state
-- reviewer     : read + review/comment/approval actions
-- viewer       : read-only
--
-- This schema is deliberately identity-provider agnostic so PARABLE can
-- change authentication vendors without rewriting project ownership.
