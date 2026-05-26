-- ============================================================
-- Migration: 00025_buildings_by_pnus_rpc
-- Order:     25
-- Purpose:   ETL/관리 작업용 — PNU 리스트로 buildings 의 전체 속성 + GeoJSON
--            geometry 를 받아오는 RPC.
--
--            기존 buildings_within 는 중심점/반경 기반이라 한 번에 모든
--            건물을 받기 어렵고 id 도 반환하지 않아 UPDATE 에 부적합.
--
--            본 RPC 는:
--              - id 포함 (UPDATE WHERE id = X 용)
--              - 모든 속성 + ST_AsGeoJSON(geom)::jsonb 반환
--              - SQL 함수 (STABLE PARALLEL SAFE) — index scan 활용
--
--            VWorld 건물 폴리곤 교체 같은 ETL 에서 사용.
--
-- Verification:
--   SELECT proname FROM pg_proc WHERE proname='buildings_by_pnus_with_geom';
--   SELECT COUNT(*) FROM buildings_by_pnus_with_geom(
--     ARRAY['1114016200102170091']::TEXT[]);
-- ============================================================

CREATE OR REPLACE FUNCTION buildings_by_pnus_with_geom(p_pnus TEXT[])
RETURNS TABLE (
  id            BIGINT,
  pnu           VARCHAR,
  district_code VARCHAR,
  bjdong_cd     VARCHAR,
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
  data_source   TEXT,
  geom_json     JSONB
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    b.id, b.pnu, b.district_code, b.bjdong_cd, b.address, b.bld_nm,
    b.reg_type, b.main_purps, b.strct,
    b.arch_area, b.tot_area, b.plat_area, b.bc_rat, b.vl_rat,
    b.grnd_flr_cnt, b.ugrnd_flr_cnt, b.use_apr_day, b.data_source,
    ST_AsGeoJSON(b.geom)::jsonb AS geom_json
  FROM buildings b
  WHERE b.pnu = ANY(p_pnus);
$$;

COMMENT ON FUNCTION buildings_by_pnus_with_geom(TEXT[]) IS
  'PNU 배열로 buildings 행(id+속성+GeoJSON geom) 조회. ETL 의 PNU 매칭 작업용.';

-- GRANT — service_role 만. 클라이언트 노출 X (대량 조회 부담).
REVOKE EXECUTE ON FUNCTION buildings_by_pnus_with_geom(TEXT[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION buildings_by_pnus_with_geom(TEXT[]) TO service_role;
