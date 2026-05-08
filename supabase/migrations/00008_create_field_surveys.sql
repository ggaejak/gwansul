-- ============================================================
-- Migration: 00008_create_field_surveys
-- Order:     8 (Phase A — 현장 조사 시스템 첫 번째)
-- Purpose:   메달리언 아키텍처 기반 현장 조사 데이터 저장 구조 생성.
--
--            Raw layer    : field_surveys           (조사원 원시 입력, 절대 수정 금지)
--            Curated layer: curated_buildings       (관리자 정제 — 1 건물 = 1 row)
--                           curated_roads           (관리자 정제 — 도로 점 조사)
--                           curated_points          (관리자 정제 — 일반 점 조사)
--
--            원시 → 정제는 단방향. 대시보드는 curated_* 만 조회.
--            field_surveys.status 만 admin 이 갱신 (pending → approved/rejected),
--            그 외 raw 컬럼은 INSERT 후 변경하지 않는 것이 원칙.
--
-- 결정사항 (Step A1 사전 합의):
--   Q1: 조사원 식별 안 함 (익명). surveyor_name 컬럼 없음.
--   Q2: 건물 참조는 building_id BIGINT (nullable, FK 강제 안 함)
--       + building_pnu TEXT 양쪽 모두 저장.
--   Q4: 1 건물 = 1 curated_buildings row. source_survey_ids uuid[] 로 추적.
--   Q5: photo_paths 는 Supabase Storage 의 객체 경로 (URL 아님).
--       경로 컨벤션: {yyyy-mm}/{survey_id}_{idx}.jpg  (Phase B 에서 강제)
--   Q6: status enum 3 종 (pending / approved / rejected)
--
-- Verification (실행 후 Supabase SQL Editor):
--   -- (1) 테이블 4 개 존재
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema='public'
--     AND table_name IN ('field_surveys','curated_buildings','curated_roads','curated_points')
--   ORDER BY table_name;
--
--   -- (2) field_surveys 컬럼
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name='field_surveys' ORDER BY ordinal_position;
--
--   -- (3) 인덱스
--   SELECT tablename, indexname FROM pg_indexes
--   WHERE tablename IN ('field_surveys','curated_buildings','curated_roads','curated_points')
--   ORDER BY tablename, indexname;
--
--   -- (4) RLS 활성화
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname IN ('field_surveys','curated_buildings','curated_roads','curated_points');
--   -- 모두 true
--
--   -- (5) 정책
--   SELECT tablename, policyname, cmd, roles
--   FROM pg_policies
--   WHERE tablename IN ('field_surveys','curated_buildings','curated_roads','curated_points')
--   ORDER BY tablename, policyname;
--
--   -- (6) 빈 테이블
--   SELECT
--     (SELECT COUNT(*) FROM field_surveys)      AS field_surveys,
--     (SELECT COUNT(*) FROM curated_buildings)  AS curated_buildings,
--     (SELECT COUNT(*) FROM curated_roads)      AS curated_roads,
--     (SELECT COUNT(*) FROM curated_points)     AS curated_points;
--   -- 모두 0
-- ============================================================

-- ─── pgcrypto: gen_random_uuid() 의존 ─────────────────────────
-- (대부분의 Supabase 프로젝트에서 이미 활성화되어 있음. 안전망)
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ────────────────────────────────────────────────────────────
-- 1) field_surveys — Raw layer
-- ────────────────────────────────────────────────────────────
CREATE TABLE field_surveys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  survey_type     TEXT NOT NULL
                  CHECK (survey_type IN ('building','road','point')),

  -- 모바일에서 사용자가 탭한 좌표 (모든 survey_type 공통).
  -- 건물 조사도 좌표 보존 (해당 건물 폴리곤 내부 어디를 탭했는지 추적용).
  location        GEOMETRY(Point, 4326) NOT NULL,

  -- 건물 조사 전용 (survey_type='building' 일 때만 채움).
  -- pnu 는 buildings 테이블에 중복(다중 건물 1 필지) 가능 → id 와 병행.
  -- FK 강제 X: 정적 GeoJSON 모드 호환 + buildings 재적재 시 dangling 방지.
  building_id     BIGINT,
  building_pnu    TEXT,

  -- 가변 입력 필드 (survey_type 에 따라 키 집합이 다름).
  --   building : { first_floor_use, is_vacant }
  --   road     : { night_brightness, road_width }
  --   point    : { category }
  -- 1 차 MVP 는 클라이언트 신뢰 — 서버 CHECK 없음.
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,

  memo            TEXT,

  -- Storage 의 객체 경로 배열. URL 아님. 클라이언트가 createSignedUrl 또는
  -- public bucket 의 getPublicUrl 로 변환해 표시.
  photo_paths     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  reject_reason   TEXT,
  reviewed_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- survey_type 일관성 안전망.
  CONSTRAINT field_surveys_building_ref_chk CHECK (
    (survey_type = 'building' AND building_pnu IS NOT NULL)
    OR survey_type IN ('road','point')
  ),
  -- reject 시 사유 필수.
  CONSTRAINT field_surveys_reject_reason_chk CHECK (
    status <> 'rejected' OR reject_reason IS NOT NULL
  )
);

