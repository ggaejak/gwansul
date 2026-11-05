# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

관설(觀雪) — 서울 중구, 특히 신당동 답사영역(황학동 + 신당5동)의 도시 데이터 플랫폼.
React 18 + Vite SPA(GitHub Pages, `gwansul.co.kr`) / Supabase(PostgreSQL + PostGIS + Storage) / Cloudflare Worker(AI 챗봇, 아티클) / Python ETL 로 구성된다.
코드 주석·문서·커밋 메시지는 모두 한국어다.

**가장 먼저 볼 문서: `docs/data-catalog.md`** — Supabase 테이블·RPC 전체 목록, 정적 파일, ETL 입출력, raw 데이터, ERD, 환경변수, 결측률이 한곳에 정리돼 있다. 설계 결정의 근거는 `docs/backend-migration-plan.md` 와 `docs/migration-questions.md`(Q1~Q10).

## 명령어

```bash
npm run dev       # Vite 개발 서버
npm run build     # 프로덕션 빌드 → dist/
npm run preview   # 빌드 결과 미리보기
```

- **자동화 테스트·린트 설정이 없다.** 검증은 `npm run build` 통과 + `docs/phase1-test-scenarios.md`, `docs/phase2-test-scenarios.md` 의 수동 시나리오(특히 "시나리오 A — 정적 모드 회귀"는 반드시 통과해야 함).
- 빌드 시 500 kB chunk 경고는 정상이다(건물 geojson ~13 MB 등 대용량 정적 데이터가 asset 으로 번들됨).
- `.env.local` 변경은 HMR 로 반영되지 않는다 → dev 서버 재기동.

ETL (Python, `scripts/etl/`):
```bash
pip install -r scripts/etl/requirements.txt
python3 scripts/etl/loadBuildingsToSupabase.py --dry-run --limit 100 --verbose
```
- Supabase 적재/보강 스크립트(`load*`, `supplement*`, `updateBuildingGeom`)는 `--dry-run` 을 지원한다. DB 쓰기 전에 먼저 dry-run.
- 입력 원본은 `scripts/etl/raw/`(~2 GB, gitignore) 에 있으며 **이 저장소/컨테이너에는 없다.** raw 가 필요한 스크립트는 여기서 실행할 수 없다.

Cloudflare Worker (`workers/`): `wrangler.toml` 기준으로 wrangler 로 배포. 시크릿(`ANTHROPIC_API_KEY`, `ADMIN_PASSWORD`)은 `wrangler secret put`.

## 아키텍처

### 라우트 (`src/App.jsx`)
`/` 랜딩(`src/components/*.jsx`) · `/gis` 분석 대시보드 · `/articles` · `/admin`(아티클 PDF 업로드) · `/survey`(조사원용, 모바일 우선) · `/survey-admin`(조사 검토).
GitHub Pages SPA 딥링크는 `public/404.html` 이 경로를 `sessionStorage.redirect` 에 저장 → `index.html` 인라인 스크립트가 복원하는 방식이다. 둘 중 하나만 고치면 깨진다.

### 데이터 레이어 규칙 (`src/data/`)
페이지·컴포넌트는 **`src/data/*` 만 import 하고 Supabase 를 직접 호출하지 않는다.** `src/lib/supabase.js` 는 env 누락 시 `supabase = null` 로 두고 앱을 죽이지 않는다. 도메인별로 실패 처리 패턴이 다르다:

| 패턴 | 모듈 | 동작 |
|---|---|---|
| DB 우선 + 정적 폴백 | `buildings.js`, `zoning.js` | `VITE_USE_DB_BUILDINGS` / `VITE_USE_DB_ZONING` 이 문자열 `'true'` 일 때만 RPC 사용. RPC 에러 시 `src/gis/data/*.geojson` 으로 자동 폴백 |
| DB 전용 읽기 | `curated.js`, `businessHistory.js` | 실패 시 빈 FeatureCollection + 경고 |
| 쓰기 필수 | `surveys.js` | 읽기는 빈 결과, 쓰기는 throw |

