# 관설 대시보드 백엔드 분리 계획

**작성일**: 2026-04-23
**대상 프로젝트**: `gwansul/` (React + Vite + Leaflet)
**이관 대상**: Supabase (Northeast Asia / Seoul, PostGIS 활성화 예정, 무료 티어 500MB)
**현재 단계**: Phase 0 — 분석·계획만. 코드 수정 없음.

---

## 1. 현황 요약

### 1.1 현재 아키텍처

```
GitHub Pages (정적 SPA)
  │
  ├─ React 번들 (JS 810KB)
  ├─ CSS (58KB)
  └─ /assets/*.geojson, *.json   ← 브라우저가 직접 fetch
        │
        ├─ junggu-buildings-final-lite.geojson  11.3 MB  (24,556 건물)
        ├─ land_use_junggu.geojson               8.6 MB  (용도지역 수만 폴리곤)
        ├─ junggu-demographics.json              1.7 MB  (29,035 dot + hourlyChart)
        ├─ junggu-transit.json                   237 KB  (버스 1,374 + 지하철 5호선)
        ├─ junggu-commerce.json                   65 KB  (상권 68개)
        └─ junggu-landmarks.json                   7 KB  (11개, 정적 import)

Cloudflare Worker (gwansul-api.workers.dev)
  ├─ R2 기반 아티클 CRUD (meta/, pdfs/)
  └─ /api/chat  ← Anthropic API 프록시, SSE 스트리밍
```

### 1.2 데이터 흐름과 성능 병목

GisPage.jsx(2,163줄)를 분석한 결과, **사용자가 지도를 클릭·드래그·반경 조정**할 때마다 다음이 발생:

| 단계 | 동작 | 대상 크기 | 방식 | 비용 |
|---|---|---|---|---|
| ① 초기 로드 | 5개 파일 `Promise.all` fetch | 21.9 MB | 전체 다운로드 | 초기 로딩 지연 |
| ② 클릭 → useMemo 5개 동시 실행 | filter() 전수 순회 | 24k + 29k + 1.3k + 68 + 수만 | 평면 근사거리(`fastDistM`) + `turf.booleanIntersects`(용도지역만) | 클릭 체감 지연 |
| ③ 건물 스타일 갱신 | `layerRef.eachLayer(setStyle)` | 24,556 layer | 전체 재스타일링 | 반경/섹션/연도 변경마다 재계산 |
| ④ Leaflet 렌더 | GeoJSON 전체 동시 렌더 | 24k 폴리곤 | 뷰포트 컬링·LOD 없음 | 지도 팬/줌 시 끊김 |

**핵심 이슈**:
- **공간 인덱스 부재** — R-tree 없이 배열 전수 스캔
- **고정 데이터를 매번 재다운로드** — CDN 캐시는 있지만 초기 진입 시 21.9MB
- **용도지역의 `turf.booleanIntersects`가 가장 느림** — 수만 폴리곤 × 원형 32각형 교차 판정
- **모바일/저대역 네트워크에서 특히 치명적**

### 1.3 결측값 도메인 지식 (ETL 스크립트에서 추출)

백엔드 이관 시 **반드시 NULL로 변환**해야 할 "결측 의미의 0/빈값":

| 필드 | 현재 저장값 | 실제 의미 | DB 정책 |
|---|---|---|---|
| `vlRat` | `0` | 용적률 미지정/결측 | `NULL` |
| `bcRat` | `0` | 건폐율 미지정/결측 | `NULL` |
| `platArea` | `0` | 대지면적 미지정/결측 | `NULL` |
| `archArea` | `0` | 건축면적 미지정/결측 | `NULL` |
| `totArea` | `0` | 연면적 미지정 (드물게) | `NULL` |
| `grndFlrCnt` | `0` | 지상층수 미지정 | `NULL` |
| `useAprDay` | `''` | 사용승인 미완료/결측 | `NULL` (DATE) |
| `bldNm` | `''` | 건물명 없음 | `NULL` |
| demographics 원본 | `'*'` | 개인정보 보호 마스킹 | ETL에서 이미 0 처리 → 집계값은 0 유지 |

출처: [mergeAndTransform.py](../scripts/etl/mergeAndTransform.py), [geocodeBuildings.js](../scripts/etl/geocodeBuildings.js:103), [buildDemographics.py](../scripts/etl/buildDemographics.py)

