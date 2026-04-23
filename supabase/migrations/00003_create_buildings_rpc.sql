-- ============================================================
-- Migration: 00003_create_buildings_rpc
-- Order:     3 (00002 이후)
-- Purpose:   클라이언트가 Supabase SDK 로 호출할 RPC 함수 정의.
--            buildings_within(lng, lat, radius_m, district)
--            반환은 클라이언트에서 GeoJSON FeatureCollection 으로
--            재조립하기 쉬운 행 집합. geom_json 은 ST_AsGeoJSON 의
--            jsonb 결과.
--
--            Phase 1 호출 규약 (docs/migration-questions.md Q4):
--              - 클라이언트는 중심점 변경 시 최대 반경 1000m 로 1회 호출
--              - 반경 슬라이더 조정은 클라이언트에서 필터링
--              - 중심점 이동은 300ms debounce
--
-- Verification (실행 후):
--   -- (1) 함수 생성 확인
--   SELECT proname, pg_get_function_identity_arguments(oid)
--   FROM pg_proc
--   WHERE proname = 'buildings_within';
--
--   -- (2) 빈 테이블 상태에서 호출 — 에러 없이 0행 반환해야 함
--   SELECT COUNT(*) FROM buildings_within(126.9975, 37.5644, 1000, '11140');
--   -- 기대: 0 (아직 데이터 없음)
--
--   -- (3) EXPLAIN 으로 GIST 인덱스 사용 여부 확인 (데이터 적재 후 재검증)
--   EXPLAIN ANALYZE
--   SELECT COUNT(*) FROM buildings_within(126.9975, 37.5644, 500, '11140');
--   -- 'Index Scan using buildings_geom_idx' 가 나타나면 정상
-- ============================================================

CREATE OR REPLACE FUNCTION buildings_within(
  lng          DOUBLE PRECISION,
  lat          DOUBLE PRECISION,
  radius_m     INT,
  district     VARCHAR DEFAULT '11140'
)
RETURNS TABLE (
  pnu           VARCHAR,
  address       TEXT,
  bld_nm        TEXT,
  reg_type      VARCHAR,
  main_purps    TEXT,
  strct         TEXT,
  arch_area     NUMERIC,
  tot_area      NUMERIC,
  plat_area     NUMERIC,
  bc_rat        NUMERIC,
  vl_rat        NUMERIC,
  grnd_flr_cnt  SMALLINT,
  ugrnd_flr_cnt SMALLINT,
  use_apr_day   DATE,
  bjdong_cd     VARCHAR,
  geom_json     JSONB
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    b.pnu,
    b.address,
    b.bld_nm,
    b.reg_type,
    b.main_purps,
    b.strct,
    b.arch_area,
    b.tot_area,
    b.plat_area,
    b.bc_rat,
    b.vl_rat,
    b.grnd_flr_cnt,
    b.ugrnd_flr_cnt,
    b.use_apr_day,
    b.bjdong_cd,
    ST_AsGeoJSON(b.geom)::jsonb AS geom_json
  FROM buildings b
  WHERE b.district_code = district
    AND ST_DWithin(
      b.geom::geography,
      ST_MakePoint(lng, lat)::geography,
      radius_m
    );
$$;

COMMENT ON FUNCTION buildings_within(DOUBLE PRECISION, DOUBLE PRECISION, INT, VARCHAR) IS
  '중심점(lng, lat)에서 radius_m(미터) 반경 내 건물을 반환. ST_DWithin(geography) 로 정확한 m 거리. GIST 인덱스(buildings_geom_idx) 사용.';
