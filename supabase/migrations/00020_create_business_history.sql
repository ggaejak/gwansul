-- ============================================================
-- Migration: 00020_create_business_history
-- Order:     20 (00019 이후)
-- Purpose:   서울 열린데이터광장 일반음식점 인허가 기반 영업 이력 테이블.
--            답사영역(좌표 기반)에 들어오는 음식점만 적재.
--            한 건물에 시기별로 여러 음식점이 존재하는 게 정상이므로
--            (building_pnu, business_name, opened_at) 조합도 unique 강제 X.
--
--            좌표계: 원본 EPSG:2097 (한국 중부원점) → ETL 에서 EPSG:4326 변환.
--            buildings 와 동일하게 geom 은 4326.
--
--            building_id / building_pnu 매칭 전략 (ETL 측):
--              1) 지번주소 정규화 후 buildings.pnu 직접 매칭
--              2) 실패 시 좌표 기반 공간 매칭 (ST_Contains, 가장 가까운 건물)
--              3) 둘 다 실패해도 좌표만 저장 (building_id/pnu NULL)
--            FK 는 강제하지 않음 (buildings 적재 시점·범위가 달라질 수 있음).
--
--            영업장면적 컬럼은 원본 CSV 컬럼명("소재지면적") 기준으로 site_area_m2.
--
-- Verification (실행 후):
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'business_history'
--   ORDER BY ordinal_position;
--
--   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'business_history';
--   -- 기대: pkey, geom(GIST), building_pnu, building_id, status, opened_at
--
--   SELECT COUNT(*) FROM business_history;  -- 0
-- ============================================================

CREATE TABLE business_history (
  id              BIGSERIAL PRIMARY KEY,
  business_name   TEXT        NOT NULL,                 -- 사업장명
  business_type   TEXT,                                 -- 업태구분명 (한식/분식/카페 등)
  opened_at       DATE,                                 -- 인허가일자
  closed_at       DATE,                                 -- 폐업일자 (영업 중이면 NULL)
  status          TEXT        NOT NULL,                 -- '영업/정상' | '폐업' (원본 영업상태명)
  building_id     BIGINT,                               -- buildings.id (FK 미강제, nullable)
  building_pnu    VARCHAR(19),                          -- buildings.pnu (사람이 읽기 쉬움, nullable)
  jibun_address   TEXT        NOT NULL,                 -- 원본 지번주소
  road_address    TEXT,                                 -- 도로명주소 (옛 데이터는 빈값)
  geom            GEOMETRY(Point, 4326) NOT NULL,       -- 좌표 필수 (답사영역 필터로 보장)
  site_area_m2    NUMERIC,                              -- 소재지면적(㎡). 0 이면 ETL 에서 NULL 치환
  data_source     TEXT        NOT NULL,                 -- 'seoul_restaurants_YYYYMMDD'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX business_history_geom_idx         ON business_history USING GIST (geom);
CREATE INDEX business_history_building_pnu_idx ON business_history (building_pnu);
CREATE INDEX business_history_building_id_idx  ON business_history (building_id);
CREATE INDEX business_history_status_idx       ON business_history (status);
CREATE INDEX business_history_opened_at_idx    ON business_history (opened_at);

COMMENT ON TABLE  business_history IS
  '서울 일반음식점 인허가 기반 건물별 업종 이력. 답사영역 좌표 폴리곤 내부만 적재.';
COMMENT ON COLUMN business_history.status        IS '원본 영업상태명. 현재 데이터셋은 ''영업/정상'' / ''폐업'' 두 값만 존재';
COMMENT ON COLUMN business_history.building_pnu  IS 'ETL 매칭 결과. NULL 이면 좌표는 있으나 buildings 매칭 실패';
COMMENT ON COLUMN business_history.site_area_m2  IS '원본 CSV 의 "소재지면적". 0 또는 빈값은 NULL 치환';
COMMENT ON COLUMN business_history.data_source   IS 'seoul_restaurants_YYYYMMDD 형식';

-- RLS: anon SELECT only, ETL 은 service_role 로 우회
ALTER TABLE business_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_business_history
  ON business_history
  FOR SELECT
  TO anon, authenticated
  USING (true);
