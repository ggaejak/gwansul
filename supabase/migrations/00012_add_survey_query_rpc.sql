-- ============================================================
-- Migration: 00012_add_survey_query_rpc
-- Order:     12 (Phase B Step B0 — 조사 데이터 조회 RPC)
-- Purpose:   조사 데이터 조회 RPC 2 종.
--
--            (1) fetch_surveys_in_area(p_status, p_type)
--                신당동 영역 내 조사 전체를 GeoJSON FeatureCollection 으로 반환.
--                지도 마커 렌더링용 — SurveyPage 가 호출.
--                필터: status (NULL=전체), type (NULL=전체).
--
--            (2) fetch_survey_by_id(p_id)
--                단건 조회 — 마커 클릭 / 수정 폼 prefill.
--                Feature 단일 객체 반환 (없으면 NULL).
--
--            두 함수 모두 SECURITY INVOKER (00011 에서 anon SELECT 가
--            이미 허용됐으므로 SECURITY DEFINER 불필요).
--            geometry 직렬화 일관성을 위해 RPC 채택 — PostgREST 직접 SELECT 시
--            EWKB hex 가 반환되는 문제 회피.
--
-- Verification (실행 후 Supabase SQL Editor):
--   -- (1) 함수 존재
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('fetch_surveys_in_area','fetch_survey_by_id')
--   ORDER BY proname;
--
--   -- (2) 빈 상태 호출
--   SELECT fetch_surveys_in_area(NULL, NULL);
--   -- 기대: {"type":"FeatureCollection","features":[]}
--
--   SELECT fetch_survey_by_id('00000000-0000-0000-0000-000000000000'::uuid);
--   -- 기대: NULL
--
--   -- (3) anon EXECUTE 권한
--   SELECT routine_name, grantee
--   FROM information_schema.routine_privileges
--   WHERE routine_name IN ('fetch_surveys_in_area','fetch_survey_by_id')
--     AND grantee = 'anon'
--   ORDER BY routine_name;
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1) fetch_surveys_in_area(p_status, p_type)
--    신당동 영역 내 조사 전체 → FeatureCollection JSONB.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fetch_surveys_in_area(
  p_status TEXT DEFAULT NULL,
  p_type   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'type',     'Feature',
          'geometry', ST_AsGeoJSON(fs.location)::jsonb,
          'properties', jsonb_build_object(
            'id',            fs.id,
            'survey_type',   fs.survey_type,
            'building_id',   fs.building_id,
            'building_pnu',  fs.building_pnu,
            'payload',       fs.payload,
            'memo',          fs.memo,
            'photo_paths',   fs.photo_paths,
            'status',        fs.status,
            'reject_reason', fs.reject_reason,
            'created_at',    fs.created_at,
            'updated_at',    fs.updated_at
          )
        )
        ORDER BY fs.created_at DESC
      ),
      '[]'::jsonb
    )
  )
  FROM field_surveys fs
  WHERE ST_Intersects(fs.location, sindang_area())
    AND (p_status IS NULL OR fs.status      = p_status)
    AND (p_type   IS NULL OR fs.survey_type = p_type)
$$;

COMMENT ON FUNCTION fetch_surveys_in_area(TEXT, TEXT)
  IS '신당동 영역 내 조사 전체 → GeoJSON FeatureCollection. 지도 마커 렌더링용. status/type 필터 지원.';


-- ────────────────────────────────────────────────────────────
-- 2) fetch_survey_by_id(p_id)
--    단건 조회 — 수정 폼 prefill / 상세 모달.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fetch_survey_by_id(p_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT jsonb_build_object(
    'type', 'Feature',
    'geometry', ST_AsGeoJSON(fs.location)::jsonb,
    'properties', jsonb_build_object(
      'id',            fs.id,
      'survey_type',   fs.survey_type,
      'building_id',   fs.building_id,
      'building_pnu',  fs.building_pnu,
      'payload',       fs.payload,
      'memo',          fs.memo,
      'photo_paths',   fs.photo_paths,
      'status',        fs.status,
      'reject_reason', fs.reject_reason,
      'created_at',    fs.created_at,
      'updated_at',    fs.updated_at
    )
  )
  FROM field_surveys fs
  WHERE fs.id = p_id
$$;

COMMENT ON FUNCTION fetch_survey_by_id(UUID)
  IS '조사 단건 조회 → GeoJSON Feature. 마커 클릭 / 수정 폼 prefill 용. 없으면 NULL.';


-- ────────────────────────────────────────────────────────────
-- 3) 권한
-- ────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION fetch_surveys_in_area(TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION fetch_survey_by_id(UUID)          TO anon, authenticated, service_role;