### 1.4 챗봇 프록시 구조

[workers/src/index.js](../workers/src/index.js)는 **Supabase와 직교** — 본 이관과 독립적. 단, Phase 5에서 `chatContext.js`의 클라이언트 집계를 서버 RPC로 위임할 수 있음.

- 현재: 클라이언트가 `filtered/filteredTransit/filteredDots/filteredCommerce/filteredZoning/amenities`(필터된 배열)를 `buildLocationContext()`로 요약 텍스트 생성 → Worker `/api/chat` 전달
- 컨텍스트 크기: ~2K 토큰 (통계 요약)
- 참조: [chatContext.js](../src/components/gis/chatContext.js), [GisChatbot.jsx](../src/components/gis/GisChatbot.jsx:61-117)

---

## 2. 이관 우선순위 테이블

판단 기준: **(a) 파일 크기 × (b) 인터랙션 재계산 빈도 × (c) 이관 성능 이득 ÷ (d) 난이도**

| 우선순위 | 데이터 | 크기 | 레코드 | 재계산 | 이관 이득 | 난이도 | 결정 |
|---|---|---|---|---|---|---|---|
| **P1** | **건물 (buildings)** | 11.3 MB | 24,556 | 반경/연도/섹션/필터 변경마다 전수 순회 + 24k layer setStyle | **극대** (초기 11MB 제거, 반경 내만 수백~수천건만 로드) | 중 (Polygon 스키마, 좌표 변환, PostGIS POLYGON) | **즉시 이관** |
| **P2** | **용도지역 (zoning)** | 8.6 MB | 수만 폴리곤 | 반경 변경 시 `turf.booleanIntersects` (가장 무거움) | **매우 큼** (turf 부하 전면 제거) | 중 | **즉시 이관** |
| **P3** | **인구 dots** | 1.7 MB | 29,035 POINT | 반경 변경 시 전수 거리 필터 | 중 (1.7MB → 수백 포인트) | 낮 (POINT 단순) | **후속 이관** |
| P4 | 교통 (bus/subway) | 237 KB | 1,374 버스 + 5호선 | 반경 변경 시 재계산 | 소 (이미 작음) | 낮 | 여유 있을 때 |
| - | 상권 (commerce) | 65 KB | 68 | 반경 변경 시 재계산 | 미미 | 낮 | **정적 유지** (성능 이득 없음) |
| - | 랜드마크 | 7 KB | 11 | 클라이언트 내 haversine | 없음 | - | **정적 유지** |
| - | survey-area | 0.5 KB | 1 | 없음 | 없음 | - | **정적 유지** |

**Supabase 500MB 한도 검토** (예상 PostGIS 저장 크기):
- buildings: ~30–50 MB (geometry 팽창 고려)
- zoning: ~20–30 MB
- population_dots: ~3–5 MB
- population_tract(시간대별): ~1 MB
- 교통/상권: <2 MB
- **합계 예상: 60–90 MB** → 여유 충분 ✅

---

## 3. Phase별 실행 계획

### Phase 1 — 건물 데이터 이관 (2–3주)

**범위**: P1 건물만. 용도지역은 Phase 2에서.

**작업**:
1. Supabase 프로젝트 생성, `CREATE EXTENSION postgis;`
2. `buildings` 테이블 + GIST 인덱스 생성 (아래 §5.1)
3. 적재 스크립트 신규: `scripts/etl/loadBuildingsToSupabase.py`
   - [buildFinal.py](../scripts/etl/buildFinal.py) 출력(`junggu-buildings-final.geojson`)을 읽어 INSERT
   - **결측 변환**: `vlRat == 0 → NULL`, `useAprDay == '' → NULL`, 등 (§1.3 규칙 전체 적용)
4. RPC 함수 `buildings_within(lng, lat, radius_m, district)` 생성 — 반경 내 건물만 반환
5. 클라이언트: `src/lib/supabase.js` 신규, `VITE_USE_DB_BUILDINGS` 플래그 도입
   - true면 RPC 호출, false면 기존 fetch 유지 → **병렬 운영**
6. GisPage에서 `buildingData` 상태를 유지한 채 fetch 소스만 스위칭 (UI 코드는 그대로)

**완료 기준**:
- 반경 500m 내 건물 응답 시간 < 400ms (3G 네트워크 기준)
- 24,556건 모두 적재 확인, 결측값 NULL 치환 샘플 검증 (SELECT COUNT WHERE vl_rat IS NULL)
- 기존 geojson 방식과 시각적 동일성 (pixel diff 수동 확인)
- 플래그 off 시 기존 동작 100% 동일

