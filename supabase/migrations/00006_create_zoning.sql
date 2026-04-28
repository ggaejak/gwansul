-- ============================================================
-- Migration: 00006_create_zoning
-- Order:     6 (Phase 2 첫 번째)
-- Purpose:   용도지역(zoning) 테이블 생성.
--            - PostGIS GEOMETRY(Geometry, 4326): Polygon/MultiPolygon 혼재 대응
--            - district_code, data_source, updated_at 메타필드
--            - GIST 공간 인덱스 + 보조 인덱스
--            - service_role / anon 권한 명시 (Phase 1 교훈)
--            - RLS 활성화 + anon SELECT 정책
--
--            클라이언트가 turf.booleanIntersects 로 했던 작업을
--            PostGIS ST_Intersects 로 대체하기 위한 기반 테이블.
--            RPC 정의는 00007 에서 별도.
--
--            결측값 처리 (ETL 측 규칙):
--              - dgm_ar 의 0 은 결측 의미 → ETL 에서 NULL 치환
--              - source_district 빈값 → NULL
--              - 그 외 컬럼은 원본 값 그대로
--
-- Verification (실행 후 Supabase SQL Editor):
--   -- (1) 테이블 컬럼 확인
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'zoning' ORDER BY ordinal_position;
--
--   -- (2) 인덱스 확인 (geom GIST + 보조 2개 + pkey)
--   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'zoning';
--
--   -- (3) GRANT 확인
--   SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_name = 'zoning'
--   ORDER BY grantee, privilege_type;
--   -- 기대: anon=SELECT, authenticated=SELECT,
--   --       service_role=SELECT/INSERT/UPDATE/DELETE
--
--   -- (4) RLS 활성화 확인
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'zoning';
--   -- true
--
--   -- (5) 정책 확인
--   SELECT policyname, cmd, roles
--   FROM pg_policies WHERE tablename = 'zoning';
--   -- 'anon_read_zoning' SELECT {anon, authenticated}
--
--   -- (6) 빈 테이블
--   SELECT COUNT(*) FROM zoning;  -- 0
-- ============================================================

CREATE TABLE zoning (
  id              BIGSERIAL PRIMARY KEY,
  district_code   VARCHAR(5)  NOT NULL,                 -- '11140' 중구 등 (미래 확장)
  zone_name       TEXT        NOT NULL,                 -- 원본 '용도지역명' (예: 제3종일반주거지역)
  atrb_se         VARCHAR(10),                          -- 원본 'ATRB_SE' 코드 (UQA123 등)
  dgm_ar          NUMERIC,                              -- 원본 'DGM_AR' 면적. 0 → NULL (ETL)
  source_district TEXT,                                 -- 원본 '구이름' (경계 걸친 폴리곤용)
  geom            GEOMETRY(Geometry, 4326) NOT NULL,    -- Polygon | MultiPolygon
  data_source     TEXT NOT NULL,                        -- 'seoul_zoning_YYYYMMDD'
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX zoning_geom_idx     ON zoning USING GIST (geom);
CREATE INDEX zoning_district_idx ON zoning (district_code);
CREATE INDEX zoning_zone_idx     ON zoning (zone_name);

-- ─── 권한 (Phase 1 교훈 반영) ─────────────────────────────────
-- service_role 은 RLS 우회하지만, 일부 환경에서 row/sequence 권한이
-- 명시되지 않으면 INSERT 시 permission denied 발생. 명시적 GRANT.
GRANT SELECT, INSERT, UPDATE, DELETE ON zoning TO service_role;
GRANT USAGE, SELECT ON SEQUENCE zoning_id_seq TO service_role;

-- 공개 데이터 → anon/authenticated 도 읽기 허용 (RLS 와 별개의 GRANT 레이어)
GRANT SELECT ON zoning TO anon, authenticated;

-- ─── RLS ─────────────────────────────────────────────────────
ALTER TABLE zoning ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_zoning
  ON zoning
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- INSERT/UPDATE/DELETE 정책 미생성 → RLS 기본 거부.
-- service_role 은 RLS 우회 + GRANT 보유 → 적재 가능.

-- ─── 메타 ────────────────────────────────────────────────────
COMMENT ON TABLE  zoning            IS '서울 용도지역(land use zoning) 폴리곤. 최초 적재는 land_use_junggu.geojson 기반.';
COMMENT ON COLUMN zoning.zone_name  IS '원본 ''용도지역명''. 예: 제3종일반주거지역, 일반상업지역, 기타 등';
COMMENT ON COLUMN zoning.dgm_ar     IS '대장면적(㎡). 원본 0 은 결측 의미이므로 ETL 에서 NULL 치환';
COMMENT ON COLUMN zoning.geom       IS 'EPSG:4326. Polygon 또는 MultiPolygon (원본 데이터 혼재 가능성 대비)';
COMMENT ON COLUMN zoning.data_source IS '{source}_{dataset}_{YYYYMMDD} 형식. 예: seoul_zoning_20260407';
