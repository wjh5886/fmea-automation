-- Migration 002: item_name on sessions, new doc_types for generate pipeline
-- Run: psql -U postgres -d fmea_db -f db/migrations/002_add_item_name_and_doc_types.sql

-- 1. Add item_name to sessions (default SBW for existing rows)
ALTER TABLE pre_fmea_sessions
  ADD COLUMN IF NOT EXISTS item_name TEXT NOT NULL DEFAULT 'SBW';

-- 2. Expand doc_type to include architecture and dbc_file
ALTER TABLE pre_fmea_documents
  DROP CONSTRAINT IF EXISTS pre_fmea_documents_doc_type_check;

ALTER TABLE pre_fmea_documents
  ADD CONSTRAINT pre_fmea_documents_doc_type_check
  CHECK (doc_type IN ('fmea_template','design_spec','human_fmea','architecture','dbc_file'));
