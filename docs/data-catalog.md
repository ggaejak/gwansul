# 데이터 카탈로그

> 작성일: 2026-05-23
> 범위: `gwansul` 프로젝트의 모든 데이터 소스 — Supabase 테이블/RPC, 정적 GIS 파일, ETL 스크립트, raw 데이터, 클라이언트 데이터 레이어, 환경변수.
> 작성 기준: `supabase/migrations/00001~00025`, `src/data/*`, `src/lib/supabase.js`, `scripts/etl/*` 의 실제 코드와 라이브 DB 쿼리.

목차
1. [Supabase 테이블 목록](#1-supabase-테이블-목록)
2. [RPC (서버 함수) 목록](#2-rpc-서버-함수-목록)
3. [정적 데이터 파일](#3-정적-데이터-파일)
4. [ETL 스크립트 목록](#4-etl-스크립트-목록)
5. [원본 데이터(raw) 목록](#5-원본-데이터raw-목록)
6. [데이터 흐름도](#6-데이터-흐름도)
7. [클라이언트 데이터 레이어](#7-클라이언트-데이터-레이어)
8. [환경변수 목록](#8-환경변수-목록)
9. [테이블 관계도 (ERD)](#9-테이블-관계도-erd)
10. [결측 현황 (답사 영역 기준)](#10-결측-현황-답사-영역-기준)

---

## 1. Supabase 테이블 목록

총 **8 개 테이블**. 모두 RLS 활성화. 좌표계는 EPSG:4326 (WGS84 lng/lat).

### 1.1 `buildings`

서울 건축물대장 + VWorld 폴리곤 기반 건물 공간 데이터.

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| id | BIGSERIAL | NO | (자동) | PK |
| pnu | VARCHAR(19) | NO | — | 필지식별번호. 집합건물로 중복 가능 (00005 에서 UNIQUE 제거) |
| district_code | VARCHAR(5) | NO | — | '11140' = 중구 |
| bjdong_cd | VARCHAR(5) | YES | — | 법정동 코드 |
| address | TEXT | YES | — | 지번 주소 |
| bld_nm | TEXT | YES | — | 건물명. 원본 '' 은 NULL |
| reg_type | VARCHAR(10) | YES | — | '일반' \| '집합' |
| main_purps | TEXT | YES | — | 주용도 |
| strct | TEXT | YES | — | 구조 |
| arch_area | NUMERIC | YES | — | 건축면적(㎡). 원본 0 → NULL |
| tot_area | NUMERIC | YES | — | 연면적(㎡). 원본 0 → NULL |
| plat_area | NUMERIC | YES | — | 대지면적(㎡). 원본 0 → NULL |
| bc_rat | NUMERIC | YES | — | 건폐율(%). 원본 0 → NULL |
| vl_rat | NUMERIC | YES | — | 용적률(%). 원본 0 → NULL |
| grnd_flr_cnt | SMALLINT | YES | — | 지상층수 |
| ugrnd_flr_cnt | SMALLINT | YES | — | 지하층수 |
| use_apr_day | DATE | YES | — | 사용승인일 |
| geom | GEOMETRY(Geometry, 4326) | NO | — | Polygon/MultiPolygon |
| data_source | TEXT | NO | — | `{source}_{dataset}_{YYYYMMDD}` |
| updated_at | TIMESTAMPTZ | NO | NOW() | UPDATE 시 자동 갱신 트리거 없음 |

- **행 수**: 전체 **20,930**, district 11140 **20,930** (현재 중구만 적재), 답사영역 안 **3,452**
- **data_source 분포**: `moldt_brtitle_20260414` 20,533 + `vworld_spbd_20260519` 397
- **RLS**: 활성화. 정책 `anon_read_buildings` (SELECT, anon+authenticated)
- **GRANT**: PUBLIC 기본 (명시적 GRANT 없음 — service_role 은 우회)
- **인덱스**: `buildings_pkey`(id), `buildings_geom_idx`(GIST), `buildings_district_idx`, `buildings_bjdong_idx`, `buildings_use_apr_idx`, `buildings_pnu_idx`(00005 추가, UNIQUE 아님)
- **생성**: `00002_create_buildings.sql` + `00004_enable_rls_buildings.sql` + `00005_drop_pnu_unique.sql`

### 1.2 `zoning`

서울 용도지역(land use zoning) 폴리곤.

| 컬럼 | 타입 | NULL | 기본값 |
|---|---|---|---|
| id | BIGSERIAL | NO | (자동) |
| district_code | VARCHAR(5) | NO | — |
| zone_name | TEXT | NO | — |
| atrb_se | VARCHAR(10) | YES | — |
| dgm_ar | NUMERIC | YES | — |
| source_district | TEXT | YES | — |
| geom | GEOMETRY(Geometry, 4326) | NO | — |
| data_source | TEXT | NO | — |
| updated_at | TIMESTAMPTZ | NO | NOW() |

- **행 수**: 전체 **682** (중구 364 + 종로구 318 혼재)
- **RLS**: 활성화. 정책 `anon_read_zoning` (SELECT)
- **GRANT**: `SELECT` to anon, authenticated; `SELECT/INSERT/UPDATE/DELETE` + 시퀀스 to service_role
- **인덱스**: `zoning_pkey`, `zoning_geom_idx`(GIST), `zoning_district_idx`, `zoning_zone_idx`
- **생성**: `00006_create_zoning.sql`

### 1.3 `field_surveys`

현장 조사 원시 입력 (메달리언 raw layer).

| 컬럼 | 타입 | NULL | 기본값 | 비고 |
|---|---|---|---|---|
| id | UUID | NO | gen_random_uuid() | PK |
| survey_type | TEXT | NO | — | CHECK: building/road/point |
| location | GEOMETRY(Point, 4326) | NO | — | |
| building_id | BIGINT | YES | — | buildings.id (FK 강제 X) |
| building_pnu | TEXT | YES | — | 00013 에서 NULL 허용 완화 |
| payload | JSONB | NO | `{}` | type 별 가변 키 |
| memo | TEXT | YES | — | |
| photo_paths | TEXT[] | NO | `[]` | Storage 객체 경로 |
| status | TEXT | NO | 'pending' | CHECK: pending/approved/rejected |
| reject_reason | TEXT | YES | — | rejected 시 필수 (CHECK) |
| reviewed_at | TIMESTAMPTZ | YES | — | |
| created_at | TIMESTAMPTZ | NO | NOW() | |
| updated_at | TIMESTAMPTZ | NO | NOW() | BEFORE UPDATE 트리거(00011) |

- **행 수**: 전체 **15** (pending 15, approved 0, rejected 0)
- **RLS**: 활성화. 정책 4 개:
  - `anon_insert_field_surveys` — INSERT, `status='pending'` 강제
  - `anon_select_field_surveys` — SELECT 전체 (00011)
  - `anon_update_pending_only` — UPDATE, USING+WITH CHECK `status='pending'`
  - `anon_delete_pending_only` — DELETE, USING `status='pending'` (00019)
- **GRANT**: anon+authenticated — SELECT, INSERT, UPDATE, DELETE / service_role — 전체
- **트리거**: `field_surveys_set_updated_at` (BEFORE UPDATE), `field_surveys_cleanup_curated_on_delete` (AFTER DELETE — curated_* 의 source_survey_ids 정리)
- **인덱스**: `field_surveys_pkey`, `field_surveys_geom_idx`(GIST), `_status_idx`, `_type_idx`, `_building_id_idx`, `_pnu_idx`, `_created_idx`
- **생성**: `00008_create_field_surveys.sql` + `00011_relax_field_surveys_rls.sql` + `00013_relax_field_surveys_building_check.sql` + `00019_add_delete_capability.sql`

### 1.4 `curated_buildings`

관리자 정제 건물 (1 건물 = 1 row 원칙, application-level).

| 컬럼 | 타입 | NULL | 기본값 |
|---|---|---|---|
| id | BIGSERIAL | NO | (자동) |
| building_id | BIGINT | YES | — |
| building_pnu | TEXT | NO | — |
| first_floor_use | TEXT | YES | — |
| is_vacant | BOOLEAN | YES | — |
| photo_paths | TEXT[] | NO | `[]` |
| admin_memo | TEXT | YES | — |
| source_survey_ids | UUID[] | NO | `[]` |
| approved_at | TIMESTAMPTZ | NO | NOW() |
| updated_at | TIMESTAMPTZ | NO | NOW() |

- **행 수**: **0**
- **RLS**: 활성화. 정책 `anon_read_curated_buildings` (SELECT)
- **GRANT**: SELECT to anon+authenticated / 전체 to service_role + 시퀀스
- **인덱스**: `_pkey`, `_bid_idx`, `_pnu_idx`, `_sources_idx`(GIN), `_use_idx`
- **생성**: `00008_create_field_surveys.sql`

### 1.5 `curated_roads`

관리자 정제 도로 점 조사.

| 컬럼 | 타입 | NULL | 기본값 |
|---|---|---|---|
| id | BIGSERIAL | NO | (자동) |
| location | GEOMETRY(Point, 4326) | NO | — |
| night_brightness | TEXT | YES | — |
| road_width | TEXT | YES | — |
| photo_paths | TEXT[] | NO | `[]` |
| admin_memo | TEXT | YES | — |
| source_survey_ids | UUID[] | NO | `[]` |
| approved_at | TIMESTAMPTZ | NO | NOW() |
| updated_at | TIMESTAMPTZ | NO | NOW() |

- **행 수**: **0**
- **RLS / GRANT**: curated_buildings 와 동일 패턴
- **인덱스**: `_pkey`, `_geom_idx`(GIST), `_brightness_idx`, `_sources_idx`(GIN)
- **생성**: `00008_create_field_surveys.sql`

### 1.6 `curated_points`

관리자 정제 일반 점 조사 (화장실/흡연/소음/냄새/기타).

| 컬럼 | 타입 | NULL | 기본값 |
|---|---|---|---|
| id | BIGSERIAL | NO | (자동) |
| location | GEOMETRY(Point, 4326) | NO | — |
| category | TEXT | NO | — |
| photo_paths | TEXT[] | NO | `[]` |
| admin_memo | TEXT | YES | — |
| source_survey_ids | UUID[] | NO | `[]` |
| approved_at | TIMESTAMPTZ | NO | NOW() |
| updated_at | TIMESTAMPTZ | NO | NOW() |

- **행 수**: **0**
- **RLS / GRANT**: 동일 패턴
- **인덱스**: `_pkey`, `_geom_idx`(GIST), `_category_idx`, `_sources_idx`(GIN)
- **생성**: `00008_create_field_surveys.sql`

### 1.7 `business_history`

서울 일반음식점 인허가 기반 건물별 업종 이력 (답사영역 한정).

| 컬럼 | 타입 | NULL | 기본값 |
|---|---|---|---|
| id | BIGSERIAL | NO | (자동) |
| business_name | TEXT | NO | — |
| business_type | TEXT | YES | — |
| opened_at | DATE | YES | — |
| closed_at | DATE | YES | — |
| status | TEXT | NO | — |
| building_id | BIGINT | YES | — |
| building_pnu | VARCHAR(19) | YES | — |
| jibun_address | TEXT | NO | — |
| road_address | TEXT | YES | — |
| geom | GEOMETRY(Point, 4326) | NO | — |
| site_area_m2 | NUMERIC | YES | — |
| data_source | TEXT | NO | — |
| created_at | TIMESTAMPTZ | NO | NOW() |

- **행 수**: **617** (영업/정상 178, 폐업 439)
- **RLS**: 활성화. 정책 `anon_read_business_history` (SELECT)
- **GRANT**: SELECT to anon+authenticated / 전체 to service_role + 시퀀스 (00023 보강)
- **인덱스**: `_pkey`, `_geom_idx`(GIST), `_building_pnu_idx`, `_building_id_idx`, `_status_idx`, `_opened_at_idx`
- **생성**: `00020_create_business_history.sql` + `00023_fix_business_history_grants.sql`

### 1.8 `storage.objects` (Supabase Storage)

`survey-photos` 버킷 — 현장 조사 사진. RLS 정책만 SQL 로 관리, 버킷 자체는 Dashboard 에서 생성.

- **정책**: `survey_photos_public_read` (SELECT, anon+authenticated, `bucket_id='survey-photos'`), `survey_photos_anon_insert` (INSERT, anon+authenticated, `bucket_id='survey-photos'`)
- **UPDATE/DELETE**: 정책 미생성 → 기본 거부 (service_role 만)
- **생성**: `00014_storage_survey_photos_policies.sql`

---

## 2. RPC (서버 함수) 목록

총 **15 개 RPC**. anon EXECUTE 가 부여된 것은 14개, service_role 전용 2개.

### 2.1 `buildings_within(lng, lat, radius_m, district)`
- **파라미터**: `lng DOUBLE PRECISION`, `lat DOUBLE PRECISION`, `radius_m INT`, `district VARCHAR DEFAULT '11140'`
- **반환**: `TABLE (pnu, address, bld_nm, reg_type, main_purps, strct, arch_area, tot_area, plat_area, bc_rat, vl_rat, grnd_flr_cnt, ugrnd_flr_cnt, use_apr_day, bjdong_cd, geom_json JSONB)`
- **속성**: `LANGUAGE sql STABLE PARALLEL SAFE`, SECURITY INVOKER (기본)
- **GRANT**: PUBLIC (Supabase 기본). 클라이언트는 anon 키로 호출.
- **용도**: 중심점에서 radius_m 반경 내 건물. `ST_DWithin(geography)` + `buildings_geom_idx`(GIST).
- **호출처**: [src/data/buildings.js:35](../src/data/buildings.js#L35) `fetchBuildingsNearPoint`
- **생성**: `00003_create_buildings_rpc.sql`

### 2.2 `zoning_intersect(lng, lat, radius_m, district)`
- **반환**: `TABLE (zone_name, atrb_se, dgm_ar, source_district, intersect_area_m2 DOUBLE PRECISION, geom_json JSONB)`
- **속성**: SQL STABLE PARALLEL SAFE
- **GRANT**: EXECUTE to anon, authenticated
- **용도**: 반경 원과 교차하는 모든 용도지역 폴리곤. `ST_Buffer + ST_Intersects`.
- **호출처**: [src/data/zoning.js:34](../src/data/zoning.js#L34) `fetchZoningIntersect`
- **생성**: `00007_create_zoning_rpc.sql`

### 2.3 `sindang_area()`
- **반환**: `GEOMETRY(Polygon, 4326)` (20-vertex 폴리곤, 00018 에서 재정의)
- **속성**: SQL IMMUTABLE PARALLEL SAFE
- **GRANT**: EXECUTE to anon, authenticated, service_role
- **용도**: 답사 영역 상수. 다른 RPC 가 내부 호출. `src/gis/data/sindang-survey-area.json` 과 동기 필수.
- **생성**: `00009_create_survey_rpc.sql`, 좌표 갱신 `00018_update_sindang_area.sql`

### 2.4 `survey_buildings_in_area()`
- **반환**: `JSONB` (FeatureCollection). 00016 에서 TABLE→JSONB 로 변경 (PostgREST 의 db.max_rows 1,000 cap 회피)
- **속성**: SQL STABLE SECURITY DEFINER
- **GRANT**: EXECUTE to anon, authenticated, service_role
- **용도**: 답사 영역 안 건물 + 조사 횟수/승인 수/curated 존재 여부.
- **호출처**: [src/data/surveys.js:79](../src/data/surveys.js#L79) `fetchBuildingsInSurveyArea`
- **생성**: `00009_create_survey_rpc.sql` + `00016_survey_buildings_in_area_jsonb.sql`

### 2.5 `pending_surveys(p_limit, p_offset, p_type)`
- **파라미터**: `p_limit INTEGER DEFAULT 50`, `p_offset INTEGER DEFAULT 0`, `p_type TEXT DEFAULT NULL`
- **반환**: `TABLE (id UUID, survey_type, location JSONB, building_id, building_pnu, payload, memo, photo_paths, status, created_at, total_count BIGINT)`
- **속성**: SQL STABLE SECURITY DEFINER
- **GRANT**: EXECUTE to anon, authenticated, service_role
- **호출처**: [src/data/surveys.js:101](../src/data/surveys.js#L101) `fetchPendingSurveys`
- **생성**: `00009_create_survey_rpc.sql`

### 2.6 `survey_progress()`
- **반환**: `JSONB` — `in_area_total, surveyed_buildings, approved_buildings, pending_total, approved_total, rejected_total, curated_roads_total, curated_points_total, pending_by_type{building,road,point}, by_day[]`
- **속성**: SQL STABLE SECURITY DEFINER
- **GRANT**: EXECUTE to anon, authenticated, service_role
- **호출처**: [src/data/surveys.js:237](../src/data/surveys.js#L237) `fetchSurveyProgress`
- **생성**: `00009_create_survey_rpc.sql` + `00017_augment_survey_progress.sql` 확장

### 2.7 `fetch_curated_buildings()`
- **반환**: `TABLE (curated_id, building_id, building_pnu, bld_nm, main_purps, geom JSONB, first_floor_use, is_vacant, photo_paths, admin_memo, approved_at, source_count INTEGER)`
- **속성**: SQL STABLE PARALLEL SAFE (SECURITY INVOKER)
- **GRANT**: EXECUTE to anon, authenticated, service_role
- **호출처**: [src/data/curated.js:42](../src/data/curated.js#L42) `fetchCuratedBuildings`
- **생성**: `00010_create_curated_rpc.sql`

### 2.8 `fetch_curated_roads()` / 2.9 `fetch_curated_points()`
- **반환**: 각각 `TABLE`, 위치 GeoJSON + 속성 + source_count
- **속성/GRANT**: 동일 패턴
- **호출처**: [src/data/curated.js:53](../src/data/curated.js#L53), [src/data/curated.js:64](../src/data/curated.js#L64)
- **생성**: `00010_create_curated_rpc.sql`

### 2.10 `fetch_surveys_in_area(p_status, p_type)`
- **반환**: `JSONB` (FeatureCollection)
- **속성**: SQL STABLE PARALLEL SAFE
- **GRANT**: EXECUTE to anon, authenticated, service_role
- **호출처**: [src/data/surveys.js:131](../src/data/surveys.js#L131) `fetchSurveysInArea`
- **생성**: `00012_add_survey_query_rpc.sql`

### 2.11 `fetch_survey_by_id(p_id UUID)`
- **반환**: `JSONB` (단일 Feature 또는 NULL)
- **호출처**: [src/data/surveys.js:155](../src/data/surveys.js#L155) `fetchSurveyById`
- **생성**: `00012_add_survey_query_rpc.sql`

### 2.12 `admin_check_password(p_password TEXT)`
- **반환**: `VOID` (비밀번호 불일치 시 EXCEPTION)
- **속성**: plpgsql SECURITY DEFINER, `search_path=public`
- **GRANT**: EXECUTE to anon, authenticated, service_role
- **현재 비밀번호**: `'Gwansul8&'` (소스 코드 평문, `VITE_SURVEY_ADMIN_PASSWORD` 와 동기)
- **생성**: `00015_admin_review_rpc.sql`

### 2.13 `admin_approve_survey_building(p_password, p_id, p_first_floor_use, p_is_vacant, p_admin_memo)`
- **반환**: `BIGINT` (curated_buildings.id)
- **속성**: plpgsql SECURITY DEFINER
- **동작**: 같은 PNU/id 의 curated_buildings row 가 있으면 UPDATE + `source_survey_ids` append, 없으면 INSERT. field_surveys.status='approved'.
- **호출처**: [src/data/surveys.js:408](../src/data/surveys.js#L408) `approveSurvey` (type 분기 wrapper)
- **생성**: `00015_admin_review_rpc.sql`

### 2.14 `admin_approve_survey_road(...)` / 2.15 `admin_approve_survey_point(...)`
- **반환**: `BIGINT`. curated_roads / curated_points INSERT (1:1)
- **호출처**: 위와 동일 wrapper
- **생성**: `00015_admin_review_rpc.sql`

### 2.16 `admin_reject_survey(p_password, p_id, p_reason)`
- **반환**: `VOID`. status='rejected' + reject_reason
- **호출처**: [src/data/surveys.js:430](../src/data/surveys.js#L430) `rejectSurvey`
- **생성**: `00015_admin_review_rpc.sql`

### 2.17 `admin_delete_survey(p_password, p_id)`
- **반환**: `JSONB` (`{deleted_survey_id, photo_paths, curated_cleaned}`)
- **속성**: plpgsql SECURITY DEFINER. 트리거가 curated_* 자동 정리.
- **호출처**: [src/data/surveys.js:517](../src/data/surveys.js#L517) `adminDeleteSurvey`
- **생성**: `00019_add_delete_capability.sql`

### 2.18 `fetch_business_history_by_building(p_pnu VARCHAR, p_building_id BIGINT)`
- **반환**: `TABLE (id, business_name, business_type, opened_at, closed_at, status, jibun_address, road_address, site_area_m2, geom_json JSONB)`
- **속성**: SQL STABLE PARALLEL SAFE
- **GRANT**: EXECUTE to anon, authenticated (00023 보강), service_role
- **호출처**: [src/data/businessHistory.js:29](../src/data/businessHistory.js#L29) `fetchBusinessHistoryByBuilding`
- **생성**: `00021_create_business_history_rpc.sql`

### 2.19 `match_business_history_to_buildings(p_district, p_nearest_max_m)` *(service_role 전용)*
- **파라미터**: `p_district VARCHAR DEFAULT '11140'`, `p_nearest_max_m INT DEFAULT 10`
- **반환**: `TABLE (contained_count, nearest_count, unmatched_count BIGINT)`
- **속성**: plpgsql. ST_Contains 1차 + nearest 폴백 (00024 에서 LATERAL 제거 수정).
- **GRANT**: PUBLIC REVOKE, service_role 만
- **호출처**: ETL — `scripts/etl/loadBusinessHistory.py` 적재 직후 1회
- **생성**: `00022_match_business_history.sql` + `00024_fix_match_rpc_lateral.sql`

### 2.20 `buildings_by_pnus_with_geom(p_pnus TEXT[])` *(service_role 전용)*
- **반환**: `TABLE (id, pnu, district_code, bjdong_cd, address, bld_nm, reg_type, main_purps, strct, arch_area, tot_area, plat_area, bc_rat, vl_rat, grnd_flr_cnt, ugrnd_flr_cnt, use_apr_day, data_source, geom_json JSONB)`
- **속성**: SQL STABLE PARALLEL SAFE
- **GRANT**: PUBLIC REVOKE, service_role 만
- **용도**: ETL 의 PNU 매칭. VWorld 폴리곤 교체 등.
- **호출처**: ETL 전용 (`updateBuildingGeom.py`, `supplementBuildingsFromLedger.py`)
- **생성**: `00025_buildings_by_pnus_rpc.sql`

### 추가 함수 (트리거용, 직접 호출 X)
- `trg_set_updated_at()` — BEFORE UPDATE 범용 트리거 (00011)
- `trg_cleanup_curated_on_survey_delete()` — AFTER DELETE on field_surveys, SECURITY DEFINER (00019)

---

## 3. 정적 데이터 파일

위치: `src/gis/data/`. 클라이언트가 fetch 또는 import 하는 형태.

| 파일 | 크기 | 형식 | 갱신일 | 내용 | 원본 출처 | 생성/갱신 |
|---|---|---|---|---|---|---|
| `junggu-buildings-final-lite.geojson` | 12.4 MB | GeoJSON FC | 2026-05-19 | 중구 건물 폴리곤 + 속성 (20,930 features) | DB `buildings` 테이블 | `scripts/etl/exportBuildingsToGeojson.py` |
| `junggu-buildings-final.geojson` | 12.5 MB | GeoJSON FC | 2026-04-14 | (구) 건축물대장+GIS 병합 결과, 사용 중단 가능성 | 건축물대장 API + GIS SHP | `scripts/etl/buildFinal.py` / `mergeAndTransform.py` |
| `land_use_junggu.geojson` | 8.2 MB | GeoJSON FC | 2026-04-07 | 중구+종로구 용도지역 폴리곤 (682 features) | (수동 다운로드 — 출처 미명시) | 수동 |
| `junggu-demographics.json` | 1.6 MB | JSON | 2026-04-02 | 집계구별 인구 + dot density | `서울_중구_집계구_2017.geojson` + 생활인구 CSV | `scripts/etl/buildDemographics.py` |
| `junggu-parks.json` | 1.2 MB | GeoJSON-like | 2026-05-07 | 녹지/공원/정원/수목지 폴리곤 (OSM 추출) | OpenStreetMap | (스크립트 미동봉 — 수동) |
| `junggu-transit.json` | 231 KB | JSON | 2026-04-02 | 중구 버스정류장 + 지하철 노선/역 | 서울교통공사 + 버스정류소 JSON | `scripts/etl/buildTransit.py` |
| `junggu-commerce.json` | 64 KB | JSON | 2026-04-02 | 상권(영역/점포/매출) | 서울 상권분석 CSV 3종 | `scripts/etl/buildCommerce.py` |
| `junggu-landmarks.json` | 6.9 KB | JSON | 2026-04-08 | 역사적 랜드마크 (위경도 + 설명) | 큐레이션 (수동) | 수동 |
| `sindang-survey-area.json` | 1.8 KB | GeoJSON FC | 2026-05-14 | 답사 영역 폴리곤 (20-vertex, RPC `sindang_area()` 와 동기) | 수동 정의 | 수동 |
| `survey-area.json` | 1.8 KB | GeoJSON FC | 2026-05-14 | (구) 답사영역 — 위 파일과 내용 동일 (중복) | — | — |
| `hwanghak-area.json` | 1.2 KB | GeoJSON FC | 2026-05-19 | 답사영역 황학동 분할 폴리곤 | 수동 정의 | 수동 (이번 작업) |
| `sindang5-area.json` | 1.8 KB | GeoJSON FC | 2026-05-19 | 답사영역 신당5동 분할 폴리곤 | 수동 정의 | 수동 (이번 작업) |

**주의**:
- `survey-area.json` 과 `sindang-survey-area.json` 은 동일 내용 — `survey-area.json` 은 레거시. 정리 가능.
- `hwanghak-area.json` + `sindang5-area.json` 합집합이 `sindang-survey-area.json` 과 거의 동일해야 함 (GisPage 의 동 선택 모드용 분할).

---

## 4. ETL 스크립트 목록

위치: `scripts/etl/`. 모든 Python 의존성은 `scripts/etl/requirements.txt` (`supabase>=2.0.0`, `shapely>=2.0.0`, `python-dotenv>=1.0.0`).

### 4.1 정적 GeoJSON 생성 (Phase 0)

| 스크립트 | 입력 | 출력 | 실행 | 환경변수 |
|---|---|---|---|---|
| `shpToGeojson.py` | `src/gis/data/AL_D010_11_20260309.shp`* | `raw/junggu-buildings-gis.geojson` | `python3 scripts/etl/shpToGeojson.py` | — |
| `fetchBuildings.js` | 공공데이터포털 표제부 API | `raw/junggu-buildings-raw.json` | `node scripts/etl/fetchBuildings.js` | `VITE_DATA_GO_KR_API_KEY` |
| `fetchBuildingsRecap.js` | 공공데이터포털 총괄표제부 API | `raw/junggu-buildings-recap.json` | `node scripts/etl/fetchBuildingsRecap.js` | `VITE_DATA_GO_KR_API_KEY` |
| `geocodeBuildings.js` | (raw 빌딩 주소) | 좌표 추가 | `node scripts/etl/geocodeBuildings.js` | `VITE_KAKAO_REST_API_KEY` |
| `mergeAndTransform.py` | GIS + 표제부 + 총괄표제부 | `junggu-buildings-final.geojson` (4326 변환) | `python3 scripts/etl/mergeAndTransform.py` | — |
| `buildFinal.py` | `raw/junggu-buildings-gis.geojson` | `junggu-buildings-final.geojson` (EPSG:5186→4326) | `python3 scripts/etl/buildFinal.py` | — |
| `buildTransit.py` | 서울교통공사 노선 JSON + 버스정류소 JSON | `junggu-transit.json` | `python3 scripts/etl/buildTransit.py` | (없음, raw 파일 사용) |
| `buildDemographics.py` | 집계구 GeoJSON + 생활인구 CSV | `junggu-demographics.json` | `python3 scripts/etl/buildDemographics.py` | — |
| `buildCommerce.py` | 상권 CSV 3종 | `junggu-commerce.json` | `python3 scripts/etl/buildCommerce.py` | — |

\* AL_D010 shp 는 raw/ 에 있음 (현재 경로상). buildFinal.py 는 raw/ 의 GIS geojson 을 입력.

### 4.2 Supabase 적재 (Phase 1, 2, 보강)

| 스크립트 | 입력 | 출력 | 실행 | 마지막 결과 |
|---|---|---|---|---|
| `loadBuildingsToSupabase.py` | `src/gis/data/junggu-buildings-final-lite.geojson` | `buildings` 테이블 (insert) | `python3 scripts/etl/loadBuildingsToSupabase.py [--limit N] [--dry-run] [--verbose]` | 20,533 적재 (Phase 1) |
| `loadZoningToSupabase.py` | `src/gis/data/land_use_junggu.geojson` | `zoning` 테이블 | `python3 scripts/etl/loadZoningToSupabase.py` | 682 적재 |
| `loadBusinessHistory.py` | `raw/서울시 일반음식점 인허가 정보.csv` (CP949) | `business_history` 테이블 + 매칭 RPC 실행 | `python3 scripts/etl/loadBusinessHistory.py` | 617 적재, building 매칭 573/617 |
| `supplementBuildingsFromLedger.py` | `raw/서울시 건축물대장 표제부.csv` + `raw/_dong_code_map.json` | `buildings` UPDATE (연면적/건축면적/주용도/구조/층수/사용승인일) | `python3 scripts/etl/supplementBuildingsFromLedger.py` | 답사영역 내 결측 일부 보강 |
| `supplementLandArea.py` | `raw/AL_D160_11_20251103/*.shp` (토지소유공간정보) | `buildings.plat_area` UPDATE + vl_rat/bc_rat 재계산 | `python3 scripts/etl/supplementLandArea.py` | 5% 수준 효과 |
| `updateBuildingGeom.py` | `raw/sindang-vworld-buildings.geojson` | `buildings.geom` UPDATE (1:1/N:M) + 새 건물 INSERT | `python3 scripts/etl/updateBuildingGeom.py [--dry-run]` | 답사영역 ~2,251 폴리곤 교체 + 397 INSERT (data_source=vworld_spbd_20260519) |
| `exportBuildingsToGeojson.py` | DB `buildings` (전체 중구) | `src/gis/data/junggu-buildings-final-lite.geojson` (덮어쓰기) | `python3 scripts/etl/exportBuildingsToGeojson.py` | 20,930 export, 12.4 MB |

**공통 환경변수** (Supabase 적재 스크립트): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (service_role).

---

## 5. 원본 데이터(raw) 목록

위치: `scripts/etl/raw/`. 총 **약 2.0 GB**.

| 파일 | 크기 | 출처 | 다운로드/생성일 | 내용 |
|---|---|---|---|---|
| `AL_D010_11_20260309.shp` (+ dbf/shx/prj/fix) | 1.4 GB | (출처 미명시 — 건축물 GIS) | 2026-04-02 (raw 폴더 mtime) | 건축물 GIS 폴리곤 |
| `AL_D160_11_20251103/AL_D160_11_20251103.shp` (+ dbf/shx/prj/fix) | 1.0 GB | 국토교통부 토지소유공간정보 (LX) | 2026-05-19 | 토지필지(대지) 폴리곤 — plat_area 보강용 |
| `junggu-buildings-gis.geojson` | 19.3 MB | shpToGeojson 변환 결과 | 2026-04-02 | EPSG:5186 → 4326 변환 전/후 |
| `junggu-buildings-raw.json` | 18.7 MB | 공공데이터포털 표제부 API | 2026-04-02 | 건축물대장 표제부 (PNU + 속성) |
| `junggu-buildings-recap.json` | 461 KB | 공공데이터포털 총괄표제부 API | 2026-04-02 | 총괄표제부 (집합건물 집계) |
| `junggu-buildings-final.geojson` | 12.2 MB | mergeAndTransform 출력 | 2026-04-02 | 좌표변환 + 병합 결과 |
| `sindang-vworld-buildings.geojson` | 2.8 MB | VWorld WFS `lt_c_spbd` BBOX 3×3 분할 다운로드 | 2026-05-19 | 답사영역 VWorld 건물 폴리곤 (geom 교체용) |
| `서울시 건축물대장 표제부.csv` | 253 MB | 서울 열린데이터광장 | 2026-05-19 | 표제부 풀 덤프 (CP949) — supplementBuildingsFromLedger 입력 |
| `서울시 일반음식점 인허가 정보.csv` | 1.6 MB | 서울 열린데이터광장 | 2026-05-14 | 일반음식점 인허가 (EPSG:2097) — business_history 입력 |
| `서울_중구_집계구_2017.geojson` | 962 KB | 통계청 SGIS 집계구 (2017) | 2026-04-02 | 인구 dot density 베이스 |
| `서울교통공사_노선별 지하철역 정보.json` | 142 KB | 공공데이터포털 / 서울교통공사 | 2026-04-02 | 지하철역 좌표/노선 |
| `서울시 버스정류소 위치정보.json` | 1.7 MB | 서울 열린데이터광장 | 2026-04-02 | 버스정류장 좌표 |
| `서울시 상권분석서비스(영역-상권).csv` | 172 KB | 서울 열린데이터광장 | 2026-04-02 | 상권 영역 폴리곤 |
| `서울시 상권분석서비스(점포-상권).csv` | 29 MB | 서울 열린데이터광장 | 2026-04-02 | 상권별 점포 |
| `서울시 상권분석서비스(추정매출-상권).csv` | 38 MB | 서울 열린데이터광장 | 2026-04-02 | 상권별 추정매출 |
| `집계구 단위 서울 생활인구(내국인).csv` | 120 MB | 서울 열린데이터광장 | 2026-04-02 | 시간대별 생활인구 |
| `_dong_code_map.json` | 1.3 KB | (수동 추출, supplementBuildingsFromLedger 시 생성) | 2026-05-19 | 동명 → 법정동코드(5) 매핑 |

> **주의**: raw/ 는 `.gitignore` 대상이거나 LFS 권장. 2GB 규모.

---

## 6. 데이터 흐름도

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                ORIGIN (외부)                                  │
│                                                                              │
│  공공데이터포털 ──┬─ 표제부 API ──────────┐                                    │
│   (data.go.kr)  └─ 총괄표제부 API ───────┤                                    │
│                                          │                                    │
│  국토부 (LX) ─── AL_D010 SHP / AL_D160 SHP                                    │
│                                          │                                    │
│  서울 열린데이터 ─┬─ 건축물대장 CSV ─────┤                                    │
│   (data.seoul)   ├─ 음식점 인허가 CSV ─┐ │                                    │
│                  ├─ 집계구·생활인구 ───┤ │                                    │
│                  ├─ 상권 CSV 3종 ──────┤ │                                    │
│                  └─ 버스정류소 ────────┤ │                                    │
│                                        │ │                                    │
│  서울교통공사 ─── 지하철 노선 JSON ────┤ │                                    │
│                                        │ │                                    │
│  VWorld WFS ───── lt_c_spbd 폴리곤 ──┐ │ │                                    │
│                                      │ │ │                                    │
│  카카오 지오코딩 (실행시점 호출) ────┤ │ │                                    │
└──────────────────────────────────────┼─┼─┼────────────────────────────────────┘
                                       │ │ │
                                       ▼ ▼ ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       scripts/etl/raw/  (로컬 캐시 ~2 GB)                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            ▼                          ▼                          ▼
    ┌──────────────┐         ┌──────────────────┐        ┌────────────────┐
    │  Phase 0 ETL  │        │  Phase 1/2 ETL   │        │  Phase 2 보강   │
    │ (정적 GeoJSON) │        │ (Supabase 적재)  │        │ (DB UPDATE)    │
    ├──────────────┤         ├──────────────────┤        ├────────────────┤
    │ buildFinal   │         │ loadBuildings    │        │ supplement     │
    │ buildTransit │         │ ToSupabase       │        │ BuildingsFrom  │
    │ buildDemo    │         │ loadZoning       │        │ Ledger         │
    │ buildCommerce│         │ ToSupabase       │        │ supplement     │
    │ mergeAndTrans│         │ loadBusiness     │        │ LandArea       │
    │ shpToGeojson │         │ History          │        │ updateBuilding │
    └──────┬───────┘         └────────┬─────────┘        │ Geom           │
           │                          │                  └────────┬───────┘
           ▼                          ▼                           │
    ┌──────────────┐         ┌──────────────────┐                │
    │ src/gis/data/│         │  Supabase (8 tbl)│◄───────────────┘
    │ (정적 파일)   │ ────┐   │ buildings/zoning/│
    │ ~37 MB       │     │   │ field_surveys/   │
    └──────────────┘     │   │ curated_*(3)/    │
           ▲             │   │ business_history │
           │             │   └────────┬─────────┘
           │             │            │
           │  exportBuildings         │
           │  ToGeojson (DB→정적)     │
           │             │            │
           │   ┌─────────┴────────┐   │
           │   │  Supabase RPC   │   │
           │   │  (15+ functions) │   │
           │   └─────────┬────────┘   │
           │             │            │
           │             ▼            ▼
           │   ┌──────────────────────────────────┐
           └───┤  src/data/  (클라이언트 데이터 레이어) │
               │  buildings.js / zoning.js  ← DB 우선, 정적 폴백   │
               │  surveys.js / curated.js   ← DB 전용              │
               │  businessHistory.js        ← DB 전용              │
               │  articles.js               ← CF Worker R2         │
               └──────────────────────┬───────────────────────────┘
                                      │
                                      ▼
               ┌────────────────────────────────────────┐
               │           React 페이지 / 컴포넌트         │
               │  GisPage / SurveyPage / SurveyAdminPage │
               │  ArticlesPage / HomePage                │
               └────────────────────────────────────────┘
```

**핵심 패턴**:
- Phase 0: raw → 정적 JSON → 클라이언트 fetch (오프라인 가능)
- Phase 1/2: raw → 정적 JSON → DB 적재 → RPC → 클라이언트 (DB 우선, 정적 폴백)
- Phase A~C: 클라이언트 INSERT (현장조사) → DB raw → admin RPC → DB curated → 클라이언트 SELECT

---

## 7. 클라이언트 데이터 레이어

위치: `src/data/`. 모든 페이지는 이 파일들만 import — Supabase 직접 의존 없음.

| 파일 | 역할 | RPC / 테이블 | 정적 폴백 | 사용 페이지 |
|---|---|---|---|---|
| `buildings.js` | 반경 내 건물 조회 | RPC `buildings_within` | ✅ `junggu-buildings-final-lite.geojson` | GisPage |
| `zoning.js` | 반경 내 용도지역 | RPC `zoning_intersect` | ✅ `land_use_junggu.geojson` | GisPage |
| `businessHistory.js` | 건물별 음식점 이력 | RPC `fetch_business_history_by_building` | ❌ (DB 전용) | GisPage (BuildingDetail) |
| `surveys.js` | 현장조사 CRUD + 진행률 + Storage | RPC 9종 + table `field_surveys` + Storage | ❌ (write-mandatory) | SurveyPage, SurveyAdminPage, GisPage |
| `curated.js` | 정제 데이터 조회 (대시보드) | RPC `fetch_curated_{buildings,roads,points}` | ❌ (DB 가 single source of truth) | GisPage (Phase D — 미구현) |
| `articles.js` | 아티클 fetch (Cloudflare Worker R2) | `https://orange-cherry-8597.gwansul743.workers.dev` | — (외부 API) | ArticlesPage, GisPage(ArticlePanel) |
| `articleVisuals.js` | 아티클별 GIS 시각자료 매핑 | (현재 비어있음 — 확장 포인트) | — | GisPage |

**어댑터** (`src/data/adapters/`):
- `buildingAdapter.js` — RPC 행 → camelCase GeoJSON Feature
- `zoningAdapter.js` — 동일 패턴
- `businessHistoryAdapter.js` — snake → camel + `isActive` 파생값
- `curatedAdapter.js` — `dbRowsToCuratedBuildingFeatureCollection` 등 3종

**Supabase 클라이언트 초기화**: [src/lib/supabase.js](../src/lib/supabase.js) — anon key 사용, `persistSession=false`. `VITE_SUPABASE_URL` 또는 `VITE_SUPABASE_ANON_KEY` 누락 시 `supabase=null` → 모든 데이터 모듈이 정적 폴백/빈 결과로 동작.

**모드 토글**:
- `VITE_USE_DB_BUILDINGS=true` → buildings.js 가 DB RPC 사용
- `VITE_USE_DB_ZONING=true` → zoning.js 가 DB RPC 사용
- 그 외는 정적 폴백 모드

---

## 8. 환경변수 목록

위치: `.env`, `.env.local`. 둘 다 `.gitignore` 권장 (커밋 X 확인 필요).

| 변수명 | 용도 | 사용처 | 민감도 |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL | 프론트엔드 (`src/lib/supabase.js:8`) | 공개 가능 (브라우저 노출 OK) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon JWT | 프론트엔드 (`src/lib/supabase.js:9`) | 공개 가능 (RLS 로 보호) |
| `VITE_USE_DB_BUILDINGS` | `'true'` 시 buildings DB 모드 | 프론트엔드 (`src/data/buildings.js:22`) | 공개 가능 |
| `VITE_USE_DB_ZONING` | `'true'` 시 zoning DB 모드 | 프론트엔드 (`src/data/zoning.js:21`) | 공개 가능 |
| `VITE_VWORLD_API_KEY` | VWorld 베이스맵 타일 | 프론트엔드 (`GisPage.jsx:732`, `SurveyMap.jsx:57`, `MiniMap.jsx:15`) | **반공개** — 도메인 화이트리스트 필수 |
| `VITE_KAKAO_REST_API_KEY` | 카카오 카테고리/지오코딩 API | 프론트엔드 (`GisPage.jsx:76`) + ETL (`geocodeBuildings.js`) | **반공개** — 도메인 화이트리스트 필수, 프록시 권장 |
| `VITE_SURVEY_PASSWORD` | 조사원 페이지 게이트 비밀번호 | 프론트엔드 (`SurveyPage.jsx:17`, 폴백 `Gwansul8&`) | **공유 비밀** — 비공개 저장소 가정 |
| `VITE_SURVEY_ADMIN_PASSWORD` | 관리자 페이지 게이트 + admin RPC 호출 | 프론트엔드 (`adminAuth.js:13`, 폴백 `Gwansul8&`) | **공유 비밀** — RPC 평문 전달, DB 함수 본문에도 평문 |
| `VITE_DATA_GO_KR_API_KEY` | 공공데이터포털 건축물대장 API | ETL only (`fetchBuildings.js`, `fetchBuildingsRecap.js`) | **비밀** |
| `VITE_SEOUL_OPENDATA_KEY` | (legacy — 현재 src/ 코드에서 미사용) | — | **비밀** |
| `VITE_ORS_API_KEY` | (legacy OpenRouteService — 현재 src/ 코드에서 미사용) | — | **비밀** |
| `SUPABASE_URL` | ETL service 접속 (anon 과 동일 URL) | ETL Python 7개 (`os.environ`) | 공개 가능 |
| `SUPABASE_SERVICE_KEY` | service_role 키 (RLS 우회) | ETL Python 7개 | **극비** — 브라우저 노출 절대 금지, .env.local 만 |

> **민감도 등급**:
> - **공개**: VITE_ 접두사로 번들 포함됨. RLS/도메인 화이트리스트로 보호되는 키.
> - **반공개**: 도메인 화이트리스트 의존. 키 유출 시 쿼터 도용 가능.
> - **공유 비밀**: 평문 평등 분배 모델. DB 함수 본문에도 평문 (`admin_check_password()`).
> - **극비**: service_role — RLS 완전 우회. ETL 머신에만 둘 것.

---

## 9. 테이블 관계도 (ERD)

```
┌──────────────────┐
│   buildings      │   ◄────────── pnu (논리 키, 중복 허용)
│ ───────────────  │
│ id    PK(BIGINT) │◄─┐
│ pnu   VARCHAR    │  │
│ geom  Polygon    │  │
│ ...              │  │
└──────┬───────────┘  │
       │              │
       │ 공간 매칭    │
       │ ST_Contains  │
       │ /Intersects  │
       │              │
       ▼              │
┌──────────────────┐  │
│ business_history │  │
│ ───────────────  │  │ FK 미강제
│ id     PK        │  │ (ETL 매칭 결과)
│ building_id  FK?─┼──┤
│ building_pnu     │──┘
│ geom  Point      │
│ ...              │
└──────────────────┘

                                   ┌─────────────────────┐
                                   │   field_surveys     │
                                   │ ─────────────────── │
                                   │ id    PK(UUID)      │
                                   │ survey_type         │
                                   │ location  Point     │
                                   │ building_id  FK?─┐  │
                                   │ building_pnu     │  │
                                   │ payload  JSONB   │  │
                                   │ status           │  │
                                   │ photo_paths[]    │  │
                                   └────────┬─────────┘  │
                                            │            │
            ┌───────────────────────────────┼────────────┘
            │                               │
            │   admin_approve_survey_*      │  FK 미강제
            │   (1 건물 = 1 row)            │  (소프트 참조 ─ id 또는 pnu)
            ▼                               ▼
┌─────────────────────┐         ┌──────────────────┐
│ curated_buildings   │         │   buildings      │
│ ──────────────────  │         │ (이미 위에 있음)  │
│ id   PK             │         └──────────────────┘
│ building_id   FK?   │─────────►
│ building_pnu        │─────────►  논리적 매칭
│ source_survey_ids[] │─┐
│ first_floor_use     │ │
│ is_vacant           │ │
└─────────────────────┘ │
                        │  AFTER DELETE on field_surveys
                        │  → trg_cleanup_curated_on_survey_delete()
                        └─→ array_remove(source_survey_ids, OLD.id)
                            빈 배열 시 DELETE

┌─────────────────────┐    ┌─────────────────────┐
│   curated_roads     │    │   curated_points    │
│ ──────────────────  │    │ ──────────────────  │
│ id   PK             │    │ id   PK             │
│ location  Point     │    │ location  Point     │
│ source_survey_ids[] │    │ source_survey_ids[] │
│ night_brightness    │    │ category    NOT NULL│
│ road_width          │    └─────────────────────┘
└─────────────────────┘    (1 조사 = 1 row, 1:1)

┌──────────────────┐
│     zoning       │   (독립 — buildings 와 직접 FK 없음)
│ ───────────────  │   공간 매칭: ST_Intersects(building.geom, zoning.geom)
│ id   PK          │   클라이언트 측에서 centroid in polygon 으로 zoning 명 추출
│ zone_name        │
│ geom  Polygon    │
└──────────────────┘
```

**FK 정책**:
- 모든 외부 키는 **FK 강제 X**. 이유: buildings 재적재/스코프 변경 시 dangling 방지 + 정적 모드 호환.
- 대신 `building_id`(BIGINT) 와 `building_pnu`(TEXT) 양쪽 모두 저장 → 어떤 키로든 매칭 가능 (`OR` 매칭).

**공간 관계**:
- `buildings.geom ⟷ business_history.geom` — `ST_Contains` + 10m nearest 폴백 (`match_business_history_to_buildings` RPC)
- `buildings.geom ⟷ sindang_area()` — `ST_Intersects` (3,452 건물)
- `buildings.geom ⟷ zoning.geom` — `ST_Intersects` (클라이언트/RPC 양쪽)
- `field_surveys.location ⟷ sindang_area()` — `ST_Intersects`

---

## 10. 결측 현황 (답사 영역 기준)

답사영역 안 buildings = **3,452 건** (centroid in `sindang_area()`). data_source 분포: moldt 3,055 + vworld 397.

### buildings 결측률

| 컬럼 | 결측 수 | 결측률 | 원인 | 보강 가능 여부 |
|---|---:|---:|---|---|
| `bld_nm` | 3,419 | **99.0%** | 원본 GIS·표제부 모두 건물명 거의 비어있음. VWorld `buld_nm` 만 일부 채움 (397건 중 일부) | ❌ 추가 출처 없음 — 현장조사로만 |
| `ugrnd_flr_cnt` | 1,946 | 56.4% | VWorld INSERT 행 (397건) 은 전체 NULL + 원본 0→NULL 치환 | ⚠️ 부분 (supplementBuildingsFromLedger 재실행) |
| `bc_rat` | 1,941 | 56.2% | 건폐율 원본 0 → NULL. 표제부 보강 시 일부 채워짐 | ⚠️ plat_area + arch_area 가 있으면 재계산 가능 |
| `arch_area` | 1,849 | 53.6% | 원본 0 또는 표제부 결측 | ⚠️ 표제부 재보강 |
| `use_apr_day` | 1,023 | 29.6% | 원본 빈값/파싱불가 → NULL | ⚠️ 표제부 재보강 (낮은 매칭률) |
| `vl_rat` | 990 | 28.7% | 원본 0 → NULL | ⚠️ plat_area + tot_area 가 있으면 재계산 |
| `grnd_flr_cnt` | 767 | 22.2% | 원본 0 → NULL | ⚠️ 표제부 재보강 |
| `tot_area` | 765 | 22.2% | VWorld INSERT 행 + 일부 표제부 결측 | ⚠️ 표제부 재보강 |
| `main_purps` | 765 | 22.2% | 동일 | ⚠️ 표제부 재보강 |
| `strct` | 765 | 22.2% | 동일 | ⚠️ 표제부 재보강 |
| `plat_area` | 703 | 20.4% | 원본 0 → NULL. supplementLandArea 효과 5% 수준 (Phase 2 분석) | ⚠️ 토지소유공간정보 SHP 재실행, 매칭 알고리즘 개선 필요 |
| `address` | 397 | 11.5% | VWorld INSERT 행은 address 미수집 | ⚠️ 카카오 reverse geocoding으로 채움 가능 |

> **공통 원인**:
> - **397 건 (vworld INSERT)**: VWorld 데이터에는 폴리곤 + buld_nm 만 있고 나머지 속성 없음. 별도 표제부 매칭 필요.
> - **표제부 보강의 한계**: `supplementBuildingsFromLedger.py` 가 PNU 19자리 = "11140" + bjdong_cd + 대지/산 + 주지번 + 부지번 로 매칭하는데, 표제부 동명/지번 표기 변형이 많아 매칭률이 낮음.

### business_history 결측률 (전체 617건, 답사영역 기준 적재)

| 컬럼 | 결측 수 | 결측률 | 원인 | 보강 가능 여부 |
|---|---:|---:|---|---|
| `road_address` | 308 | **49.9%** | 옛 인허가 데이터는 도로명주소 컬럼 자체가 비어있음 | ❌ 원본 한계 |
| `closed_at` | 178 | 28.8% | 영업 중 (status='영업/정상') 인 178건은 폐업일 없음이 정상 | ✅ 결측 아님 |
| `building_id`, `building_pnu` | 44 | 7.1% | ST_Contains 1차 + 10m nearest 폴백 모두 실패 — 건물 폴리곤 외곽 | ⚠️ nearest 임계치 완화 (현재 10m) |
| `site_area_m2` | 4 | 0.6% | 원본 0 → NULL | ❌ 원본 한계 |
| `business_type` | 0 | 0% | — | — |
| `opened_at` | 0 | 0% | — | — |

### zoning 결측률 (전체 682건, 중구+종로구 혼재)

| 컬럼 | 결측 수 | 결측률 | 원인 | 보강 가능 여부 |
|---|---:|---:|---|---|
| `dgm_ar` | 8 | 1.2% | 원본 0 → NULL | ❌ 원본 한계 (8건만, 무시 가능) |
| 그 외 | 0 | 0% | — | — |

### field_surveys / curated_*

- `field_surveys`: 15건 모두 pending. 결측 분석 의미 X.
- `curated_buildings/roads/points`: 0건. 아직 운영 시작 전.

### 결측 보강 우선순위 제안

1. **표제부 재매칭 알고리즘 개선** — `supplementBuildingsFromLedger.py` 의 동코드 매핑 + 지번 정규화 강화 → 22~30% 군 (tot_area, main_purps, strct, grnd_flr_cnt, vl_rat, use_apr_day) 단번에 개선 기대.
2. **397 vworld 행 속성 보강** — pnu 동일 표제부 row 가 있으면 attach. 동일 PNU 의 기존 moldt 행에서 속성 복사도 가능.
3. **bc_rat / vl_rat 재계산** — `plat_area + arch_area + tot_area` 조합으로 계산 가능한 행은 자동 채움 (`supplementLandArea.py` 의 패턴 확장).
4. **business_history nearest 임계치** — 10m → 20~30m 완화 후 영향 측정 (잘못 매칭 위험).
5. **bld_nm** — 표제부 매칭률 낮은 한계. 현장조사 시 입력받는 것이 현실적.
