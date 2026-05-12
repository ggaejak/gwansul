-- ============================================================
-- Migration: 00015_admin_review_rpc
-- Order:     15 (Phase C — 관리자 승인/반려 + curated 저장 RPC)
-- Purpose:   관리자 페이지(/survey-admin) 의 검토 액션을 위한 RPC 5 종.
--
--            (1) admin_check_password(p_password)
--                — 비밀번호 게이트 헬퍼. 모든 admin RPC 의 첫 줄에서 호출.
--                — 비밀번호 변경 시 이 함수와 클라이언트 ENV 동시 갱신 필요.
--
--            (2) admin_approve_survey_building(p_password, p_id, ...)
--                — 건물 조사 승인: curated_buildings 에 UPSERT(1 건물=1 row 원칙).
--                — field_surveys.status = 'approved', reviewed_at = NOW().
--                — 기존 curated_buildings 가 있으면 source_survey_ids 에 append.
--
--            (3) admin_approve_survey_road(p_password, p_id, ...)
--                — 도로 조사 승인: curated_roads 에 INSERT (1:1).
--
--            (4) admin_approve_survey_point(p_password, p_id, ...)
--                — 점 조사 승인: curated_points 에 INSERT (1:1).
--
--            (5) admin_reject_survey(p_password, p_id, p_reason)
--                — 반려: status='rejected', reject_reason 저장.
--
-- 보안 모델:
--   - 모두 SECURITY DEFINER. anon 은 RLS 로 status 변경/curated INSERT 가
--     원칙 차단되지만, 비밀번호 검증을 통과하면 함수 owner 권한으로 우회.
--   - 비밀번호는 마이그레이션 파일(=git)에 평문 노출. 클라이언트도
--     VITE_SURVEY_ADMIN_PASSWORD ENV(폴백 'Gwansul8&') 로 동일 평문 보유.
--     보안 등급: "비공개 페이지 password gate" 와 동일 수준. 비공개 저장소 가정.
--   - 비밀번호 변경 절차:
--       a) 새 마이그레이션으로 admin_check_password 만 CREATE OR REPLACE
--       b) 클라이언트 ENV(.env / hosting) 갱신
--       c) 두 곳 동시 배포
--
-- Verification (실행 후 Supabase SQL Editor):
--   -- (1) 함수 5 개 존재
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('admin_check_password','admin_approve_survey_building',
--                     'admin_approve_survey_road','admin_approve_survey_point',
--                     'admin_reject_survey')
--   ORDER BY proname;
--
--   -- (2) 비밀번호 검증 (예외 발생해야 함)
--   SELECT admin_check_password('wrong');                   -- 에러
--   SELECT admin_check_password('Gwansul8&');               -- void (성공)
--
--   -- (3) 반려 (테스트 row 가 있다고 가정)
--   -- SELECT admin_reject_survey('Gwansul8&', '<uuid>', '사진 식별 불가');
--   -- 그 후 SELECT status, reject_reason, reviewed_at FROM field_surveys WHERE id='<uuid>';
--
--   -- (4) 점 조사 승인 흐름
--   -- INSERT INTO field_surveys (survey_type, location, payload)
--   --   VALUES ('point', ST_SetSRID(ST_MakePoint(127.012,37.564),4326), '{"category":"other"}');
--   -- SELECT admin_approve_survey_point('Gwansul8&', '<uuid>', 'other', 'test');
--   -- SELECT * FROM curated_points ORDER BY approved_at DESC LIMIT 1;
--
--   -- (5) anon EXECUTE 권한
--   SELECT routine_name, grantee FROM information_schema.routine_privileges
--   WHERE routine_name LIKE 'admin_%' AND grantee IN ('anon','authenticated')
--   ORDER BY routine_name;
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1) admin_check_password — 비밀번호 게이트 헬퍼
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_check_password(p_password TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_password IS DISTINCT FROM 'Gwansul8&' THEN
    RAISE EXCEPTION '관리자 비밀번호가 올바르지 않습니다'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

COMMENT ON FUNCTION admin_check_password(TEXT)
  IS '관리자 비밀번호 검증 헬퍼. 모든 admin_* RPC 의 첫 줄에서 PERFORM. 클라이언트 ENV(VITE_SURVEY_ADMIN_PASSWORD) 와 동기 유지.';


-- ────────────────────────────────────────────────────────────
-- 2) admin_approve_survey_building
--    1 건물 = 1 curated_buildings row 원칙.
--    같은 building_id 또는 building_pnu 의 row 가 있으면 UPDATE + append,
--    없으면 INSERT.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_approve_survey_building(
  p_password         TEXT,
  p_id               UUID,
  p_first_floor_use  TEXT    DEFAULT NULL,
  p_is_vacant        BOOLEAN DEFAULT NULL,
  p_admin_memo       TEXT    DEFAULT NULL
)
RETURNS BIGINT       -- curated_buildings.id (생성/갱신된 row)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fs        field_surveys%ROWTYPE;
  v_existing  curated_buildings%ROWTYPE;
  v_result_id BIGINT;
