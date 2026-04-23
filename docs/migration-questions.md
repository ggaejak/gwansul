# 백엔드 이관 — 결정 필요 질문 목록

**작성일**: 2026-04-23
**상태**: Phase 0 계획 수립 단계. 아래 질문은 Phase 1 시작 전 확정 필요.

표기:
- 🔴 **차단**: 이 결정 없이 Phase 1 시작 불가
- 🟡 **권장**: Phase 1 중간에 정해도 되지만 일찍 정할수록 낫다
- 🟢 **후속**: Phase 2 이후 결정해도 무방

---

## 🔴 차단 질문 (Phase 1 시작 전 필수)

### Q1. 결측값 원본 보존 여부
`vlRat=0`, `bcRat=0`, `useAprDay=''` 같은 "의미 있는 결측"을 DB에서 `NULL`로 치환하는 것이 원칙.

- **Option A**: `vl_rat NUMERIC` 하나만 두고 결측은 `NULL` (권장, 단순)
- **Option B**: `vl_rat NUMERIC` + `vl_rat_raw NUMERIC`를 함께 보관 (원본 0도 같이 저장 — 결측 원인 추적 가능하지만 용량 2배)

**제약**: 무료 티어 500MB. 건물 24k에서 컬럼 10개 × 2배 = 수 MB 차이뿐.

**결정 필요**: A / B / 특정 필드만 B

---

### Q2. 건물 재수집 주기와 source 태깅
국토부 건축물대장 API([fetchBuildings.js](../scripts/etl/fetchBuildings.js))는 얼마에 한 번 재수집하나?

- **Option A**: 수동, 변경 있을 때만 (현재 방식)
- **Option B**: 월 1회 cron (GitHub Actions)
- **Option C**: 분기 1회

`data_source` 필드 값 예시:
- `moldt_brtitle_20260309` (수집일 기준 — 추적 용이, 버전 증가 필요)
- `moldt_brtitle_v1` (버전 고정 — 업데이트 시 tag만 갱신)

**결정 필요**: 주기 + 태깅 규칙

---

### Q3. 클라이언트 ↔ Supabase 접근 방식
브라우저에서 Supabase를 어떻게 부를 것인가?

- **Option A**: `@supabase/supabase-js` SDK 직접 호출 (anon key 노출, RLS로 보안). 단순하고 빠름. **권장 기본값**
- **Option B**: 기존 Cloudflare Worker에 `/api/buildings?...` 프록시 엔드포인트 신규. 키 은닉 + 캐싱 가능하지만 레이턴시 +1홉
- **Option C**: Supabase Edge Functions로 프록시 (SDK보다 유연)

공개 데이터이고 anon key는 브라우저 노출 OK라는 점에서 **A가 가장 단순**. 단, 추후 유료 API(예: 대민 데이터) 붙을 때 B 도입 여지.

**결정 필요**: A / B / C

---

## 🟡 권장 질문 (Phase 1 진행 중)

### Q4. 반경 변경 요청 스로틀링
슬라이더를 조작하는 동안 매 순간 RPC가 발사되면 초당 수십 건. 어떻게 제어할까?

- **Option A**: 300ms debounce (일반적). 슬라이더 멈춘 뒤에만 fetch
- **Option B**: 뷰포트 이동 시 **최대 반경 + 여유분**까지 한 번에 가져오고, 슬라이더는 클라이언트 filter로 처리 (fetch 횟수 최소화)
- **Option C**: 단계적 — 작은 반경은 즉시, 큰 반경은 debounce

**결정 필요**: A/B/C + 수치 (예: 300ms vs 500ms)

### Q5. 인구 dots 재생성 정책 (Phase 3)
[buildDemographics.py](../scripts/etl/buildDemographics.py)는 집계구 폴리곤 내 **랜덤 포인트**로 dot density를 만든다. 매번 실행하면 시각적 배치가 달라짐.

- **Option A**: 한 번 DB에 적재한 뒤 재생성 금지 (시각적 일관성 우선)
- **Option B**: Python random seed 고정 후 재생성 허용

**결정 필요**: A / B

### Q6. 건물 geometry 단순화 수준
PostGIS에 원본 폴리곤(소수점 5~7자리)을 그대로 넣을지, `ST_SimplifyPreserveTopology(0.00001)` 같은 단순화 적용할지.

- 현재 lite 버전이 이미 단순화됨 (13MB → 11MB). Phase 1은 이 lite 버전 기준으로 진행할지, full 버전을 DB에 넣고 단순화를 RPC에서 할지.
- **권장**: **lite 기반으로 시작**, DB 크기 여유 확인 후 full로 교체 검토.

**결정 필요**: lite 기반 / full 기반

---

## 🟢 후속 질문 (Phase 2 이후)

### Q7. 챗봇 컨텍스트 서버 이관 (Phase 5)
[chatContext.js](../src/components/gis/chatContext.js)의 `buildLocationContext()`를 서버로 옮길지, 클라이언트에 유지할지.

- **Option A (유지)**: 건물/용도지역이 DB에 있어도, 이미 반경 filter된 배열을 클라가 들고 있으므로 요약을 클라에서. 네트워크 절약.
- **Option B (이관)**: Worker에서 Supabase RPC 호출 후 요약. 클라 번들 축소.

Phase 1–3 완료 후 실측해서 결정 권장.

### Q8. 아티클/PDF 시스템도 Supabase로?
현재 [workers/src/index.js](../workers/src/index.js)는 R2에 PDF/meta 저장. 이를 Supabase Storage + `articles` 테이블로 이관할 가치가 있을까?

- R2는 잘 동작 중이고 이관 이득 없음 → **정적 유지 권장**
- 단, DSS 확장 시 "의사결정 기록" 같은 구조화 테이블이 필요해지면 Supabase로 합치는 편이 단순.

### Q9. 용도지역 `MultiPolygon` vs `Polygon`
현재 `land_use_junggu.geojson`은 대부분 `Polygon`이지만 일부 `MultiPolygon`일 가능성. 스키마에서 `GEOMETRY(MultiPolygon, 4326)`로 받고 단일 Polygon도 `ST_Multi()`로 감싸 저장할지, 둘 다 허용(`GEOMETRY(Geometry, 4326)` + CHECK)할지.

- **권장**: `MultiPolygon`으로 통일 (쿼리 단순)

### Q10. 미래 타구 확장 (예: 종로구) 시 스키마 변경 최소화
`district_code`만 있으면 충분한가, 구별 분리 테이블이 나을까? (현재 zoning 원본에는 '종로구' 데이터도 섞여 있음을 확인)

- **권장**: 단일 테이블 + `district_code` 파티셔닝 고려. 데이터 수가 억 단위 되기 전엔 단일 테이블로 충분.

---

## 즉시 답 필요한 3개 (최소 집합)

진행을 막는 것만 추린다면:

1. **Q1 — 결측값 원본 보존**: `NULL`만? 아니면 `vl_rat_raw`도 함께?
2. **Q3 — 접근 방식**: Supabase SDK 직접 / Worker 프록시
3. **Q6 — 건물 단순화**: lite 기반 / full 기반

Q2(수집 주기)는 Phase 1 ETL 스크립트 작성 단계에 정해도 됨.