**롤백**: `VITE_USE_DB_BUILDINGS=false`로 즉시 복귀. geojson 파일은 최소 1달 유지.

**리스크**:
- **국토부 API 재수집 주기** 미정 — 현재 스냅샷 시점이 언제인지 `data_source` 필드에 기록해 둘 것
- 좌표계: PostGIS는 EPSG:4326 GEOMETRY 저장. [mergeAndTransform.py](../scripts/etl/mergeAndTransform.py)가 이미 4326으로 변환해 출력하므로 그대로 사용
- 처음 드래그 시 반경 밖으로 이동하면 새로 fetch — 요청 스로틀링 필요 (300ms debounce 권장)

---

### Phase 2 — 용도지역 이관 (1–2주)

**작업**:
1. `zoning` 테이블 + GIST 인덱스
2. 적재: [land_use_junggu.geojson](../src/gis/data/land_use_junggu.geojson) → INSERT
3. RPC: `zoning_intersect(lng, lat, radius_m, district)` — `ST_Intersects(geom, ST_Buffer(point::geography, radius_m))` 사용
4. 클라이언트: `turf.circle` + `turf.booleanIntersects` 제거. `VITE_USE_DB_ZONING` 플래그
5. `chatContext.js`의 `filteredZoning` 입력은 동일 형상 유지 (면적 집계 로직 변경 없음)

**완료 기준**: 반경 변경 시 프레임 드랍 소실. 사용자 인지 기준 "끊김 없음".

**롤백**: 플래그 off. `land_use_junggu.geojson` 파일 유지.

---

### Phase 3 — 인구 dots + tract 이관 (1–2주)

**작업**:
1. `population_dots` (POINT, 29k) + `population_tract` (시간대별 원본)
2. RPC: `population_dots_within(lng, lat, radius_m)` + `population_tract_hourly(tract_codes, hour)`
3. `junggu-demographics.json` fetch 제거, RPC로 전환

**주의**: `dots`는 Python에서 폴리곤 내 랜덤 샘플링으로 생성된 **시뮬레이션 포인트**. 재생성 시 다른 배치가 됨 → seed 고정 또는 스냅샷 DB 유지 (둘 중 선택).

---

### Phase 4 — 교통 이관 (옵션, 1주)

**작업**: `bus_stops`, `subway_stations` 테이블. 호선 순서 `seq` 필드로 노선 재구성.

**효과 작음** — Phase 1–3 검증 후 여력 있을 때만.

---

### Phase 5 — 챗봇 컨텍스트 서버 집계 (옵션, 1–2주)

**동기**: 클라이언트가 필터된 배열을 모두 손에 쥐고 있어야 요약 가능 → 건물이 DB에 있으면 Worker에서 RPC 호출 후 요약하는 편이 단순

**작업**:
1. Worker에 `/api/location-context?lng=&lat=&radius=` 신규 엔드포인트
2. Worker에서 Supabase RPC 병렬 호출 → `buildLocationContext()`와 동일한 포맷 문자열 생성
3. 클라이언트 `GisChatbot.jsx`는 `context` 문자열을 그대로 받아 `/api/chat`에 전달

**완료 기준**: 챗봇 응답 품질 동일 (샘플 쿼리 10개로 diff).

**리스크**: 클라이언트 즉석 요약 대비 네트워크 1홉 추가. 이득이 명확하지 않으면 **보류 권장**.

---

### Phase 6 — 정적 유지 데이터 재확인 (상시)

`commerce`, `landmarks`, `survey-area`는 DB 이관 없이 **정적 유지**. 단, 파일이 커지거나 다른 구로 확장 시 재평가.

---

## 4. 리스크와 롤백 전략

### 4.1 공통 원칙 — 병렬 운영

모든 Phase는 **토글 플래그**를 기본으로 한다:

```
.env.local:
  VITE_USE_DB_BUILDINGS=true
  VITE_USE_DB_ZONING=true
  VITE_USE_DB_DEMOGRAPHICS=true
  VITE_USE_DB_TRANSIT=false
```