- DB 모드는 반경 내 데이터만 반환하므로 중심점 이동 시 재호출이 필요하다. 정적 모드는 전체를 반환하고 반경 필터는 `GisPage` 에서 클라이언트 측으로 한다. 두 경로 모두 같은 결과 형태를 유지해야 한다.
- `adapters/*` 가 RPC 의 snake_case 행을 GisPage·`chatContext.js` 가 기대하는 camelCase GeoJSON 속성(`vl_rat`→`vlRat`, `bld_nm`→`bldNm` …)으로 변환한다. RPC 컬럼을 바꾸면 어댑터도 함께 바꾼다.
- 결측값: ETL 이 원본의 `0`/`''` 를 `NULL` 로 치환해 저장한다. 클라이언트는 `props.vlRat > 0` 같은 느슨한 비교로 결측을 거른다.
- 교통·인구·상권·랜드마크·공원·답사영역 폴리곤 등 나머지 정적 데이터는 `GisPage` 가 `src/gis/data/` 에서 직접 import/fetch 한다.

### GisPage (`src/pages/GisPage.jsx`, ~3,000줄 단일 파일)
메인 컴포넌트 하나와 다수의 하위 컴포넌트(분석 섹션마다 지도용 `*Layer` + 패널용 `*Content` 쌍)가 한 파일에 있다.
- 지도 클릭 → `clickedPoint` + `radius`(기본 400 m) → 모든 레이어/통계가 그 반경으로 필터링(`fastDistM`).
- 모드는 URL 쿼리로 관리: `?mode=articles&id=…` 이면 아티클 모드, 아니면 분석 모드.
- 편의시설은 클라이언트에서 Kakao Local API 직접 호출(`VITE_KAKAO_REST_API_KEY`).
- 챗봇: `components/gis/chatContext.js` 가 반경 내 데이터를 ~2K 토큰 통계 텍스트로 직렬화 → Worker `/api/chat` → Claude 스트리밍 응답.
- 아티클별 지도 시각 자료 확장 포인트는 `src/data/articleVisuals.js` (현재 비어 있음).

### 현장조사 시스템 — 메달리언 구조
`field_surveys`(raw, 익명 INSERT, `type` = building/road/point, `status` = pending/approved/rejected)
→ 관리자가 `admin_*` SECURITY DEFINER RPC 로 승인
→ `curated_buildings`(1 건물 = 1 row, `source_survey_ids` 로 추적) / `curated_roads` / `curated_points`.
- raw → curated 는 단방향. raw 는 status 외 수정하지 않는 것이 원칙이며, 대시보드는 curated 만 본다.
- 사진은 Storage 버킷 `survey-photos`, 경로 `{yyyy-mm}/{survey_id}_{idx}.jpg`, 업로드 전 `lib/compressImage.js` 로 압축.
- 인증은 공유 비밀번호 게이트 수준이다. admin RPC 는 비밀번호를 평문 인자로 받아 `admin_check_password()` 로 검증한다. **관리자 비밀번호 변경 시 마이그레이션의 `admin_check_password()` 와 `VITE_SURVEY_ADMIN_PASSWORD` 를 동시에 바꿔야 한다** (`src/lib/adminAuth.js` 주석 참고).
- 라벨/타입 매핑은 `src/lib/surveyLabels.js` 에 모여 있다.

### 답사영역 폴리곤 동기화
- `src/gis/data/sindang-survey-area.json` 과 DB 함수 `sindang_area()`(마이그레이션 00018)는 **같은 폴리곤이어야 한다.** 한쪽을 바꾸면 다른 쪽도 바꾼다.
- `hwanghak-area.json` + `sindang5-area.json` 은 GisPage 동(洞) 선택용 분할본이며 합집합이 위 폴리곤과 거의 같아야 한다.
- `survey-area.json` 은 레거시 중복 파일.

