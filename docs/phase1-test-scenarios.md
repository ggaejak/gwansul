# Phase 1 테스트 시나리오

**목적**: [docs/backend-migration-plan.md](backend-migration-plan.md) Phase 1 완료 기준 검증.
**범위**: 건물 데이터만 (용도지역/인구/교통은 Phase 2 이후).
**원칙**: **시나리오 A 가 실패하면 다른 시나리오 결과와 무관하게 Phase 1 중단.**
기존 사용자 경험 보존이 Phase 1 의 필수 조건이다.

---

## 사전 준비

1. Supabase 마이그레이션 00001–00005 실행 완료
2. ETL 전체 적재 완료 (`SELECT COUNT(*) FROM buildings` → 20,533)
3. `.env.local` 에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 설정
4. `npm install` 완료

---

## 시나리오 A — 정적 모드 회귀 (MUST PASS)

> **가장 중요한 시나리오.** 플래그가 꺼져 있을 때 Phase 1 변경이 기존 동작을 건드리지 않았는지 확인.

**준비**
```dotenv
# .env.local
VITE_USE_DB_BUILDINGS=false     # 또는 이 줄 자체 삭제
```

**수행**
1. `npm run dev` 재기동
2. 브라우저에서 `/gis` 경로 열기
3. 다음을 순서대로 수행:
   - 지도 클릭 → 반경 원 표시, 통계 패널 업데이트
   - 반경 슬라이더 이동 (100 → 1000m)
   - 연도 필터 슬라이더 이동
   - 섹션 전환 (개요/역사/상권 등)
   - 모바일 뷰에서 바텀시트 열기/닫기

**성공 기준** (전부 통과해야 함)
- [ ] DevTools Console: Supabase 관련 로그 **전혀 없음** (`[supabase] ...`, `[buildings] ...`)
- [ ] DevTools Network: `junggu-buildings-final-lite.geojson` 1회 fetch. `*.supabase.co` 요청 **없음**
- [ ] 지도에 20,533 건 건물 렌더 (Phase 1 이전 스크린샷과 픽셀 동일)
- [ ] 클릭/슬라이더/필터 모두 Phase 1 이전과 동일한 반응 속도 + 동일한 시각 결과
- [ ] 챗봇 요약 출력도 동일 (수치까지 일치)

**실패 시 원복**
```bash
git checkout src/pages/GisPage.jsx   # Step 5 변경 원복
# 또는 Phase 1 전체 원복:
git checkout main
```

---

## 시나리오 B — DB 모드 소량 적재 (검증용)

> ETL `--limit` 로 소수만 올려 DB 경로가 end-to-end 로 동작하는지 확인.

**준비**
```sql
-- Supabase SQL Editor
TRUNCATE buildings RESTART IDENTITY;
```
```bash
python scripts/etl/loadBuildingsToSupabase.py --limit 10 --verbose
```
```dotenv
# .env.local
VITE_USE_DB_BUILDINGS=true
```

**수행**
1. `npm run dev` 재기동 (env 변경 반영)
2. 브라우저 `/gis` 열기
3. DevTools Network 탭에서 `supabase.co/rest/v1/rpc/buildings_within` 요청 확인
4. 지도 클릭

**성공 기준**
- [ ] 초기 로드 시 `buildings_within` POST 1회 (status 200)
- [ ] 지도에 **10건 이하**의 건물만 렌더 (반경 1000m 내에 해당 10건 중 일부만 있을 수 있음)
- [ ] 지도 클릭 → 300ms 후 새 `buildings_within` POST 1회 (Network 탭 확인)
- [ ] Console 에러 없음 (단, 10건밖에 없어 통계가 빈약한 것은 정상)

**실패 시 원복**
```dotenv
VITE_USE_DB_BUILDINGS=false   # 플래그만 끄면 즉시 정적 복귀
```

---

## 시나리오 C — DB 모드 전체 적재 + 성능 측정 (완료 기준)

> 전체 20,533 건 적재 후 실 사용 시나리오에서의 성능 비교.

