-- ============================================================
-- Migration: 00011_relax_field_surveys_rls
-- Order:     11 (Phase B Step B0 — 추가 요구사항: 조사 데이터 공유 + 수정)
-- Purpose:   field_surveys 의 anon RLS 완화 + updated_at 자동 갱신.
--
--            원래 설계: anon INSERT only (조사원이 raw 데이터를 못 봄).
--            변경 사유: 모든 조사원이 모든 조사 데이터를 지도에서 보고
--            pending 상태일 때 자유롭게 수정/보완할 수 있게 하기 위함.
--
--            (1) anon, authenticated GRANT SELECT, UPDATE 추가
--            (2) anon_select_field_surveys 정책 (모두 SELECT 허용)
--            (3) anon_update_pending_only 정책
--                - USING (status = 'pending')   ← pending row 만 대상
--                - WITH CHECK (status = 'pending') ← 수정 후에도 pending 유지
--                  → anon 은 status 를 변경할 수 없음 (admin 권한 차단)
--            (4) updated_at BEFORE UPDATE 트리거
--
--            신뢰 모델 변경:
--              - 비밀번호 공유 모델이므로 raw 데이터 사실상 반공개
--              - DELETE 는 여전히 service_role 만 가능
--              - status 변경(approve/reject) 도 service_role 만 가능
--
-- Verification (실행 후 Supabase SQL Editor):
--   -- (1) 정책 추가 확인
--   SELECT policyname, cmd FROM pg_policies
--   WHERE tablename = 'field_surveys' ORDER BY policyname;
--   -- 기대: anon_insert_field_surveys (INSERT)
--   --       anon_select_field_surveys (SELECT)
--   --       anon_update_pending_only  (UPDATE)
--
--   -- (2) 권한 확인
--   SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_name = 'field_surveys' AND grantee IN ('anon','authenticated','service_role')
--   ORDER BY grantee, privilege_type;
--   -- anon:           INSERT, SELECT, UPDATE
--   -- service_role:   SELECT, INSERT, UPDATE, DELETE
--
--   -- (3) 트리거 확인
--   SELECT tgname FROM pg_trigger
--   WHERE tgrelid = 'field_surveys'::regclass AND NOT tgisinternal;
--   -- 기대: field_surveys_set_updated_at
--
--   -- (4) 트리거 동작 확인 (테스트 row 1 개 삽입 후 업데이트)
--   --   INSERT INTO field_surveys (survey_type, location, payload)
--   --     VALUES ('point', ST_SetSRID(ST_MakePoint(127.012,37.564),4326), '{"category":"other"}');
--   --   UPDATE field_surveys SET memo='test' WHERE id=(SELECT id FROM field_surveys ORDER BY created_at DESC LIMIT 1);
--   --   SELECT id, created_at, updated_at FROM field_surveys ORDER BY updated_at DESC LIMIT 1;
--   --   -- updated_at > created_at 이어야 함
--   --   DELETE FROM field_surveys WHERE memo='test';   -- service_role 로만 가능
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1) GRANT 추가 (Phase 1/2 교훈 — 정책만 만들고 GRANT 빠뜨리지 않기)
-- ────────────────────────────────────────────────────────────
GRANT SELECT, UPDATE ON field_surveys TO anon, authenticated;


-- ────────────────────────────────────────────────────────────
-- 2) anon SELECT 정책 — 모든 조사 데이터 열람 허용
-- ────────────────────────────────────────────────────────────
CREATE POLICY anon_select_field_surveys
  ON field_surveys
  FOR SELECT
  TO anon, authenticated
  USING (true);


-- ────────────────────────────────────────────────────────────
-- 3) anon UPDATE 정책 — pending row 만, status 변경 차단
-- ────────────────────────────────────────────────────────────
-- USING : 어떤 row 가 UPDATE 대상이 될 수 있는지 (현재 status='pending' row만)
-- WITH CHECK : UPDATE 후 row 가 만족해야 할 조건 (status 가 여전히 'pending')
-- 두 조건의 결합으로 anon 이 status 를 approved/rejected 로 못 바꾸게 강제됨.
CREATE POLICY anon_update_pending_only
  ON field_surveys
  FOR UPDATE
  TO anon, authenticated
  USING      (status = 'pending')
  WITH CHECK (status = 'pending');


-- ────────────────────────────────────────────────────────────
-- 4) updated_at 자동 갱신 트리거
-- ────────────────────────────────────────────────────────────
-- 함수는 향후 다른 테이블에도 재사용 가능하도록 일반화된 이름.
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER field_surveys_set_updated_at
  BEFORE UPDATE ON field_surveys
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_updated_at();

COMMENT ON FUNCTION trg_set_updated_at() IS '범용 BEFORE UPDATE 트리거 함수: NEW.updated_at = NOW().';
