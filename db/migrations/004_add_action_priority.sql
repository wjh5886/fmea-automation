-- Migration 004: action_priority 컬럼 추가
-- Run: psql -U postgres -d fmea_db -f db/migrations/004_add_action_priority.sql

ALTER TABLE pre_fmea_items
  ADD COLUMN IF NOT EXISTS action_priority TEXT
  CHECK (action_priority IN ('VH','H','M','L'));

-- 기존 항목 중 S/O/D가 모두 있는 것은 즉시 계산
-- (애플리케이션에서 recalc API 호출로도 가능하지만 마이그레이션 시 일괄 처리)
UPDATE pre_fmea_items
SET action_priority = CASE
  -- S 9-10
  WHEN severity >= 9 AND occurrence >= 6                              THEN 'VH'
  WHEN severity >= 9 AND occurrence >= 4 AND detection >= 6           THEN 'VH'
  WHEN severity >= 9 AND occurrence >= 4 AND detection < 6            THEN 'H'
  WHEN severity >= 9 AND occurrence >= 2 AND detection >= 6           THEN 'H'
  WHEN severity >= 9 AND occurrence >= 2 AND detection < 6            THEN 'M'
  WHEN severity >= 9 AND occurrence < 2                               THEN 'L'
  -- S 7-8
  WHEN severity >= 7 AND occurrence >= 6 AND detection >= 6           THEN 'VH'
  WHEN severity >= 7 AND occurrence >= 6 AND detection < 6            THEN 'H'
  WHEN severity >= 7 AND occurrence >= 4 AND detection >= 6           THEN 'H'
  WHEN severity >= 7 AND occurrence >= 4 AND detection < 6            THEN 'M'
  WHEN severity >= 7 AND occurrence >= 2 AND detection >= 6           THEN 'M'
  WHEN severity >= 7 AND occurrence >= 2 AND detection < 6            THEN 'L'
  WHEN severity >= 7 AND occurrence < 2                               THEN 'L'
  -- S 5-6
  WHEN severity >= 5 AND occurrence >= 6 AND detection >= 6           THEN 'H'
  WHEN severity >= 5 AND occurrence >= 6 AND detection < 6            THEN 'M'
  WHEN severity >= 5 AND occurrence >= 4 AND detection >= 6           THEN 'M'
  WHEN severity >= 5 AND occurrence >= 4 AND detection < 6            THEN 'L'
  WHEN severity >= 5 AND occurrence < 4                               THEN 'L'
  -- S 1-4
  ELSE 'L'
END
WHERE severity IS NOT NULL AND occurrence IS NOT NULL AND detection IS NOT NULL;
