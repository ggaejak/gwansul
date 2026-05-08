-- ============================================================
-- Migration: 00009_create_survey_rpc
-- Order:     9 (Phase A — 현장 조사 시스템 두 번째)
-- Purpose:   현장 조사 시스템 RPC 3 종 + 신당동 영역 helper.
--
--            (1) sindang_area()              — 신당동 21-vertex 폴리곤 상수
--            (2) survey_buildings_in_area()  — 영역 내 건물 + 조사 횟수
--            (3) pending_surveys()           — 미검토 조사 목록 (paginated)
--            (4) survey_progress()           — 조사 진행률 통계 (일자별 + 총합)
--
--            모두 SECURITY DEFINER + STABLE — anon 도 호출 가능.
--            field_surveys 자체는 anon SELECT 차단이라 RPC 만 노출 창구.
--
-- Verification (실행 후 Supabase SQL Editor):
--   -- (1) 함수 4 개 존재 확인
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('sindang_area','survey_buildings_in_area','pending_surveys','survey_progress')
--   ORDER BY proname;
--
--   -- (2) 신당동 폴리곤이 정상 폴리곤인지
--   SELECT ST_IsValid(sindang_area()), ST_NPoints(sindang_area());
--   -- true, 21
--
--   -- (3) 빈 상태에서 RPC 호출 (에러 안 나야 함)
--   SELECT * FROM survey_buildings_in_area() LIMIT 1;
--   SELECT * FROM pending_surveys(20, 0);
--   SELECT * FROM survey_progress();
--
--   -- (4) 권한 확인 (anon 이 EXECUTE 보유)
--   SELECT routine_name, grantee, privilege_type
--   FROM information_schema.routine_privileges
--   WHERE routine_name IN ('survey_buildings_in_area','pending_surveys','survey_progress','sindang_area')
--     AND grantee IN ('anon','authenticated','service_role')
--   ORDER BY routine_name, grantee;
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1) sindang_area() — 신당동 조사 영역 폴리곤 상수
-- ────────────────────────────────────────────────────────────
-- 21-vertex Polygon (좌표는 src/gis/data/sindang-survey-area.json 와 동기).
-- 변경 시 새 마이그레이션(00011+)으로 CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION sindang_area()
RETURNS GEOMETRY(Polygon, 4326)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ST_SetSRID(ST_GeomFromText(
    'POLYGON((' ||
      '127.00207016760595 37.56942201832359,' ||
      '127.00250680683126 37.56312008669376,' ||
      '127.01025715308094 37.56456222335288,' ||
      '127.01083933871473 37.561346220316494,' ||
      '127.01635190893501 37.55926944503618,' ||
      '127.01815304573904 37.56020688548976,' ||
      '127.02011792225403 37.55983191072417,' ||
      '127.0217735126497 37.5607837660602,' ||
      '127.02384754896832 37.56066839030345,' ||
      '127.02426599489331 37.56185098334076,' ||
      '127.02404767528179 37.56300471455499,' ||
      '127.02437515469921 37.56395652935598,' ||
      '127.02357464945379 37.56535538661541,' ||
      '127.02335632984011 37.57139757132737,' ||
      '127.02097300740223 37.571714808533045,' ||
      '127.0191172906953 37.57082077294673,' ||
      '127.01751628020247 37.57004208804749,' ||
      '127.01589707640937 37.56958064130234,' ||
      '127.00965677414695 37.56960948180722,' ||
      '127.00660029956987 37.56946527916935,' ||
      '127.00207016760595 37.56942201832359' ||
    '))'
  ), 4326);
$$;

COMMENT ON FUNCTION sindang_area() IS '신당동 조사 영역 폴리곤 (EPSG:4326, 21 vertices). 좌표는 src/gis/data/sindang-survey-area.json 와 동기.';