- 기존 `src/gis/data/*.geojson`와 `*.json`은 **최소 1개월 유지** (Phase 완료 후 검증 기간)
- 문제 발생 시 해당 Phase 플래그만 `false`로 되돌리면 즉시 기존 동작 복귀
- 코드 삭제는 각 Phase 완료 후 최소 2주 관찰 후에만

### 4.2 Phase별 리스크

| Phase | 리스크 | 완화 |
|---|---|---|
| 1 | Supabase 무료 티어 rate limit / 다운타임 | 클라이언트 fallback: RPC 실패 시 자동으로 정적 geojson으로 전환 |
| 1 | 결측값 오변환 (vlRat=0을 NULL로 잘못 바꿔 유효 0을 잃음) | ETL 적재 시 `original_source` raw 테이블을 별도 유지하거나, `vl_rat_raw` 원본 컬럼 병행 보관 |
| 2 | `ST_Intersects` 성능 | 인덱스(GIST) 필수. `ST_Buffer(geography)` 정확도 vs 속도 트레이드오프 확인 |
| 3 | dots 랜덤 재생성으로 시각적 차이 | seed 고정 또는 DB 한 번 적재 후 re-run 금지 |
| 5 | Worker에서 Supabase 호출 레이턴시 | Anthropic API 대비 짧음(수십ms), 문제 없을 것 |

### 4.3 Supabase 500MB 초과 대비

- 월 1회 `pg_database_size()` 확인. 300MB 도달 시 경고
- 초과 시: ① `buildings.geom` 단순화 (`ST_SimplifyPreserveTopology`), ② 유료 티어 전환 ($25/월)

### 4.4 보안·RLS

- 공개 데이터이므로 `anon` 역할 SELECT 허용
- INSERT/UPDATE/DELETE는 `service_role` 키(서버 측 ETL)만
- `ANON_KEY`는 브라우저 노출 OK, `SERVICE_ROLE_KEY`는 반드시 서버 측(ETL 스크립트 환경변수)

---

## 5. 스키마 초안 (경량 온톨로지)

### 5.1 공통 원칙

모든 테이블에 **메타 필드 3종** 포함 — 미래 구 확장 및 출처 추적용:

- `district_code VARCHAR(5)` — '11140' = 중구. 미래 타구 추가 시 바로 파티셔닝 가능
- `data_source TEXT` — 출처+버전 태그 (예: `'moldt_brtitle_20260309'`)
- `updated_at TIMESTAMPTZ DEFAULT NOW()` — 적재 시각

좌표계는 전부 **EPSG:4326** (WGS84 lat/lng). 거리 쿼리는 `::geography` 캐스팅으로 정확한 미터 계산.

### 5.2 DDL

