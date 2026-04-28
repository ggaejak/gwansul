-- ============================================================
-- Migration: 00007_create_zoning_rpc
-- Order:     7 (00006 이후)
-- Purpose:   클라이언트가 호출할 zoning_intersect RPC 정의.
--            기존 클라이언트 turf.circle + turf.booleanIntersects 를
--            PostGIS ST_Buffer + ST_Intersects 로 완전 대체.
--
--            반환 정책 (Phase 1 buildings 어댑터와 일관):
--              - geom_json: 원본 폴리곤 전체 (ST_Intersection 잘림 X)
--                정적 모드와 시각·집계 결과를 100% 동일하게 유지하기 위함
--              - intersect_area_m2: 교차 영역 면적 (참고용. 향후 면적
--                비율 분석에 활용 가능. Phase 2 클라이언트는 미사용)
--
--            반경 입력 규약:
--              - 클라이언트는 중심점 변경 시 최대 반경 (예: 1000m) 으로
--                1회 호출. 슬라이더 조정은 클라이언트 필터.
--              - Phase 1 buildings_within 과 동일 패턴.
--
-- Verification (실행 후):
--   -- (1) 함수 존재 확인
--   SELECT proname, pg_get_function_identity_arguments(oid)
--   FROM pg_proc WHERE proname = 'zoning_intersect';
--
--   -- (2) 빈 테이블 호출 — 0 행 반환
--   SELECT COUNT(*) FROM zoning_intersect(126.9975, 37.5644, 1000, '11140');
--
--   -- (3) (데이터 적재 후) 인덱스 사용 확인
--   EXPLAIN ANALYZE
--   SELECT COUNT(*) FROM zoning_intersect(126.9975, 37.5644, 500, '11140');
--   -- 'Index Scan using zoning_geom_idx' 가 보이면 정상
-- ============================================================

CREATE OR REPLACE FUNCTION zoning_intersect(
  lng       DOUBLE PRECISION,
  lat       DOUBLE PRECISION,
  radius_m  INT,
  district  VARCHAR DEFAULT '11140'
)
RETURNS TABLE (
  zone_name         TEXT,
  atrb_se           VARCHAR,
  dgm_ar            NUMERIC,
  source_district   TEXT,
  intersect_area_m2 DOUBLE PRECISION,
  geom_json         JSONB
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  WITH circle AS (
    SELECT
      ST_Buffer(ST_MakePoint(lng, lat)::geography, radius_m)::geometry AS g
  )
  SELECT
    z.zone_name,
    z.atrb_se,
    z.dgm_ar,
    z.source_district,
    ST_Area(ST_Intersection(z.geom, c.g)::geography) AS intersect_area_m2,
    ST_AsGeoJSON(z.geom)::jsonb AS geom_json
  FROM zoning z, circle c
  WHERE z.district_code = district
    AND ST_Intersects(z.geom, c.g);
$$;

-- 명시적 EXECUTE 권한 (Supabase 는 PUBLIC 함수에 기본 허용이지만 명시)
GRANT EXECUTE ON FUNCTION zoning_intersect(DOUBLE PRECISION, DOUBLE PRECISION, INT, VARCHAR)
  TO anon, authenticated;

COMMENT ON FUNCTION zoning_intersect(DOUBLE PRECISION, DOUBLE PRECISION, INT, VARCHAR) IS
  '중심점에서 radius_m 반경 원과 교차하는 모든 용도지역 폴리곤을 반환. '
  'geom_json 은 잘림 없는 원본 폴리곤. intersect_area_m2 는 교차 면적(㎡, geography 기반).';