-- ────────────────────────────────────────────────────────────
-- 2) survey_buildings_in_area()
--    영역 내 건물 + 각 건물의 조사 통계.
--    SurveyPage 가 이걸로 지도 렌더링 (어떤 건물이 조사됐는지 색 구분).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION survey_buildings_in_area()
RETURNS TABLE (
  id                  BIGINT,
  pnu                 VARCHAR(19),
  bld_nm              TEXT,
  main_purps          TEXT,
  vl_rat              NUMERIC,
  geom                JSONB,
  survey_count        BIGINT,    -- pending + approved + rejected 모두
  approved_count      BIGINT,    -- status='approved' 만
  has_curated         BOOLEAN    -- curated_buildings 에 정제 row 존재 여부
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    b.pnu,
    b.bld_nm,
    b.main_purps,
    b.vl_rat,
    ST_AsGeoJSON(b.geom)::jsonb AS geom,
    COALESCE(s.survey_count,    0)::bigint AS survey_count,
    COALESCE(s.approved_count,  0)::bigint AS approved_count,
    (cb.id IS NOT NULL)                    AS has_curated
  FROM buildings b
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)                                                  AS survey_count,
      COUNT(*) FILTER (WHERE fs.status = 'approved')            AS approved_count
    FROM field_surveys fs
    WHERE fs.survey_type = 'building'
      AND (fs.building_id = b.id OR fs.building_pnu = b.pnu)
  ) s ON true
  LEFT JOIN curated_buildings cb
    ON (cb.building_id = b.id OR cb.building_pnu = b.pnu)
  WHERE ST_Intersects(b.geom, sindang_area())
$$;

COMMENT ON FUNCTION survey_buildings_in_area() IS '신당동 영역 내 건물 + 조사 통계. SurveyPage 지도 렌더링용. SECURITY DEFINER 로 anon 호출 허용.';


-- ────────────────────────────────────────────────────────────
-- 3) pending_surveys(p_limit, p_offset, p_type)
--    관리자 페이지의 미검토 목록.
--    p_type 이 NULL 이면 전체 / 'building'/'road'/'point' 로 필터.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pending_surveys(
  p_limit  INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_type   TEXT    DEFAULT NULL
)
RETURNS TABLE (
  id            UUID,
  survey_type   TEXT,
  location      JSONB,
  building_id   BIGINT,
  building_pnu  TEXT,
  payload       JSONB,
  memo          TEXT,
  photo_paths   TEXT[],
  status        TEXT,
  created_at    TIMESTAMPTZ,
  total_count   BIGINT      -- 페이지네이션용 (필터 적용된 전체 건수)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT *
    FROM field_surveys
    WHERE status = 'pending'
      AND (p_type IS NULL OR survey_type = p_type)
  ),
  total AS (
    SELECT COUNT(*) AS total_count FROM filtered
  )
  SELECT
    f.id,
    f.survey_type,
    ST_AsGeoJSON(f.location)::jsonb AS location,
    f.building_id,
    f.building_pnu,
    f.payload,
    f.memo,
    f.photo_paths,
    f.status,
    f.created_at,
    t.total_count
  FROM filtered f
  CROSS JOIN total t
  ORDER BY f.created_at DESC
  LIMIT  GREATEST(p_limit, 0)
  OFFSET GREATEST(p_offset, 0)
$$;

COMMENT ON FUNCTION pending_surveys(INTEGER, INTEGER, TEXT) IS '미검토(pending) 조사 목록 페이지네이션. p_type 으로 building/road/point 필터.';


-- ────────────────────────────────────────────────────────────
-- 4) survey_progress()
--    조사 진행률 통계.
--      - in_area_total       : 신당동 영역 내 건물 총수
--      - surveyed_buildings  : 조사 row 가 1 개 이상 들어온 distinct 건물 수 (status 무관)
--      - approved_buildings  : curated_buildings 에 들어간 distinct 건물 수
--      - by_day              : 최근 30 일 일자별 입력 건수 (status 별 분리)
-- ────────────────────────────────────────────────────────────
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
      (SELECT COUNT(*) FROM field_surveys WHERE status='rejected') AS rejected_total
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
    'in_area_total',       (SELECT in_area_total      FROM totals),
    'surveyed_buildings',  (SELECT surveyed_buildings FROM totals),
    'approved_buildings',  (SELECT approved_buildings FROM totals),
    'pending_total',       (SELECT pending_total      FROM totals),
    'approved_total',      (SELECT approved_total     FROM totals),
    'rejected_total',      (SELECT rejected_total     FROM totals),
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

COMMENT ON FUNCTION survey_progress() IS '조사 진행률 통계: 영역 내 건물 대비 조사/승인 비율 + 최근 30일 일자별 추이.';


-- ────────────────────────────────────────────────────────────
-- 5) RPC 권한
-- ────────────────────────────────────────────────────────────

-- sindang_area() 는 다른 함수에서 호출되므로 anon 도 EXECUTE 필요.
GRANT EXECUTE ON FUNCTION sindang_area()                 TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION survey_buildings_in_area()     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pending_surveys(INTEGER, INTEGER, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION survey_progress()              TO anon, authenticated, service_role;
