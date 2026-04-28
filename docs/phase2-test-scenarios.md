# Phase 2 테스트 시나리오

**목적**: Phase 2(zoning 이관)의 회귀·완료 기준 검증.
**범위**: 용도지역 데이터만. Phase 1(buildings)은 별도 [phase1-test-scenarios.md](phase1-test-scenarios.md).
**원칙**: **시나리오 A 가 실패하면 다른 시나리오 결과와 무관하게 Phase 2 중단.**
Phase 1 의 회귀 테스트도 함께 통과해야 한다 (Phase 2 이 Phase 1 을 깨면 안 됨).

---

## Phase 2 의 의도된 동작 차이 (사전 인지)

DB 모드에서는 **`zoningData` 가 전체가 아닌 반경 1000m 내 폴리곤만**으로 좁아진다.
이는 PostGIS 이관의 본질적 결과이며 정적 모드와 의도적으로 다른 부분이다.

영향:
- [GisPage.jsx:758](../src/pages/GisPage.jsx#L758) `circleEnabled=false` 시 `zoningData.features`
  를 그대로 표시하는 경로 — DB 모드에서는 76개만 보이게 됨
- [BuildingDetailCard](../src/pages/GisPage.jsx#L2051) zoning 매칭 — 같은 1000m 반경으로
  buildings 와 zoning 이 동기화되어 있으므로 정상 동작

이 trade-off 는 의도된 설계이며 시나리오 C 가 통과해야 함을 의미한다.

---

## 사전 준비

1. Supabase 마이그레이션 00006/00007 실행 완료
2. ETL 전체 적재 완료 (`SELECT COUNT(*) FROM zoning` → 682)
3. `.env.local` 에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 설정
4. Phase 1 buildings 적재도 완료되어 있어야 시나리오 C 가능

---

## 시나리오 A — 정적 모드 회귀 (MUST PASS)

> Phase 2 변경이 기존(Phase 1 정적 + Phase 2 정적) 동작을 건드리지 않았는지 확인.

**준비**
```dotenv
# .env.local
VITE_USE_DB_BUILDINGS=false
VITE_USE_DB_ZONING=false
```

**수행**
1. `npm run dev` 재기동
2. 브라우저 `/gis` 열기
3. 다음을 순서대로 수행:
   - 지도 클릭 → 반경 원 + 통계 패널
   - "용도지역(landuse)" 섹션으로 이동
   - 용도지역 폴리곤 색상별 분포 / 반경 내 비율 확인
   - 건물 클릭 → BuildingDetailCard 의 "용도지역" 항목 표시
   - 챗봇 자동 요약 → 용도지역 분포 텍스트

**성공 기준**
- [ ] DevTools Console: Supabase/`[zoning]` 로그 **전혀 없음**
- [ ] DevTools Network: `land_use_junggu.geojson` 1회 fetch. `*.supabase.co` 요청 없음
- [ ] 지도에 682 개 폴리곤 (중구 364 + 종로구 318) 렌더
- [ ] BuildingDetailCard 가 클릭한 건물의 용도지역명을 정확히 표시
- [ ] 챗봇 출력의 용도지역 분포 수치가 Phase 2 이전과 동일

**실패 시 원복**
```bash
git checkout src/pages/GisPage.jsx   # Step 4 변경만 원복
# 또는 플래그만 끄면 런타임 원복
VITE_USE_DB_ZONING=false
```

---

## 시나리오 B — zoning 만 DB 모드

> buildings 는 정적 / zoning 만 DB 로 운영. 토글 독립성 검증.

**준비**
```dotenv
VITE_USE_DB_BUILDINGS=false
VITE_USE_DB_ZONING=true
```

**수행**
1. `npm run dev` 재기동
2. 브라우저 `/gis` 열기 → "용도지역" 섹션
3. 지도 클릭 / 반경 슬라이더 조작

**성공 기준**
- [ ] Network: `land_use_junggu.geojson` fetch **없음**
- [ ] Network: `*.supabase.co/.../zoning_intersect` POST 1회 (초기 로드)
- [ ] Network: `junggu-buildings-final-lite.geojson` 정상 fetch (buildings 는 정적 모드)
- [ ] 지도 클릭 시 300ms 후 새 `zoning_intersect` POST 1회
- [ ] 반경 슬라이더 조작 시 RPC 호출 **없음** (turf 클라이언트 필터)
- [ ] 챗봇 용도지역 통계가 정적 모드(시나리오 A) 와 같은 수치

---

## 시나리오 C — buildings + zoning 둘 다 DB 모드 (완료 기준)

> Phase 1 + Phase 2 통합 동작.

**준비**
```dotenv
VITE_USE_DB_BUILDINGS=true
VITE_USE_DB_ZONING=true
```

**수행**
1. `npm run dev` 재기동
2. 여러 위치 클릭 / 반경 변경 / 건물 상세 카드 열기

**성공 기준**
- [ ] 클릭 1회당 두 RPC(`buildings_within`, `zoning_intersect`)가 거의 동시에 한 번씩 발사
- [ ] 클릭 후 ~500ms 내 건물 + 용도지역 모두 갱신
- [ ] BuildingDetailCard 의 용도지역 매칭 정상 (둘 다 1000m 동기화)
- [ ] 반경 슬라이더 조작 시 두 RPC 모두 호출 **없음** (둘 다 클라이언트 필터)
- [ ] 챗봇 자동 요약: 건물 통계 + 용도지역 분포가 일관

**측정 (선택)** — 정적 vs DB 모드 비교
| 항목 | 정적 모드 | DB 모드 | 변화 |
|---|---|---|---|
| 초기 전송량 | ~21.9 MB | ~수백 KB (RPC) | |
| LCP | | | |
| 클릭 → 갱신 지연 | | | |
| `turf.booleanIntersects` 호출 데이터 크기 | 682 폴리곤 | 76 폴리곤 | |

---

## 시나리오 D — zoning RPC 폴백

> Supabase 장애 시 정적 geojson 으로 자동 복원.

**준비**
```dotenv
VITE_SUPABASE_URL=https://invalid-project-9999.supabase.co
VITE_USE_DB_ZONING=true
```

**수행**
1. `npm run dev` 재기동 → `/gis`

**성공 기준**
- [ ] Console: `[zoning] Supabase RPC 실패 — 정적 geojson 으로 폴백합니다: ...` 1회
- [ ] 그 후 정적 land_use_junggu.geojson(682 개) 으로 정상 렌더
- [ ] `getZoningMode()` 는 `'db'` 반환하지만 RPC 만 실패하고 자동 폴백 (Phase 1 buildings 와 동일 패턴)
- [ ] 앱 크래시 없음

**검증 후 복구**: SUPABASE_URL 원상 복구

---

## Phase 2 완료 판정

| 시나리오 | 상태 | 비고 |
|---|---|---|
| A — 정적 회귀 | [ ] | **MUST PASS** |
| B — zoning 단독 DB | [ ] | 토글 독립성 |
| C — 둘 다 DB | [ ] | 통합 완료 기준 |
| D — 폴백 | [ ] | 장애 복원력 |
| Phase 1 회귀 (참조) | [ ] | [phase1-test-scenarios.md](phase1-test-scenarios.md) 시나리오 A 재실행 |

**전부 통과 = Phase 2 완료. Phase 3 (인구 dots 이관) 착수 가능.**

---

## 일반 원복 전략

| 수준 | 명령 | 영향 |
|---|---|---|
| 런타임 원복 | `VITE_USE_DB_ZONING=false` + 재기동 | 즉시 정적 모드. 데이터 손실 없음 |
| 브랜치 원복 | `git checkout main` | Phase 2 전체 제거 (DB 무관) |
| DB 정리 | `TRUNCATE zoning RESTART IDENTITY;` | 레코드만 삭제. 스키마는 유지 |

---

## Phase 2 의 핵심 검증 포인트 (요약)

1. **`turf.booleanIntersects` 호출 부담이 의미 있게 감소했는가** — DB 모드는
   클라이언트가 76 polygon 만 turf 처리. 정적 모드는 682 polygon.
2. **8.6 MB GeoJSON 초기 fetch 가 사라졌는가** — Network 탭 확인.
3. **정적 모드 회귀가 0인가** — 시나리오 A.

위 세 가지가 Phase 2 의 본질적 가치 명제이며 KPI.
