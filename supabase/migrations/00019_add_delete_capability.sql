-- ============================================================
-- Migration: 00019_add_delete_capability
-- Order:     19 (Phase C 보강 — 조사 데이터 삭제 기능)
-- Purpose:   현장 조사 데이터 삭제를 위한 RLS + RPC + trigger 일괄 추가.
--
--   (1) anon DELETE 정책: status='pending' 한정 (조사원 셀프 삭제용)
--   (2) admin_delete_survey RPC: SECURITY DEFINER + 비밀번호 게이트
--       모든 상태 삭제 가능. 삭제 전 photo_paths 수집해서 반환 → 클라가 Storage 정리.
--   (3) curated_* 자동 정리 트리거: field_surveys row DELETE 시
--       curated_buildings/roads/points 의 source_survey_ids 에서 해당 id 제거.
--       제거 후 빈 배열이 되면 그 curated row 자체 삭제.
--       트리거는 SECURITY DEFINER 라 anon DELETE 에서도 curated 갱신 가능.
--
-- 정책:
--   - anon (조사원): pending 만 DELETE 가능 (RLS 가 차단)
--   - service_role (혹은 admin RPC): 모든 상태 DELETE 가능
--   - 사진 파일 삭제는 클라이언트가 Storage API 로 별도 호출
--     (Storage RLS 는 Supabase Dashboard 에서 수동 설정 — docs/phase-c-storage-delete-policy.md)
--
-- 비밀번호: admin_check_password() (00015) 재사용.
--
-- Verification (실행 후 Supabase SQL Editor):
--   -- (1) 정책 + GRANT
--   SELECT policyname, cmd FROM pg_policies
--   WHERE tablename='field_surveys' ORDER BY policyname;
--   -- 기대: anon_delete_pending_only (DELETE) 추가
--
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name='field_surveys' AND grantee IN ('anon','authenticated')
--   ORDER BY grantee, privilege_type;
--   -- 기대: anon DELETE, INSERT, SELECT, UPDATE
--
--   -- (2) 트리거
--   SELECT tgname FROM pg_trigger
--   WHERE tgrelid='field_surveys'::regclass AND NOT tgisinternal
--   ORDER BY tgname;
--   -- 기대: field_surveys_cleanup_curated_on_delete, field_surveys_set_updated_at
--
--   -- (3) admin_delete_survey 함수
--   SELECT proname FROM pg_proc WHERE proname='admin_delete_survey';
--
--   -- (4) anon 셀프 삭제 시뮬레이션 (SQL Editor 는 service_role 이라 RLS 우회됨 —
--   --     실제 검증은 클라이언트 /survey 에서)
--
--   -- (5) admin RPC 시뮬레이션
--   -- SELECT admin_delete_survey('Gwansul8&', '<uuid>');
--   -- 반환: { deleted_survey_id, photo_paths, curated_cleaned }
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1) anon DELETE GRANT + RLS 정책
-- ────────────────────────────────────────────────────────────
GRANT DELETE ON field_surveys TO anon, authenticated;

CREATE POLICY anon_delete_pending_only
  ON field_surveys
  FOR DELETE
  TO anon, authenticated
  USING (status = 'pending');


-- ────────────────────────────────────────────────────────────
-- 2) curated_* 자동 정리 트리거 함수
--    field_surveys row DELETE 시 호출.
--    SECURITY DEFINER → anon DELETE 시에도 curated_* 갱신 권한 확보.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_cleanup_curated_on_survey_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- curated_buildings: 배열에서 OLD.id 제거, 빈 배열이면 row 삭제
  UPDATE curated_buildings
     SET source_survey_ids = array_remove(source_survey_ids, OLD.id),
         updated_at        = NOW()
   WHERE OLD.id = ANY(source_survey_ids);
  DELETE FROM curated_buildings
   WHERE source_survey_ids = ARRAY[]::UUID[]
      OR source_survey_ids IS NULL;

  -- curated_roads (1:1 매칭이므로 보통 단일 source — 제거 즉시 빈 배열 됨)
  UPDATE curated_roads
     SET source_survey_ids = array_remove(source_survey_ids, OLD.id),
         updated_at        = NOW()
   WHERE OLD.id = ANY(source_survey_ids);
  DELETE FROM curated_roads
   WHERE source_survey_ids = ARRAY[]::UUID[]
      OR source_survey_ids IS NULL;

  -- curated_points (1:1)
  UPDATE curated_points
     SET source_survey_ids = array_remove(source_survey_ids, OLD.id),
         updated_at        = NOW()
   WHERE OLD.id = ANY(source_survey_ids);
  DELETE FROM curated_points
   WHERE source_survey_ids = ARRAY[]::UUID[]
      OR source_survey_ids IS NULL;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION trg_cleanup_curated_on_survey_delete()
  IS 'field_surveys DELETE 시 curated_* 의 source_survey_ids 에서 해당 id 제거 + 빈 배열 row 삭제. SECURITY DEFINER 로 anon DELETE 에서도 동작.';

CREATE TRIGGER field_surveys_cleanup_curated_on_delete
  AFTER DELETE ON field_surveys
  FOR EACH ROW
  EXECUTE FUNCTION trg_cleanup_curated_on_survey_delete();


-- ────────────────────────────────────────────────────────────
-- 3) admin_delete_survey RPC
--    비밀번호 통과 시 모든 상태 삭제 허용. 삭제 전 photo_paths 수집.
--    삭제 후 curated 가 영향받았는지 여부를 반환 (curated_cleaned).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_delete_survey(
  p_password TEXT,
  p_id       UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_photo_paths    TEXT[];
  v_was_in_curated BOOLEAN;
BEGIN
  PERFORM admin_check_password(p_password);

  SELECT photo_paths INTO v_photo_paths
    FROM field_surveys
   WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '조사 데이터를 찾을 수 없습니다: %', p_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- 삭제 전 curated 포함 여부 (트리거가 실제 정리)
  SELECT
    EXISTS (SELECT 1 FROM curated_buildings WHERE p_id = ANY(source_survey_ids))
    OR EXISTS (SELECT 1 FROM curated_roads  WHERE p_id = ANY(source_survey_ids))
    OR EXISTS (SELECT 1 FROM curated_points WHERE p_id = ANY(source_survey_ids))
  INTO v_was_in_curated;

  -- 트리거가 curated_* 정리 → 그 다음 field_surveys row 삭제
  DELETE FROM field_surveys WHERE id = p_id;

  RETURN jsonb_build_object(
    'deleted_survey_id', p_id,
    'photo_paths',       COALESCE(v_photo_paths, ARRAY[]::TEXT[]),
    'curated_cleaned',   v_was_in_curated
  );
END;
$$;

COMMENT ON FUNCTION admin_delete_survey(TEXT, UUID)
  IS '조사 데이터 영구 삭제 (모든 상태). 트리거로 curated_* 자동 정리. 반환 photo_paths 로 클라가 Storage 정리.';


-- ────────────────────────────────────────────────────────────
-- 4) 권한
-- ────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION admin_delete_survey(TEXT, UUID)
  TO anon, authenticated, service_role;
