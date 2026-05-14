-- ============================================================
-- Migration: 00022_match_business_history
-- Order:     22 (00021 이후)
-- Purpose:   business_history 의 building_id / building_pnu 를 buildings 와
--            공간 매칭으로 채우는 ETL 보조 RPC.
--
--            매칭 정책:
--              1) ST_Contains(building.geom, point) — 건물 footprint 내부
--              2) 1) 실패한 행 중 building.geom 에서 10m 이내 가장 가까운 건물
--              3) 그래도 실패하면 building_id/pnu 는 NULL 유지
--
--            지번주소 파싱 기반 PNU 매칭은 도입하지 않음:
--              - 원본 지번주소에 "(1층)", "외1필지", 건물명 등 변형이 많아
--                정규화 비용 대비 매칭률이 낮음
--              - 좌표가 91%(617/678건 답사영역 대상) 존재 + EPSG:2097→4326
--                변환이 신뢰 가능
--
--            district_code='11140' (중구) 만 매칭 — 미래 타구 확장 시
--            district 파라미터 추가.
--
-- Verification:
--   -- (1) 함수 생성
--   SELECT proname FROM pg_proc WHERE proname = 'match_business_history_to_buildings';
--   -- (2) 적재 후 결과
--   SELECT * FROM match_business_history_to_buildings();
--   -- matched / unmatched 카운트 반환
-- ============================================================

CREATE OR REPLACE FUNCTION match_business_history_to_buildings(
  p_district      VARCHAR DEFAULT '11140',
  p_nearest_max_m INT     DEFAULT 10
)
RETURNS TABLE (
  contained_count  BIGINT,   -- ST_Contains 로 매칭된 수 (이번 호출에서 새로 채워진)
  nearest_count    BIGINT,   -- nearest 폴백으로 매칭된 수
  unmatched_count  BIGINT    -- 여전히 NULL 인 수 (전체 테이블 기준)
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_contained BIGINT;
  v_nearest   BIGINT;
  v_unmatched BIGINT;
BEGIN
  -- 1) ST_Contains 1차 매칭 (NULL 인 것만)
  WITH updated AS (
    UPDATE business_history bh
       SET building_id  = b.id,
           building_pnu = b.pnu
      FROM buildings b
     WHERE bh.building_id IS NULL
       AND b.district_code = p_district
       AND ST_Contains(b.geom, bh.geom)
    RETURNING bh.id
  )
  SELECT COUNT(*) INTO v_contained FROM updated;

  -- 2) nearest 폴백 (여전히 NULL 인 것만, p_nearest_max_m 이내)
  WITH updated AS (
    UPDATE business_history bh
       SET building_id  = nearest.id,
           building_pnu = nearest.pnu
      FROM LATERAL (
        SELECT b.id, b.pnu
          FROM buildings b
         WHERE b.district_code = p_district
           AND ST_DWithin(b.geom::geography, bh.geom::geography, p_nearest_max_m)
         ORDER BY b.geom <-> bh.geom
         LIMIT 1
      ) AS nearest
     WHERE bh.building_id IS NULL
    RETURNING bh.id
  )
  SELECT COUNT(*) INTO v_nearest FROM updated;

  -- 3) 미매칭 카운트
  SELECT COUNT(*) INTO v_unmatched
    FROM business_history
   WHERE building_id IS NULL;

  RETURN QUERY SELECT v_contained, v_nearest, v_unmatched;
END;
$$;

COMMENT ON FUNCTION match_business_history_to_buildings(VARCHAR, INT) IS
  'business_history.building_id/pnu 를 buildings 와 공간 매칭으로 채움. ETL 적재 후 1회 호출.';