BEGIN
  PERFORM admin_check_password(p_password);

  SELECT * INTO v_fs FROM field_surveys WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '조사 데이터를 찾을 수 없습니다: %', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_fs.survey_type <> 'building' THEN
    RAISE EXCEPTION 'survey_type 불일치 (expected building, got %)', v_fs.survey_type;
  END IF;

  -- 기존 curated row 매칭: id 또는 pnu 일치.
  SELECT * INTO v_existing FROM curated_buildings
   WHERE (v_fs.building_id  IS NOT NULL AND building_id  = v_fs.building_id)
      OR (v_fs.building_pnu IS NOT NULL AND building_pnu = v_fs.building_pnu)
   LIMIT 1;

  IF FOUND THEN
    -- 같은 건물의 새 조사 → 정제값 갱신 + source 누적.
    UPDATE curated_buildings
       SET first_floor_use   = COALESCE(p_first_floor_use, first_floor_use),
           is_vacant         = COALESCE(p_is_vacant, is_vacant),
           photo_paths       = COALESCE(v_fs.photo_paths, photo_paths),
           admin_memo        = COALESCE(p_admin_memo, admin_memo),
           source_survey_ids = ARRAY(
             SELECT DISTINCT x FROM unnest(source_survey_ids || ARRAY[p_id]) AS x
           ),
           updated_at        = NOW()
     WHERE id = v_existing.id
     RETURNING id INTO v_result_id;
  ELSE
    INSERT INTO curated_buildings (
      building_id, building_pnu,
      first_floor_use, is_vacant,
      photo_paths, admin_memo, source_survey_ids
    ) VALUES (
      v_fs.building_id, v_fs.building_pnu,
      p_first_floor_use, p_is_vacant,
      COALESCE(v_fs.photo_paths, ARRAY[]::TEXT[]),
      p_admin_memo, ARRAY[p_id]
    )
    RETURNING id INTO v_result_id;
  END IF;

  -- raw status 갱신.
  UPDATE field_surveys
     SET status      = 'approved',
         reviewed_at = NOW()
   WHERE id = p_id;

  RETURN v_result_id;
END;
$$;

COMMENT ON FUNCTION admin_approve_survey_building(TEXT, UUID, TEXT, BOOLEAN, TEXT)
  IS '건물 조사 승인: curated_buildings UPSERT (1 건물=1 row) + field_surveys.status=approved.';