**준비**
```sql
TRUNCATE buildings RESTART IDENTITY;
```
```bash
python scripts/etl/loadBuildingsToSupabase.py        # 전체
```
```dotenv
VITE_USE_DB_BUILDINGS=true
```

**수행 (각 측정 값을 기록)**
1. **초기 로드 시간** — DevTools Performance 탭에서 새 시크릿 창 FCP/LCP
   - 정적 모드 vs DB 모드 비교
2. **클릭 반응성** — 지도 클릭 후 건물 레이어 갱신까지의 체감 시간
3. **반경 슬라이더** — 100m ↔ 1000m 드래그 시 프레임 드랍 여부
   - DB 모드는 슬라이더 조작 중 **새 네트워크 요청이 발생하지 않아야 함** (클라이언트 필터)
4. **중심점 이동 연속** — 여러 위치를 빠르게 클릭할 때 debounce 동작
   - 마지막 클릭에서 300ms 후 **한 번만** RPC 호출되어야 함

**성공 기준 (완료 기준)**
- [ ] 초기 LCP 가 정적 모드 대비 **개선되거나 동등** (회귀 없음)
- [ ] 반경 슬라이더 체감 끊김 감소
- [ ] 클릭 후 반경 내 건물 응답 < 500ms (3G 시뮬레이션에서 < 1000ms)
- [ ] `Network` 탭: 슬라이더 조작 시 RPC 호출 0회
- [ ] `Network` 탭: 연속 클릭 시 debounce 로 RPC 호출이 최종 한 번만 발생

**측정 결과 기록 템플릿**
| 항목 | 정적 모드 | DB 모드 | 판정 |
|---|---|---|---|
| LCP (초기 로드) | | | |
| 클릭 후 업데이트 지연 | | | |
| 반경 슬라이더 끊김 | | | |
| 번들 초기 전송량 | 11.3 MB+ | ~ KB (RPC) | |

**실패 시 원복**: 시나리오 A 와 동일.

---

## 시나리오 D — DB 폴백 동작

> Supabase 장애나 설정 실수 시에도 앱이 죽지 않는지 확인.

**준비**
```dotenv
VITE_SUPABASE_URL=https://invalid-project-9999.supabase.co
VITE_USE_DB_BUILDINGS=true
```

**수행**
1. `npm run dev` 재기동
2. 브라우저 `/gis` 열기

**성공 기준**
- [ ] Console 에 `[buildings] Supabase RPC 실패 — 정적 geojson 으로 폴백합니다: ...` 경고 1회
- [ ] 그 후 지도가 **정상적으로 전체 20,533 건 렌더**되어야 함 (정적 geojson 으로 폴백)
- [ ] `getBuildingsMode()` 는 `'db'` 를 반환하지만 (Supabase 클라이언트는 초기화됐으므로) RPC 호출만 실패하고 자동 폴백 — 기대 동작
- [ ] 앱 크래시/화면 whitescreen **없음**

**검증 후 복구**
```dotenv
VITE_SUPABASE_URL=https://<real-project-ref>.supabase.co
```

---

## Phase 1 완료 판정

| 시나리오 | 상태 | 비고 |
|---|---|---|
| A — 정적 회귀 | [ ] | **MUST PASS** |
| B — DB 소량 | [ ] | 전체 적재 전 검증 |
| C — DB 전체 + 성능 | [ ] | 완료 기준 |
| D — 폴백 | [ ] | 장애 복원력 |

**전부 통과 = Phase 1 완료. Phase 2 (용도지역 이관) 착수 가능.**

---

## 일반 원복 전략 (요약)

| 수준 | 명령 | 영향 |
|---|---|---|
| 런타임 원복 | `VITE_USE_DB_BUILDINGS=false` + 재기동 | 즉시 정적 모드. 데이터 손실 없음 |
| 브랜치 원복 | `git checkout main` | Phase 1 전체 제거 (Supabase DB 는 무관) |
| DB 정리 | `TRUNCATE buildings;` | Supabase 레코드 삭제. 스키마는 유지 |
| DB 완전 제거 | 마이그레이션 역순 수동 DROP | 필요 시에만. 보통 불필요 |

Supabase 500MB 한도 모니터링: Settings → Usage 에서 주기 확인.
