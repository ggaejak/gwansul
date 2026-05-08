-- ============================================================
-- Migration: 00010_create_curated_rpc
-- Order:     10 (Phase A — Step A2 보강)
-- Purpose:   curated_* 테이블 read 전용 RPC 3 종.
--            geometry 컬럼을 PostgREST 가 자동으로 EWKB hex 로 직렬화하는
--            문제를 회피하기 위해 ST_AsGeoJSON 으로 변환된 jsonb 반환.
--            buildings.js / zoning.js 와 동일한 RPC + adapter 패턴.
--
--            (1) fetch_curated_buildings()  — buildings 와 LEFT JOIN, 폴리곤 포함
--            (2) fetch_curated_roads()      — Point geom + 속성
--            (3) fetch_curated_points()     — Point geom + 카테고리
--
--            anon 도 호출 가능. 기본 SECURITY INVOKER (anon SELECT 권한 이미 있음).
--            STABLE — 같은 트랜잭션 내 결과 일관.
--
-- Verification (실행 후 Supabase SQL Editor):
--   -- (1) 함수 존재
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('fetch_curated_buildings','fetch_curated_roads','fetch_curated_points')
--   ORDER BY proname;
--
--   -- (2) 빈 상태 호출 (에러 안 나야)
--   SELECT * FROM fetch_curated_buildings() LIMIT 1;
--   SELECT * FROM fetch_curated_roads()     LIMIT 1;
--   SELECT * FROM fetch_curated_points()    LIMIT 1;
--
--   -- (3) anon EXECUTE 권한
--   SELECT routine_name, grantee, privilege_type
--   FROM information_schema.routine_privileges
--   WHERE routine_name IN ('fetch_curated_buildings','fetch_curated_roads','fetch_curated_points')
--     AND grantee = 'anon'
--   ORDER BY routine_name;
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1) fetch_curated_buildings()
--    curated_buildings + buildings 조인. building_id 우선,
--    없으면 building_pnu 매칭 (폴리곤 1 개만 — pnu 중복 시 임의 1 개).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fetch_curated_buildings()
RETURNS TABLE (
  curated_id        BIGINT,
  building_id       BIGINT,
  building_pnu      TEXT,
  bld_nm            TEXT,
  main_purps        TEXT,
  geom              JSONB,        -- 건물 폴리곤 GeoJSON
  first_floor_use   TEXT,
  is_vacant         BOOLEAN,
  photo_paths       TEXT[],
  admin_memo        TEXT,
  approved_at       TIMESTAMPTZ,
  source_count      INTEGER       -- 정제에 사용된 raw 조사 수
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    cb.id                                AS curated_id,
    cb.building_id,
    cb.building_pnu,
    b.bld_nm,
    b.main_purps,
    CASE WHEN b.geom IS NULL THEN NULL
         ELSE ST_AsGeoJSON(b.geom)::jsonb
    END                                  AS geom,
    cb.first_floor_use,
    cb.is_vacant,
    cb.photo_paths,
    cb.admin_memo,
    cb.approved_at,
    COALESCE(array_length(cb.source_survey_ids, 1), 0) AS source_count
  FROM curated_buildings cb
  LEFT JOIN LATERAL (
    SELECT bld_nm, main_purps, geom
    FROM buildings
    WHERE id = cb.building_id
       OR pnu = cb.building_pnu
    LIMIT 1
  ) b ON true
$$;

COMMENT ON FUNCTION fetch_curated_buildings() IS '정제된 건물 데이터 + buildings 폴리곤 조인 (대시보드 표시용).';


-- ────────────────────────────────────────────────────────────
-- 2) fetch_curated_roads() — 도로 점 조사
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fetch_curated_roads()
RETURNS TABLE (
  id                BIGINT,
  location          JSONB,
  night_brightness  TEXT,
  road_width        TEXT,
  photo_paths       TEXT[],
  admin_memo        TEXT,
  approved_at       TIMESTAMPTZ,
  source_count      INTEGER
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    id,
    ST_AsGeoJSON(location)::jsonb AS location,
    night_brightness,
    road_width,
    photo_paths,
    admin_memo,
    approved_at,
    COALESCE(array_length(source_survey_ids, 1), 0) AS source_count
  FROM curated_roads
$$;

COMMENT ON FUNCTION fetch_curated_roads() IS '정제된 도로 점 조사 데이터 (야간 밝기, 도로 폭).';


-- ────────────────────────────────────────────────────────────
-- 3) fetch_curated_points() — 일반 점 조사
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fetch_curated_points()
RETURNS TABLE (
  id                BIGINT,
  location          JSONB,
  category          TEXT,
  photo_paths       TEXT[],
  admin_memo        TEXT,
  approved_at       TIMESTAMPTZ,
  source_count      INTEGER
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT
    id,
    ST_AsGeoJSON(location)::jsonb AS location,
    category,
    photo_paths,
    admin_memo,
    approved_at,
    COALESCE(array_length(source_survey_ids, 1), 0) AS source_count
  FROM curated_points
$$;

COMMENT ON FUNCTION fetch_curated_points() IS '정제된 일반 점 조사 데이터 (화장실/흡연/소음/냄새/기타).';


-- ────────────────────────────────────────────────────────────
-- 4) 권한
-- ────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION fetch_curated_buildings() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION fetch_curated_roads()     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION fetch_curated_points()    TO anon, authenticated, service_role;
