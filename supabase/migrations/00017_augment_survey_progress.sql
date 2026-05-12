-- ============================================================
-- Migration: 00017_augment_survey_progress
-- Order:     17 (Phase C — C4 진행률 대시보드 보강)
-- Purpose:   survey_progress() RPC 에 도로/점 curated 누적 카운트와
--            type 별 미검토 분리 카운트를 추가.
--
-- 현재(00009) 시점 반환 필드 + 추가:
--   기존:
--     in_area_total, surveyed_buildings, approved_buildings,
--     pending_total, approved_total, rejected_total, by_day
--   추가:
--     curated_roads_total       — curated_roads row 수
--     curated_points_total      — curated_points row 수
--     pending_by_type           — { building, road, point } 각각의 pending 수
--
-- 호환성: 기존 반환 키는 모두 유지. 추가 키만 늘어남.
--         프런트(src/data/surveys.js EMPTY_PROGRESS) 도 동일 키로 확장.
--
-- Verification:
--   SELECT jsonb_pretty(survey_progress());
--   -- 새 키 3 개 존재 확인.
-- ============================================================


CREATE OR REPLACE FUNCTION survey_progress()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  area_buildings AS (
    SELECT id, pnu FROM buildings
    WHERE ST_Intersects(geom, sindang_area())
  ),
  totals AS (
    SELECT
      (SELECT COUNT(*) FROM area_buildings) AS in_area_total,
      (
        SELECT COUNT(DISTINCT b.id)
        FROM area_buildings b
        JOIN field_surveys fs
          ON fs.survey_type = 'building'
         AND (fs.building_id = b.id OR fs.building_pnu = b.pnu)
      ) AS surveyed_buildings,
      (
        SELECT COUNT(DISTINCT b.id)
        FROM area_buildings b
        JOIN curated_buildings cb
          ON (cb.building_id = b.id OR cb.building_pnu = b.pnu)
      ) AS approved_buildings,
      (SELECT COUNT(*) FROM field_surveys WHERE status='pending')  AS pending_total,
      (SELECT COUNT(*) FROM field_surveys WHERE status='approved') AS approved_total,
      (SELECT COUNT(*) FROM field_surveys WHERE status='rejected') AS rejected_total,
      (SELECT COUNT(*) FROM curated_roads)                          AS curated_roads_total,
      (SELECT COUNT(*) FROM curated_points)                         AS curated_points_total,
      (SELECT COUNT(*) FROM field_surveys
        WHERE survey_type='building' AND status='pending')          AS pending_building,
      (SELECT COUNT(*) FROM field_surveys
        WHERE survey_type='road'     AND status='pending')          AS pending_road,
      (SELECT COUNT(*) FROM field_surveys
        WHERE survey_type='point'    AND status='pending')          AS pending_point
  ),
  by_day AS (
    SELECT
      DATE(created_at AT TIME ZONE 'Asia/Seoul') AS day,
      COUNT(*) FILTER (WHERE status='pending')   AS pending,
      COUNT(*) FILTER (WHERE status='approved')  AS approved,
      COUNT(*) FILTER (WHERE status='rejected')  AS rejected,
      COUNT(*)                                   AS total
    FROM field_surveys
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(created_at AT TIME ZONE 'Asia/Seoul')
    ORDER BY day DESC
  )
  SELECT jsonb_build_object(
    'in_area_total',         (SELECT in_area_total       FROM totals),
    'surveyed_buildings',    (SELECT surveyed_buildings  FROM totals),
    'approved_buildings',    (SELECT approved_buildings  FROM totals),
    'pending_total',         (SELECT pending_total       FROM totals),
    'approved_total',        (SELECT approved_total      FROM totals),
    'rejected_total',        (SELECT rejected_total      FROM totals),
    'curated_roads_total',   (SELECT curated_roads_total  FROM totals),
    'curated_points_total',  (SELECT curated_points_total FROM totals),
    'pending_by_type', jsonb_build_object(
      'building', (SELECT pending_building FROM totals),
      'road',     (SELECT pending_road     FROM totals),
      'point',    (SELECT pending_point    FROM totals)
    ),
    'by_day', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'day',      to_char(day, 'YYYY-MM-DD'),
          'pending',  pending,
          'approved', approved,
          'rejected', rejected,
          'total',    total
        )
      ) FROM by_day),
      '[]'::jsonb
    )
  );
$$;

COMMENT ON FUNCTION survey_progress()
  IS '조사 진행률 통계 (C4 확장): 건물 진행률 + 도로/점 curated 누적 + type 별 pending + 30일 추이.';

-- GRANT 는 00009 에서 이미 부여됨. CREATE OR REPLACE 는 권한 유지.
