-- FMEA Automation — Local PostgreSQL Schema
-- Run: psql -U postgres -d fmea_db -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Projects ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT,
  vehicle_model TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sw_units (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safety_goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sg_id       TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  asil        TEXT CHECK (asil IN ('QM','A','B','C','D')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safety_mechanisms (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sm_id               TEXT NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  type                TEXT CHECK (type IN ('Preventive','Detection','Both')),
  diagnostic_coverage TEXT CHECK (diagnostic_coverage IN ('Low','Medium','High','N/A')),
  related_sg_id       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fmea_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sw_unit_id           UUID REFERENCES sw_units(id) ON DELETE SET NULL,
  item_no              TEXT,
  category             TEXT CHECK (category IN ('External','Internal')),
  variable_name        TEXT NOT NULL,
  variable_type        TEXT,
  failure_mode         TEXT CHECK (failure_mode IN ('MORE','LESS','CORRUPT','EARLY','LATE','STUCK','ERRATIC','N/A')),
  failure_detail       TEXT,
  effect_module        TEXT,
  effect_system        TEXT,
  effect_safety_goal   TEXT,
  severity             INT CHECK (severity BETWEEN 1 AND 10),
  occurrence           INT CHECK (occurrence BETWEEN 1 AND 10),
  detection            INT CHECK (detection BETWEEN 1 AND 10),
  rpn                  INT GENERATED ALWAYS AS (
                         CASE WHEN severity IS NOT NULL AND occurrence IS NOT NULL AND detection IS NOT NULL
                              THEN severity * occurrence * detection ELSE NULL END
                       ) STORED,
  preventive_action    TEXT,
  detection_action     TEXT,
  cm_required          BOOLEAN,
  countermeasure       TEXT,
  signal_range         TEXT,
  potential_cause      TEXT,
  test_method          TEXT,
  safety_mechanism_text TEXT,
  severity_after       INT,
  occurrence_after     INT,
  detection_after      INT,
  rpn_after            INT GENERATED ALWAYS AS (
                         CASE WHEN severity_after IS NOT NULL AND occurrence_after IS NOT NULL AND detection_after IS NOT NULL
                              THEN severity_after * occurrence_after * detection_after ELSE NULL END
                       ) STORED,
  target_date          TEXT,
  responsibility       TEXT,
  reference_result     TEXT,
  finish_date          TEXT,
  safety_goal_id       UUID REFERENCES safety_goals(id) ON DELETE SET NULL,
  safety_mechanism_id  UUID REFERENCES safety_mechanisms(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved')),
  ai_generated         BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Pre-FMEA ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pre_fmea_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  item_name            TEXT NOT NULL DEFAULT 'SBW',
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generated','reviewed','upgraded')),
  doc_version          INT NOT NULL DEFAULT 1,
  reference_project_id UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pre_fmea_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES pre_fmea_sessions(id) ON DELETE CASCADE,
  doc_type     TEXT NOT NULL CHECK (doc_type IN ('fmea_template','design_spec','human_fmea','architecture','dbc_file','system_fmea','icd_file')),
  filename     TEXT NOT NULL,
  storage_path TEXT,
  parsed_text  TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pre_fmea_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         UUID NOT NULL REFERENCES pre_fmea_sessions(id) ON DELETE CASCADE,
  item_no            TEXT,
  sw_component       TEXT,
  function_name      TEXT,
  failure_mode       TEXT,
  failure_detail     TEXT,
  effect_local       TEXT,
  effect_system      TEXT,
  effect_sg          TEXT,
  potential_cause    TEXT,
  severity           INT CHECK (severity BETWEEN 1 AND 10),
  occurrence         INT CHECK (occurrence BETWEEN 1 AND 10),
  detection          INT CHECK (detection BETWEEN 1 AND 10),
  rpn                INT GENERATED ALWAYS AS (
                       CASE WHEN severity IS NOT NULL AND occurrence IS NOT NULL AND detection IS NOT NULL
                            THEN severity * occurrence * detection ELSE NULL END
                     ) STORED,
  preventive_action  TEXT,
  detection_action   TEXT,
  confidence_score   FLOAT CHECK (confidence_score BETWEEN 0 AND 1),
  source             TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai','icd','human','merged')),
  review_status      TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','accepted','rejected','modified')),
  human_override     JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pre_fmea_gaps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES pre_fmea_sessions(id) ON DELETE CASCADE,
  gap_type     TEXT NOT NULL CHECK (gap_type IN ('missing_item','wrong_sod','missing_cause','wrong_effect','missing_action')),
  field_name   TEXT,
  ai_value     TEXT,
  human_value  TEXT,
  sw_component TEXT,
  failure_mode TEXT,
  severity     INT,
  lesson       TEXT,
  applied      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fmea_items_project  ON fmea_items(project_id);
CREATE INDEX IF NOT EXISTS idx_fmea_items_unit     ON fmea_items(sw_unit_id);
CREATE INDEX IF NOT EXISTS idx_pre_fmea_docs_sess  ON pre_fmea_documents(session_id);
CREATE INDEX IF NOT EXISTS idx_pre_fmea_items_sess ON pre_fmea_items(session_id);
