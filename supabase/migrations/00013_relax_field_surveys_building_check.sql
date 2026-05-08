-- ============================================================
-- Migration: 00013_relax_field_surveys_building_check
-- Order:     13 (Phase B 후속 — 좌표 우선 모드 전환)
-- Purpose:   field_surveys 의 building_ref CHECK 제약 제거.
--
--            기존(00008): building 타입은 building_pnu NOT NULL 강제.
--            변경 사유: 건물 폴리곤 의존을 떼고 어디든 자유 좌표로 조사 가능하게 함.
--                     - VWorld 지도 위 어느 점이든 picker → 건물/도로/점 입력
--                     - building_id / building_pnu 둘 다 NULL 허용
--                     - admin 이 정제 시 좌표/사진으로 매핑 (수동 보강)
--
-- Verification (실행 후):
--   -- (1) 제약 제거됨
--   SELECT conname FROM pg_constraint
--   WHERE conrelid = 'field_surveys'::regclass
--     AND conname = 'field_surveys_building_ref_chk';
--   -- 0 rows
--
--   -- (2) building 타입 + pnu NULL 로 INSERT 시뮬레이션 (테스트용)
--   --   INSERT INTO field_surveys (survey_type, location, payload)
--   --     VALUES ('building',
--   --             ST_SetSRID(ST_MakePoint(127.012,37.564),4326),
--   --             '{"first_floor_use":"cafe"}');
--   --   ROLLBACK 후 폐기.
-- ============================================================

ALTER TABLE field_surveys
  DROP CONSTRAINT IF EXISTS field_surveys_building_ref_chk;

COMMENT ON COLUMN field_surveys.building_pnu IS
  'PNU. building 타입에서도 NULL 허용 (좌표 우선 모드 — 폴리곤 매핑 안 된 자유 위치 조사).';
