-- ============================================================
-- Migration: 00002_create_buildings
-- Order:     2 (00001 이후)
-- Purpose:   buildings 테이블 및 공간/보조 인덱스 생성.
--            스키마는 docs/backend-migration-plan.md §5.2 그대로 반영.
--            좌표계는 EPSG:4326 (WGS84 lng/lat).
--
--            결측값 처리 원칙 (ETL 측 규칙):
--              - 원본 vlRat/bcRat/platArea/archArea/totArea/grndFlrCnt/
--                ugrndFlrCnt 가 0 이면 DB에는 NULL 로 저장
--              - 원본 useAprDay 가 '' 또는 파싱 불가면 NULL
--              - 원본 bldNm 이 '' 이면 NULL
--            (이 치환은 ETL 스크립트에서 수행. 스키마는 NULL 허용만 보장)
--
-- Verification (실행 후):
--   -- (1) 테이블/컬럼 구조 확인
--   \d buildings   -- psql 환경
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'buildings'
--   ORDER BY ordinal_position;
--
--   -- (2) 인덱스 4개 생성 확인
--   SELECT indexname, indexdef
--   FROM pg_indexes WHERE tablename = 'buildings';
--   -- 기대: buildings_pkey, buildings_pnu_key (UNIQUE),
--   --       buildings_geom_idx (GIST),
--   --       buildings_district_idx, buildings_bjdong_idx,
--   --       buildings_use_apr_idx
--
--   -- (3) 빈 테이블 카운트
--   SELECT COUNT(*) FROM buildings;  -- 0
-- ============================================================

CREATE TABLE buildings (
  id              BIGSERIAL PRIMARY KEY,
  pnu             VARCHAR(19) UNIQUE NOT NULL,  -- 필지식별번호
  district_code   VARCHAR(5)  NOT NULL,         -- '11140' = 중구 (미래 타구 확장)
  bjdong_cd       VARCHAR(5),                   -- 법정동 코드
  address         TEXT,
  bld_nm          TEXT,                         -- NULL if 원본 ''
  reg_type        VARCHAR(10),                  -- '일반' | '집합'
  main_purps      TEXT,                         -- 주용도
  strct           TEXT,                         -- 구조
  arch_area       NUMERIC,                      -- 건축면적 (NULL if 결측)
  tot_area        NUMERIC,                      -- 연면적
  plat_area       NUMERIC,                      -- 대지면적 (NULL if 결측)
  bc_rat          NUMERIC,                      -- 건폐율 (NULL if 결측)
  vl_rat          NUMERIC,                      -- 용적률 (NULL if 결측)
  grnd_flr_cnt    SMALLINT,                     -- 지상층수 (NULL if 결측)
  ugrnd_flr_cnt   SMALLINT,                     -- 지하층수
  use_apr_day     DATE,                         -- 사용승인일 (NULL if '' or invalid)
  geom            GEOMETRY(Geometry, 4326) NOT NULL,
  data_source     TEXT NOT NULL,                -- 'moldt_brtitle_YYYYMMDD'
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX buildings_geom_idx     ON buildings USING GIST (geom);
CREATE INDEX buildings_district_idx ON buildings (district_code);
CREATE INDEX buildings_bjdong_idx   ON buildings (bjdong_cd);
CREATE INDEX buildings_use_apr_idx  ON buildings (use_apr_day);

COMMENT ON TABLE  buildings IS '서울 건축물대장 기반 건물 공간 데이터. 최초 적재는 중구(11140).';
COMMENT ON COLUMN buildings.vl_rat        IS '용적률(%). 원본 0 은 결측을 의미하므로 ETL 에서 NULL 치환';
COMMENT ON COLUMN buildings.bc_rat        IS '건폐율(%). 원본 0 은 결측, NULL 치환';
COMMENT ON COLUMN buildings.plat_area     IS '대지면적(㎡). 원본 0 은 결측, NULL 치환';
COMMENT ON COLUMN buildings.arch_area     IS '건축면적(㎡). 원본 0 은 결측, NULL 치환';
COMMENT ON COLUMN buildings.tot_area      IS '연면적(㎡). 원본 0 건수는 ETL 로그로 보고';
COMMENT ON COLUMN buildings.grnd_flr_cnt  IS '지상층수. 원본 0 은 결측, NULL 치환';
COMMENT ON COLUMN buildings.use_apr_day   IS '사용승인일. 원본 빈값/파싱 불가 시 NULL';
COMMENT ON COLUMN buildings.data_source   IS '{source}_{dataset}_{YYYYMMDD} 형식. 예: moldt_brtitle_20260414';