```sql
-- ────────────────────────────────────────
-- 확장
-- ────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;

-- ────────────────────────────────────────
-- 1. 건물 (P1)
-- ────────────────────────────────────────
CREATE TABLE buildings (
  id              BIGSERIAL PRIMARY KEY,
  pnu             VARCHAR(19) UNIQUE NOT NULL,
  district_code   VARCHAR(5)  NOT NULL,
  bjdong_cd       VARCHAR(5),
  address         TEXT,
  bld_nm          TEXT,                   -- NULL if 빈값
  reg_type        VARCHAR(10),            -- '일반' / '집합'
  main_purps      TEXT,
  strct           TEXT,
  arch_area       NUMERIC,                -- NULL if 결측 (원본 0)
  tot_area        NUMERIC,
  plat_area       NUMERIC,                -- NULL if 결측
  bc_rat          NUMERIC,                -- NULL if 결측 (원본 0 → NULL)
  vl_rat          NUMERIC,                -- NULL if 결측
  grnd_flr_cnt    SMALLINT,               -- NULL if 결측
  ugrnd_flr_cnt   SMALLINT,
  use_apr_day     DATE,                   -- NULL if '' or invalid
  geom            GEOMETRY(Polygon, 4326) NOT NULL,
  data_source     TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX buildings_geom_idx     ON buildings USING GIST (geom);
CREATE INDEX buildings_district_idx ON buildings (district_code);
CREATE INDEX buildings_bjdong_idx   ON buildings (bjdong_cd);
CREATE INDEX buildings_use_apr_idx  ON buildings (use_apr_day);  -- 연도 필터용

-- ────────────────────────────────────────
-- 2. 용도지역 (P2)
-- ────────────────────────────────────────
CREATE TABLE zoning (
  id              BIGSERIAL PRIMARY KEY,
  district_code   VARCHAR(5) NOT NULL,
  zone_name       TEXT NOT NULL,          -- '제3종일반주거지역' 등
  atrb_se         VARCHAR(10),            -- 'UQA123' 등 원본 코드
  dgm_ar          NUMERIC,                -- 대장면적 (원본, 0 가능)
  source_district TEXT,                   -- 원본 '구이름' (경계 걸친 필지용)
  geom            GEOMETRY(MultiPolygon, 4326) NOT NULL,  -- Polygon/MultiPolygon 혼재 대응
  data_source     TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX zoning_geom_idx     ON zoning USING GIST (geom);
CREATE INDEX zoning_district_idx ON zoning (district_code);
CREATE INDEX zoning_name_idx     ON zoning (zone_name);

-- ────────────────────────────────────────
-- 3. 인구 점 (P3)
-- ────────────────────────────────────────
CREATE TABLE population_dots (
  id              BIGSERIAL PRIMARY KEY,
  district_code   VARCHAR(5) NOT NULL,
  tract_code      VARCHAR(13),            -- 집계구 코드 (FK는 느슨하게)
  age_group       VARCHAR(20) NOT NULL,   -- 'age_0_19' | 'age_20_39' | 'age_40_59' | 'age_60_plus'
  dot_per         SMALLINT NOT NULL DEFAULT 10,  -- 1점당 인구수
  geom            GEOMETRY(Point, 4326) NOT NULL,
  data_source     TEXT NOT NULL,
  snapshot_date   DATE,                   -- 기준 통계 시점 (예: 2017-10-14 14:00)
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX pop_dots_geom_idx ON population_dots USING GIST (geom);
CREATE INDEX pop_dots_age_idx  ON population_dots (age_group);

-- 집계구·시간대별 원본 (챗봇 시간대 분석용)
CREATE TABLE population_tract_hourly (
  tract_code      VARCHAR(13) NOT NULL,
  hour            SMALLINT    NOT NULL CHECK (hour BETWEEN 0 AND 23),
  age_0_19        INT,
  age_20_39       INT,
  age_40_59       INT,
  age_60_plus     INT,
  total           INT,
  district_code   VARCHAR(5) NOT NULL,
  data_source     TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tract_code, hour)
);

-- ────────────────────────────────────────
-- 4. 교통 (P4)
-- ────────────────────────────────────────
CREATE TABLE bus_stops (
  id              BIGSERIAL PRIMARY KEY,
  stop_no         VARCHAR(10),
  node_id         VARCHAR(15),
  name            TEXT NOT NULL,
  district_code   VARCHAR(5) NOT NULL,
  geom            GEOMETRY(Point, 4326) NOT NULL,
  data_source     TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX bus_stops_geom_idx ON bus_stops USING GIST (geom);

CREATE TABLE subway_stations (
  id              BIGSERIAL PRIMARY KEY,
  line_code       VARCHAR(10) NOT NULL,   -- '01호선' ~ '09호선'
  line_color      VARCHAR(7),             -- '#0052a4'
  station_name    TEXT NOT NULL,
  station_cd      VARCHAR(10),
  seq             SMALLINT,               -- 호선 내 정렬 순서
  district_code   VARCHAR(5) NOT NULL,
  geom            GEOMETRY(Point, 4326) NOT NULL,
  data_source     TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX subway_geom_idx ON subway_stations USING GIST (geom);
CREATE INDEX subway_line_idx ON subway_stations (line_code, seq);

-- ────────────────────────────────────────
-- 5. 상권 (정적 유지 기본, 확장용 준비만)
-- ────────────────────────────────────────
CREATE TABLE commerce_areas (
  code            VARCHAR(10) PRIMARY KEY,
  name            TEXT NOT NULL,
  area_type       TEXT,                   -- '골목상권' 등
  type_code       VARCHAR(2),
  dong            TEXT,
  district_code   VARCHAR(5) NOT NULL,
  quarter         VARCHAR(6),             -- '202403' (연도+분기)
  area_m2         NUMERIC,
  radius_m        NUMERIC,
  stores          INT,
  open_stores     INT,
  close_stores    INT,
  franchise       INT,
  top_categories  JSONB,                  -- [["한식음식점", 9], ...]
  sales_total     BIGINT,
  sales_weekday   BIGINT,
  sales_weekend   BIGINT,
  geom            GEOMETRY(Point, 4326),
  data_source     TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX commerce_geom_idx ON commerce_areas USING GIST (geom);

-- ────────────────────────────────────────
-- 6. 랜드마크 (정적 유지 기본)
-- ────────────────────────────────────────
CREATE TABLE landmarks (
  id              VARCHAR(50) PRIMARY KEY,
  name            TEXT NOT NULL,
  name_en         TEXT,
  year            INT,
  original_year   INT,
  category        TEXT,
  icon            TEXT,
  description     TEXT,
  significance    TEXT,
  geom            GEOMETRY(Point, 4326) NOT NULL,
  district_code   VARCHAR(5) NOT NULL,
  data_source     TEXT NOT NULL DEFAULT 'manual_curated',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX landmarks_geom_idx ON landmarks USING GIST (geom);
```

