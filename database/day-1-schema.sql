-- PARABLE Day 1 foundation schema
-- PostgreSQL

CREATE TYPE project_status AS ENUM ('draft','story_bible','episode_plan','production','complete');
CREATE TYPE audience_scope AS ENUM ('global','regional','local');
CREATE TYPE story_period AS ENUM ('present','historical','future');
CREATE TYPE context_type AS ENUM ('audience','culture','location','organization','time');
CREATE TYPE context_status AS ENUM ('planned','researching','ready','stale');
CREATE TYPE engine_type AS ENUM ('story','film','culture','location','audio','render','learning');
CREATE TYPE engine_status AS ENUM ('foundation','mapped','active','paused');

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  logline TEXT,
  source_text TEXT,
  setting TEXT,
  primary_audience TEXT,
  audience_scope audience_scope NOT NULL DEFAULT 'global',
  story_period story_period NOT NULL DEFAULT 'present',
  status project_status NOT NULL DEFAULT 'draft',
  progress INTEGER NOT NULL DEFAULT 5 CHECK (progress BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_contexts (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  context_type context_type NOT NULL,
  label TEXT NOT NULL,
  scope_value TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  status context_status NOT NULL DEFAULT 'planned',
  last_refreshed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE engine_modules (
  engine_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  engine_type engine_type NOT NULL,
  status engine_status NOT NULL DEFAULT 'foundation',
  version TEXT NOT NULL DEFAULT '0.1.0',
  capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  implementation_notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO engine_modules (engine_key, display_name, engine_type, status) VALUES
  ('story-intelligence','Story Intelligence','story','foundation'),
  ('film-intelligence','Film Intelligence','film','mapped'),
  ('cultural-intelligence','Cultural Intelligence','culture','mapped'),
  ('location-grounding','Location Grounding','location','mapped'),
  ('performance-audio','Performance / Audio','audio','mapped'),
  ('model-router','Model Router','render','mapped'),
  ('continual-learning','Continual Learning','learning','mapped');
