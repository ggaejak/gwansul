-- ============================================================
-- Migration: 00024_fix_match_rpc_lateral
-- Order:     24 (00022 의 RPC 재정의)
-- Purpose:   match_business_history_to_buildings() 의 nearest 폴백
--            UPDATE 가 PostgreSQL 의 FROM-clause 가시성 규칙에 위배되어
--            실행 시점에 다음 에러를 던지는 것을 수정.
--              42P10: invalid reference to FROM-clause entry for table "bh"
--
--            원인:
--              UPDATE business_history bh
--                FROM LATERAL (SELECT … WHERE … bh.geom …) AS nearest
--              구조에서 LATERAL 서브쿼리가 UPDATE 타겟 (bh) 을
--              참조할 수 없음. PostgreSQL 은 UPDATE 의 FROM 절에서
--              LATERAL 이 타겟 자신을 보는 것을 금지.
--
--            수정:
--              LATERAL 제거. 후보를 CTE 에서 ROW_NUMBER() PARTITION 으로
--              미리 산출(가장 가까운 1건 선택)한 뒤 UPDATE JOIN.
--              결과는 동일 — 각 미매칭 행마다 p_nearest_max_m 이내에서
--              가장 가까운 건물 1건.
--
--            CREATE OR REPLACE 이므로 기존 GRANT (00023 에서 부여) 가
--            보존된다. 00022 자체는 유지하되 이 마이그레이션이 본문을
--            덮어쓴다.
--
-- Verification:
--   -- 적재 후 실행
--   SELECT * FROM match_business_history_to_buildings();
--   -- contained_count + nearest_count + unmatched_count = total
--   SELECT COUNT(*) FROM business_history;
-- ============================================================

CREATE OR REPLACE FUNCTION match_business_history_to_buildings(
  p_district      VARCHAR DEFAULT '11140',
  p_nearest_max_m INT     DEFAULT 10
)
RETURNS TABLE (
  contained_count  BIGINT,
  nearest_count    BIGINT,
  unmatched_count  BIGINT
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

  -- 2) nearest 폴백 — LATERAL 미사용.
  --    각 미매칭 행마다 거리 순으로 PARTITION → 1위만 채택.
  WITH candidates AS (
    SELECT bh.id  AS bh_id,
           b.id   AS bld_id,
           b.pnu  AS bld_pnu,
           ROW_NUMBER() OVER (
             PARTITION BY bh.id
             ORDER BY b.geom <-> bh.geom
           ) AS rn
      FROM business_history bh
      JOIN buildings b
        ON b.district_code = p_district
       AND ST_DWithin(b.geom::geography, bh.geom::geography, p_nearest_max_m)
     WHERE bh.building_id IS NULL
  ),
  nearest AS (
    SELECT bh_id, bld_id, bld_pnu
      FROM candidates
     WHERE rn = 1
  ),
  updated AS (
    UPDATE business_history bh
       SET building_id  = n.bld_id,
           building_pnu = n.bld_pnu
      FROM nearest n
     WHERE bh.id = n.bh_id
    RETURNING bh.id
  )
  SELECT COUNT(*) INTO v_nearest FROM updated;

  -- 3) 미매칭 카운트 (전체 테이블 기준)
  SELECT COUNT(*) INTO v_unmatched
    FROM business_history
   WHERE building_id IS NULL;

  RETURN QUERY SELECT v_contained, v_nearest, v_unmatched;
END;
$$;

COMMENT ON FUNCTION match_business_history_to_buildings(VARCHAR, INT) IS
  'business_history.building_id/pnu 를 buildings 와 공간 매칭으로 채움. ETL 적재 후 1회 호출. LATERAL 미사용 (00024 수정).';