### 5.3 주요 RPC 함수 초안

```sql
-- 반경 내 건물 (Phase 1)
CREATE OR REPLACE FUNCTION buildings_within(
  lng          DOUBLE PRECISION,
  lat          DOUBLE PRECISION,
  radius_m     INT,
  district     VARCHAR DEFAULT '11140'
)
RETURNS TABLE (
  pnu          VARCHAR,
  address      TEXT,
  bld_nm       TEXT,
  main_purps   TEXT,
  strct        TEXT,
  vl_rat       NUMERIC,
  bc_rat       NUMERIC,
  grnd_flr_cnt SMALLINT,
  tot_area     NUMERIC,
  plat_area    NUMERIC,
  use_apr_day  DATE,
  bjdong_cd    VARCHAR,
  geom_json    JSONB
)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT b.pnu, b.address, b.bld_nm, b.main_purps, b.strct,
         b.vl_rat, b.bc_rat, b.grnd_flr_cnt, b.tot_area, b.plat_area,
         b.use_apr_day, b.bjdong_cd,
         ST_AsGeoJSON(b.geom)::jsonb
  FROM buildings b
  WHERE b.district_code = district
    AND ST_DWithin(
      b.geom::geography,
      ST_MakePoint(lng, lat)::geography,
      radius_m
    );
$$;

-- 반경 내 용도지역 (Phase 2) — turf 대체
CREATE OR REPLACE FUNCTION zoning_intersect(
  lng DOUBLE PRECISION, lat DOUBLE PRECISION,
  radius_m INT, district VARCHAR DEFAULT '11140'
)
RETURNS TABLE (
  zone_name TEXT, dgm_ar NUMERIC,
  intersect_area_m2 DOUBLE PRECISION,
  geom_json JSONB
)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH circle AS (
    SELECT ST_Buffer(ST_MakePoint(lng, lat)::geography, radius_m)::geometry AS g
  )
  SELECT z.zone_name, z.dgm_ar,
         ST_Area(ST_Intersection(z.geom, c.g)::geography),
         ST_AsGeoJSON(ST_Intersection(z.geom, c.g))::jsonb
  FROM zoning z, circle c
  WHERE z.district_code = district
    AND ST_Intersects(z.geom, c.g);
$$;
```

### 5.4 RLS 정책

```sql
ALTER TABLE buildings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoning            ENABLE ROW LEVEL SECURITY;
ALTER TABLE population_dots   ENABLE ROW LEVEL SECURITY;
-- ... 동일

CREATE POLICY "anon read buildings" ON buildings FOR SELECT TO anon USING (true);
-- 쓰기는 service_role 전용 (기본 동작, 정책 불필요)
```

---

## 6. 추천하는 Phase 1 범위 (요약)

> **건물 데이터만** Supabase로 이관. 플래그 기반 병렬 운영. 약 2–3주.

- 스키마: `buildings` 테이블 + GIST + RPC `buildings_within`
- ETL: `scripts/etl/loadBuildingsToSupabase.py` 신규 (기존 buildFinal 이후 체인)
- 클라이언트: `VITE_USE_DB_BUILDINGS` 토글. 기존 `setBuildingData` 상태 유지, 소스만 스위칭
- 결측값: `vl_rat=0 → NULL` 등 §1.3 규칙 엄격 적용
- 롤백: 플래그 off로 즉시 geojson 복귀

Phase 1이 성공적으로 안정화된 뒤에만 Phase 2(용도지역)로 진행. 둘을 동시에 하지 않는 이유: **실패 시 격리 단순화**, **1인 체제 부담 관리**.