CREATE INDEX field_surveys_geom_idx        ON field_surveys USING GIST (location);
CREATE INDEX field_surveys_status_idx      ON field_surveys (status);
CREATE INDEX field_surveys_type_idx        ON field_surveys (survey_type);
CREATE INDEX field_surveys_building_id_idx ON field_surveys (building_id);
CREATE INDEX field_surveys_pnu_idx         ON field_surveys (building_pnu);
CREATE INDEX field_surveys_created_idx     ON field_surveys (created_at DESC);

COMMENT ON TABLE  field_surveys IS '현장 조사 원시(raw) 데이터. 메달리언 raw layer. status 외 컬럼은 INSERT 후 수정 금지가 원칙.';
COMMENT ON COLUMN field_surveys.location     IS '조사원이 탭한 EPSG:4326 좌표. 모든 survey_type 공통.';
COMMENT ON COLUMN field_surveys.building_id  IS 'buildings.id 참조용(nullable). FK 강제하지 않음 — 정적 GeoJSON 모드 호환.';
COMMENT ON COLUMN field_surveys.building_pnu IS '필지식별번호. survey_type=building 일 때 항상 저장.';
COMMENT ON COLUMN field_surveys.payload      IS 'survey_type 별 가변 필드. building:{first_floor_use,is_vacant} road:{night_brightness,road_width} point:{category}';
COMMENT ON COLUMN field_surveys.photo_paths  IS 'Supabase Storage(survey-photos 버킷) 객체 경로 배열. URL 아님.';


-- ────────────────────────────────────────────────────────────
-- 2) curated_buildings — Curated layer (1 건물 = 1 row 원칙)
-- ────────────────────────────────────────────────────────────
-- pnu 가 buildings 에서 중복 가능하지만, 정제 단계에서는 admin 책임 하에
-- 1 건물 = 1 row 를 application-level 로 보장 (DB UNIQUE 강제 안 함 —
-- multi-building 필지를 admin 이 통합 정제할 자유 부여).
CREATE TABLE curated_buildings (
  id                BIGSERIAL PRIMARY KEY,

  building_id       BIGINT,        -- buildings.id (nullable, no FK)
  building_pnu      TEXT NOT NULL, -- 가독성 + 정적 모드 호환

  -- enum 후보값:
  --   restaurant | cafe | convenience | beauty | medical | academy
  --   | office | residential | vacant | etc
  first_floor_use   TEXT,
  is_vacant         BOOLEAN,

  photo_paths       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  admin_memo        TEXT,

  -- 이 정제 row 의 근거가 된 field_surveys.id 모음.
  -- 같은 건물에 새 조사가 들어오면 admin 이 이 배열에 append.
  source_survey_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],

  approved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX curated_buildings_bid_idx     ON curated_buildings (building_id);
CREATE INDEX curated_buildings_pnu_idx     ON curated_buildings (building_pnu);
CREATE INDEX curated_buildings_sources_idx ON curated_buildings USING GIN (source_survey_ids);
CREATE INDEX curated_buildings_use_idx     ON curated_buildings (first_floor_use);

COMMENT ON TABLE  curated_buildings IS '관리자 정제 건물 데이터. 1 건물 = 1 row 원칙(application-level). 대시보드 표시용.';
COMMENT ON COLUMN curated_buildings.source_survey_ids IS '근거가 된 field_surveys.id 배열. 통합 정제 추적.';


