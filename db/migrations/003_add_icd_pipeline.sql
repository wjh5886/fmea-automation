-- Migration 003: ICD pipeline — icd_file doc_type + icd_variables table
-- Run: psql -U postgres -d fmea_db -f db/migrations/003_add_icd_pipeline.sql

-- 1. Expand doc_type constraint to include icd_file
ALTER TABLE pre_fmea_documents
  DROP CONSTRAINT IF EXISTS pre_fmea_documents_doc_type_check;

ALTER TABLE pre_fmea_documents
  ADD CONSTRAINT pre_fmea_documents_doc_type_check
  CHECK (doc_type IN ('fmea_template','design_spec','human_fmea','architecture','dbc_file','icd_file'));

-- 2. ICD interface variables table (parsed from ICD Excel)
CREATE TABLE IF NOT EXISTS pre_fmea_icd_variables (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES pre_fmea_sessions(id) ON DELETE CASCADE,
  sw_component  TEXT,
  variable_name TEXT NOT NULL,
  variable_type TEXT,    -- Input / Output / Internal / InOut
  direction     TEXT,    -- Send / Receive (alias for direction)
  data_type     TEXT,    -- uint8, bool, float32, etc.
  signal_range  TEXT,    -- e.g. "0~7", "0.0~1.0"
  unit          TEXT,    -- e.g. "rpm", "deg", "%"
  description   TEXT,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_icd_vars_session ON pre_fmea_icd_variables(session_id);
CREATE INDEX IF NOT EXISTS idx_icd_vars_comp    ON pre_fmea_icd_variables(session_id, sw_component);
