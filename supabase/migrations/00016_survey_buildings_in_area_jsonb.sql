-- ============================================================
-- Migration: 00016_survey_buildings_in_area_jsonb
-- Order:     16 (Phase C 보강 — RPC 결과 1,000 row cap 회피)
-- Purpose:   survey_buildings_in_area() 의 반환 타입을 RETURNS TABLE →
--            RETURNS JSONB 로 변경. PostgREST 의 db.max_rows(Supabase 디폴트 1,000)
--            는 TABLE 반환에만 적용되므로, JSONB 단일 row 로 바꿔서 우회.
--
-- 배경:
--   - 신당동 영역 내 buildings 가 약 6,447 row 이지만 클라이언트는 1,000 만 수신.
--   - LIMIT 추가는 동일 cap 의 영향 하 → 해결 X.
--   - PostgREST 설정(db-max-rows)은 Supabase 호스팅 환경에서 변경 어려움.
--   - 동일 프로젝트의 fetch_surveys_in_area()(00012) 가 이미 JSONB 패턴이라
--     이 방식이 컨벤션과도 일치.
--
-- 변경 영향:
--   - 클라이언트(src/data/surveys.js fetchBuildingsInSurveyArea) 가
--     jsonb FeatureCollection 을 직접 받도록 어댑터 변경 필요.
--   - 기존 dbRowsToBuildingFeatureCollection(rows) 는 더 이상 사용되지 않음
--     (행 단위 매핑이 아닌 객체 단위).
--
-- Verification:
--   -- (1) 새 시그니처
--   SELECT pg_get_function_result(oid) FROM pg_proc WHERE proname = 'survey_buildings_in_area';
--   -- 기대: jsonb
--
--   -- (2) 영역 내 row 수와 features 수 일치
--   SELECT
--     (SELECT COUNT(*) FROM buildings WHERE ST_Intersects(geom, sindang_area())) AS db_count,
--     jsonb_array_length((SELECT survey_buildings_in_area() -> 'features'))     AS rpc_count;
--   -- 두 값이 동일해야 함 (예: 6447 / 6447)
--
--   -- (3) 첫 feature 구조
--   SELECT jsonb_pretty(((survey_buildings_in_area() -> 'features') -> 0));
--   -- 기대: { type:'Feature', geometry:{type:'Polygon',...}, properties:{ id, pnu, bld_nm, ... } }
-- ============================================================


-- 기존 함수 DROP 후 재정의 (반환 타입 변경이라 CREATE OR REPLACE 불가).
DROP FUNCTION IF EXISTS survey_buildings_in_area();

CREATE OR REPLACE FUNCTION survey_buildings_in_area()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'type',     'Feature',
          'geometry', ST_AsGeoJSON(b.geom)::jsonb,
          'properties', jsonb_build_object(
            'id',             b.id,
            'pnu',            b.pnu,
            'bld_nm',         b.bld_nm,
            'main_purps',     b.main_purps,
            'vl_rat',         b.vl_rat,
            'survey_count',   COALESCE(s.survey_count, 0),
            'approved_count', COALESCE(s.approved_count, 0),
            'has_curated',    (cb.id IS NOT NULL)
          )
        )
      ),
      '[]'::jsonb
    )
  )
  FROM buildings b
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)                                       AS survey_count,
      COUNT(*) FILTER (WHERE fs.status = 'approved') AS approved_count
    FROM field_surveys fs
    WHERE fs.survey_type = 'building'
      AND (fs.building_id = b.id OR fs.building_pnu = b.pnu)
  ) s ON true
  LEFT JOIN curated_buildings cb
    ON (cb.building_id = b.id OR cb.building_pnu = b.pnu)
  WHERE ST_Intersects(b.geom, sindang_area())
$$;

COMMENT ON FUNCTION survey_buildings_in_area()
  IS '신당동 영역 내 건물 + 조사 통계 (FeatureCollection JSONB). max_rows cap 회피용. SurveyMap 지도 렌더링용. SECURITY DEFINER 로 anon 호출 허용.';


-- 권한 재부여 (DROP 시 GRANT 도 같이 제거됨).
GRANT EXECUTE ON FUNCTION survey_buildings_in_area()
  TO anon, authenticated, service_role;