### Supabase 마이그레이션 (`supabase/migrations/`)
- Supabase CLI 설정이 없다. SQL 파일을 **번호 순서대로 Supabase SQL Editor 에서 수동 실행**한다. Storage 정책 일부도 수동 설정이다(`docs/phase-a-storage-setup.md`, `docs/phase-c-storage-delete-policy.md`).
- 새 변경은 다음 번호(`000NN_snake_case.sql`)로 추가하고, 이미 적용된 파일은 고치지 않는다(수정은 새 마이그레이션으로 — 예: 00023, 00024).
- 파일 헤더 형식을 따른다: `Migration / Order / Purpose / Verification`(검증 SQL 포함).
- PostgREST `max_rows` 1,000 제한 때문에 대량 결과 RPC 는 JSONB FeatureCollection 을 반환한다(00016 참고).
- `buildings_by_pnus_with_geom`, `match_business_history_to_buildings` 는 service_role 전용(ETL 용)이다.

### ETL 흐름
- Phase 0: raw → `src/gis/data/` 정적 JSON (`build*.py`, `fetch*.js`, `mergeAndTransform.py`).
- Phase 1/2: 정적/raw → Supabase 적재. service_role 키(`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`)를 `.env.local` → `.env` 순으로 로드.
- 현재 건물 데이터의 원천은 DB 다. `exportBuildingsToGeojson.py` 가 DB 에서 `junggu-buildings-final-lite.geojson`(정적 폴백 파일)을 재생성한다. `junggu-buildings-final.geojson` 은 구버전.
- `loadBuildingsToSupabase.py` 는 `buildings` 테이블이 비어 있지 않으면 중단한다(재적재 전 수동 `TRUNCATE`).
- `.github/workflows/etl-buildings.yml` 은 `workflow_dispatch` 전용이다. **cron/push 트리거를 추가하지 말 것** (Q2 결정: 재수집은 수동).

### Cloudflare Worker 두 개
- `gwansul-api.gwansul743.workers.dev` — `workers/src/index.js`. `/api/chat`(Claude 프록시, 모델명 하드코딩) + 아티클 CRUD. `GisChatbot.jsx` 가 사용.
- `orange-cherry-8597.gwansul743.workers.dev` — 기존 아티클 R2 저장소. **소스가 이 저장소에 없다.** `src/data/articles.js`, `ArticlesPage.jsx`, `AdminPage.jsx` 가 사용.

### 배포
`main` push → `.github/workflows/deploy.yml` → GitHub Pages. `VITE_*` 값은 저장소 Secrets 에서 빌드 시점에 주입된다. (`docs/phase1-env-setup.md` §4 의 "deploy.yml 에 env 미지정" 설명은 현재와 다르다 — deploy.yml 이 기준.)

## 컨벤션

- 커밋: `type(scope): 한국어 설명` — scope 예: `gis`, `survey`, `data`, `ci`, `docs`.
- CSS 클래스 접두사는 영역별로 고정: `g-`(gis), `ga-`(gis 아티클), `gc-`(챗봇), `sv-`(survey), `sa-`(survey-admin). 스타일은 `src/styles/` 에 영역별 파일.
- 좌표 순서 주의: Leaflet 은 `[lat, lng]`, GeoJSON·RPC 인자는 `lng, lat`.
- 자치구 코드 기본값 `'11140'`(중구). 스키마는 타구 확장을 고려해 `district_code` 를 둔다.
- 정적 이미지는 `public/images/` 에서 `/images/…` 로 서빙된다. 루트 `images/` 는 같은 내용의 중복본.
- 환경변수 전체 목록과 민감도는 `docs/data-catalog.md` §8. `SUPABASE_SERVICE_KEY` 는 ETL 전용이며 `VITE_` 접두사를 붙이면 안 된다.
