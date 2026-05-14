-- ============================================================
-- Migration: 00021_create_business_history_rpc
-- Order:     21 (00020 이후)
-- Purpose:   건물 상세 카드에서 호출할 영업 이력 조회 RPC.
--            fetch_business_history_by_building(p_pnu, p_building_id)
--              - p_pnu 와 p_building_id 둘 다 NULL 이면 0행
--              - 둘 중 하나만 주어지면 그 키로 매칭
--              - 둘 다 주어지면 OR 매칭 (ETL 단계에서 한쪽만 채웠을 수도 있음)
--              - 영업/폐업 모두 포함, opened_at DESC NULLS LAST 정렬
--
-- Verification:
--   SELECT proname, pg_get_function_identity_arguments(oid)
--   FROM pg_proc
--   WHERE proname = 'fetch_business_history_by_building';
--
--   SELECT COUNT(*) FROM fetch_business_history_by_building(NULL, NULL);  -- 0
-- ============================================================

CREATE OR REPLACE FUNCTION fetch_business_history_by_building(
  p_pnu          VARCHAR DEFAULT NULL,
  p_building_id  BIGINT  DEFAULT NULL
)
RETURNS TABLE (
  id             BIGINT,
  business_name  TEXT,
  business_type  TEXT,
  opened_at      DATE,
  closed_at      DATE,
  status         TEXT,
  jibun_address  TEXT,
  road_address   TEXT,
  site_area_m2   NUMERIC,
  geom_json      JSONB
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    bh.id,
    bh.business_name,
    bh.business_type,
    bh.opened_at,
    bh.closed_at,
    bh.status,
    bh.jibun_address,
    bh.road_address,
    bh.site_area_m2,
    ST_AsGeoJSON(bh.geom)::jsonb AS geom_json
  FROM business_history bh
  WHERE
    (p_pnu IS NOT NULL AND bh.building_pnu = p_pnu)
    OR (p_building_id IS NOT NULL AND bh.building_id = p_building_id)
  ORDER BY bh.opened_at DESC NULLS LAST, bh.id DESC;
$$;

COMMENT ON FUNCTION fetch_business_history_by_building(VARCHAR, BIGINT) IS
  '건물(pnu 또는 buildings.id) 기준 음식점 영업 이력 반환. 영업/폐업 모두 포함, opened_at 내림차순.';