-- ────────────────────────────────────────────────────────────
-- 3) curated_roads — Curated layer (도로 점 조사)
-- ────────────────────────────────────────────────────────────
CREATE TABLE curated_roads (
  id                BIGSERIAL PRIMARY KEY,
  location          GEOMETRY(Point, 4326) NOT NULL,

  -- 'dark' | 'normal' | 'bright'
  night_brightness  TEXT,
  -- 'no_vehicle' | 'lane_1' | 'lane_2_plus' | 'main_road'
  road_width        TEXT,

  photo_paths       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  admin_memo        TEXT,
  source_survey_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  approved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX curated_roads_geom_idx       ON curated_roads USING GIST (location);
CREATE INDEX curated_roads_brightness_idx ON curated_roads (night_brightness);
CREATE INDEX curated_roads_sources_idx    ON curated_roads USING GIN (source_survey_ids);

COMMENT ON TABLE curated_roads IS '관리자 정제 도로 점 조사 데이터. 야간 밝기/도로 폭. 대시보드 표시용.';


-- ────────────────────────────────────────────────────────────
-- 4) curated_points — Curated layer (일반 점 조사)
-- ────────────────────────────────────────────────────────────
CREATE TABLE curated_points (
  id                BIGSERIAL PRIMARY KEY,
  location          GEOMETRY(Point, 4326) NOT NULL,

  -- 'public_toilet' | 'smoking_area' | 'noise_spot' | 'odor_spot' | 'other'
  category          TEXT NOT NULL,

  photo_paths       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  admin_memo        TEXT,
  source_survey_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  approved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX curated_points_geom_idx     ON curated_points USING GIST (location);
CREATE INDEX curated_points_category_idx ON curated_points (category);
CREATE INDEX curated_points_sources_idx  ON curated_points USING GIN (source_survey_ids);

COMMENT ON TABLE curated_points IS '관리자 정제 일반 점 조사 데이터. 카테고리별(화장실/흡연/소음/냄새/기타). 대시보드 표시용.';


-- ────────────────────────────────────────────────────────────
-- 5) GRANT (Phase 1/2 교훈 — 명시적 권한 부여)
-- ────────────────────────────────────────────────────────────

-- field_surveys: 익명 조사원이 INSERT 가능해야 함. SELECT/UPDATE/DELETE 는 차단.
--                관리자 화면(SurveyAdminPage) 은 service_role 키 사용.
GRANT INSERT                              ON field_surveys TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE      ON field_surveys TO service_role;
GRANT USAGE                               ON SCHEMA public TO anon, authenticated;
-- field_surveys.id 는 UUID DEFAULT 라 sequence 없음.

-- curated_*: anon SELECT 허용 (대시보드 표시), 변경은 service_role 만.
GRANT SELECT                              ON curated_buildings TO anon, authenticated;
GRANT SELECT                              ON curated_roads     TO anon, authenticated;
GRANT SELECT                              ON curated_points    TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE      ON curated_buildings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE      ON curated_roads     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE      ON curated_points    TO service_role;
GRANT USAGE, SELECT ON SEQUENCE curated_buildings_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE curated_roads_id_seq     TO service_role;
GRANT USAGE, SELECT ON SEQUENCE curated_points_id_seq    TO service_role;


-- ────────────────────────────────────────────────────────────
-- 6) RLS
-- ────────────────────────────────────────────────────────────

-- field_surveys: anon 은 INSERT 만, SELECT/UPDATE/DELETE 차단.
--                대시보드/관리자 SELECT 는 RPC(SECURITY DEFINER) 또는 service_role.
ALTER TABLE field_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_insert_field_surveys
  ON field_surveys
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (status = 'pending');   -- 신규 입력은 항상 pending. 위변조 차단.

-- SELECT/UPDATE/DELETE 정책 미생성 → RLS 기본 거부.
-- service_role 은 RLS 우회 + 위 GRANT 보유 → 모든 작업 가능.


-- curated_*: 공개 데이터 — anon SELECT 만 허용.
ALTER TABLE curated_buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE curated_roads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE curated_points    ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_curated_buildings
  ON curated_buildings FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY anon_read_curated_roads
  ON curated_roads FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY anon_read_curated_points
  ON curated_points FOR SELECT TO anon, authenticated USING (true);