-- ────────────────────────────────────────────────────────────
-- 3) admin_approve_survey_road
--    1 조사 = 1 curated_roads row (1:1).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_approve_survey_road(
  p_password         TEXT,
  p_id               UUID,
  p_night_brightness TEXT DEFAULT NULL,
  p_road_width       TEXT DEFAULT NULL,
  p_admin_memo       TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fs        field_surveys%ROWTYPE;
  v_result_id BIGINT;
BEGIN
  PERFORM admin_check_password(p_password);

  SELECT * INTO v_fs FROM field_surveys WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '조사 데이터를 찾을 수 없습니다: %', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_fs.survey_type <> 'road' THEN
    RAISE EXCEPTION 'survey_type 불일치 (expected road, got %)', v_fs.survey_type;
  END IF;

  INSERT INTO curated_roads (
    location, night_brightness, road_width,
    photo_paths, admin_memo, source_survey_ids
  ) VALUES (
    v_fs.location, p_night_brightness, p_road_width,
    COALESCE(v_fs.photo_paths, ARRAY[]::TEXT[]),
    p_admin_memo, ARRAY[p_id]
  )
  RETURNING id INTO v_result_id;

  UPDATE field_surveys
     SET status      = 'approved',
         reviewed_at = NOW()
   WHERE id = p_id;

  RETURN v_result_id;
END;
$$;

COMMENT ON FUNCTION admin_approve_survey_road(TEXT, UUID, TEXT, TEXT, TEXT)
  IS '도로 조사 승인: curated_roads INSERT (1:1) + field_surveys.status=approved.';


-- ────────────────────────────────────────────────────────────
-- 4) admin_approve_survey_point
--    1 조사 = 1 curated_points row (1:1). category 는 NOT NULL.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_approve_survey_point(
  p_password   TEXT,
  p_id         UUID,
  p_category   TEXT,
  p_admin_memo TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fs        field_surveys%ROWTYPE;
  v_result_id BIGINT;
BEGIN
  PERFORM admin_check_password(p_password);

  IF p_category IS NULL OR p_category = '' THEN
    RAISE EXCEPTION 'category 는 NOT NULL — 정제 단계에서 카테고리 확정 필요';
  END IF;

  SELECT * INTO v_fs FROM field_surveys WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '조사 데이터를 찾을 수 없습니다: %', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_fs.survey_type <> 'point' THEN
    RAISE EXCEPTION 'survey_type 불일치 (expected point, got %)', v_fs.survey_type;
  END IF;

  INSERT INTO curated_points (
    location, category,
    photo_paths, admin_memo, source_survey_ids
  ) VALUES (
    v_fs.location, p_category,
    COALESCE(v_fs.photo_paths, ARRAY[]::TEXT[]),
    p_admin_memo, ARRAY[p_id]
  )
  RETURNING id INTO v_result_id;

  UPDATE field_surveys
     SET status      = 'approved',
         reviewed_at = NOW()
   WHERE id = p_id;

  RETURN v_result_id;
END;
$$;

COMMENT ON FUNCTION admin_approve_survey_point(TEXT, UUID, TEXT, TEXT)
  IS '점 조사 승인: curated_points INSERT (1:1) + field_surveys.status=approved.';


-- ────────────────────────────────────────────────────────────
-- 5) admin_reject_survey
--    반려: status='rejected' + reject_reason. curated_* INSERT 없음.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_reject_survey(
  p_password TEXT,
  p_id       UUID,
  p_reason   TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  PERFORM admin_check_password(p_password);

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION '반려 사유는 필수입니다';
  END IF;

  UPDATE field_surveys
     SET status        = 'rejected',
         reject_reason = p_reason,
         reviewed_at   = NOW()
   WHERE id = p_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION '조사 데이터를 찾을 수 없습니다: %', p_id
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION admin_reject_survey(TEXT, UUID, TEXT)
  IS '조사 반려: status=rejected + reject_reason 저장. curated_* 영향 없음.';


-- ────────────────────────────────────────────────────────────
-- 6) 권한
-- ────────────────────────────────────────────────────────────
-- admin_check_password 는 다른 함수에서 호출되므로 anon 도 EXECUTE 필요.
GRANT EXECUTE ON FUNCTION admin_check_password(TEXT)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION admin_approve_survey_building(TEXT, UUID, TEXT, BOOLEAN, TEXT)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION admin_approve_survey_road(TEXT, UUID, TEXT, TEXT, TEXT)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION admin_approve_survey_point(TEXT, UUID, TEXT, TEXT)
  TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION admin_reject_survey(TEXT, UUID, TEXT)
  TO anon, authenticated, service_role;
