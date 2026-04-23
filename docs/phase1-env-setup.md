# Phase 1 환경변수 설정 가이드

**대상**: 로컬 개발 환경 / ETL 실행 환경 / CI(GitHub Actions)
**전제**: Supabase 프로젝트 생성, [supabase/migrations/00001~00005](../supabase/migrations/) 실행 완료

---

## 1. 프론트엔드 (로컬) — `.env.local`

Vite 는 `VITE_` 접두사가 붙은 변수만 브라우저 번들에 노출한다.

```dotenv
# ── Supabase (Phase 1 신규) ──
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
VITE_USE_DB_BUILDINGS=false         # Phase 1 검증 중에만 true 로 전환

# ── 기존 (그대로 유지) ──
VITE_DATA_GO_KR_API_KEY=...
VITE_VWORLD_API_KEY=...
VITE_KAKAO_REST_API_KEY=...
VITE_SEOUL_OPENDATA_KEY=...
VITE_ORS_API_KEY=...
```

| 변수 | 출처 | 비고 |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase 대시보드 → Settings → API → Project URL | |
| `VITE_SUPABASE_ANON_KEY` | Settings → API → **anon public** 키 | 브라우저 노출 OK (RLS 보호) |
| `VITE_USE_DB_BUILDINGS` | `'true'` 문자열만 DB 모드 | 그 외 전부 정적 모드. 미지정 = 정적 |

### 반영 시점
- Vite 는 HMR 중 `.env.local` 변경을 자동 반영하지 **않는다**.
- 값 수정 후 반드시 `npm run dev` 재기동.

---

## 2. ETL 전용 — `.env` (또는 `.env.local`)

[scripts/etl/loadBuildingsToSupabase.py](../scripts/etl/loadBuildingsToSupabase.py) 가
`.env.local` → `.env` 순으로 로드한다. 둘 중 아무 쪽에 있어도 된다.

```dotenv
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_KEY=<service_role secret>
```

| 변수 | 출처 | ⚠️ 주의 |
|---|---|---|
| `SUPABASE_URL` | Project URL (Vite 와 동일) | `VITE_` 접두사 **없음** |
| `SUPABASE_SERVICE_KEY` | Settings → API → **service_role** `secret` | **RLS 우회 권한 — 절대 브라우저/Git 에 노출 금지** |

### 실수 방지
- `anon` 키와 `service_role` 키를 혼동하지 말 것. 둘 다 Settings → API 에 나란히 표시된다.
- `service_role` 키가 유출되면 즉시 Supabase 대시보드에서 rotate.

---

## 3. `.gitignore` 확인

현재 [`gwansul/.gitignore`](../.gitignore):

```
node_modules
dist
.DS_Store
.env.local
.env
scripts/etl/raw/
```

`.env.local` 과 `.env` 모두 ignored — **Supabase 키 커밋 위험 없음**. 추가 변경 불필요.

### 실수로 커밋했을 때 대처
1. 즉시 Supabase 대시보드에서 `service_role` 키를 rotate.
2. Git 히스토리에서 파일 제거: `git rm --cached .env && git commit -m "chore: remove leaked env"` (히스토리 전체 정리는 BFG / `git filter-repo`).
3. 과거 커밋에 남아있다면 기존 키는 영구히 무효로 간주.

---

## 4. GitHub Actions — Repository Secrets

수동 ETL workflow ([.github/workflows/etl-buildings.yml](../.github/workflows/etl-buildings.yml)) 용.

Settings → Secrets and variables → Actions → **New repository secret**:

| Secret 이름 | 값 |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_KEY` | service_role 키 |

### GitHub Pages 배포와의 관계
현재 [deploy.yml](../.github/workflows/deploy.yml) 은 `main` push 시 빌드해 GitHub Pages 에 배포한다.
`VITE_SUPABASE_*` 와 `VITE_USE_DB_BUILDINGS` 를 **지정하지 않았기 때문에**:

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` → 미정의 → supabase 클라이언트 `null` → 폴백
- `VITE_USE_DB_BUILDINGS` → 미정의 → 정적 모드

즉, **현재 main 배포는 자동으로 정적 모드로 빌드된다**. DB 모드 배포를 원하면 Phase 1 검증 완료 후 별도 결정 사항으로 `deploy.yml` 의 `build` step 에 env 추가가 필요.

---

## 5. 동작 요약 — 변수 조합별 모드

| `VITE_USE_DB_BUILDINGS` | Supabase 초기화 | `getBuildingsMode()` 반환 | 동작 |
|---|---|---|---|
| `false` (또는 미지정) | — | `'static'` | 정적 geojson 전체 로드 (기존) |
| `true` | 성공 | `'db'` | RPC 반경 쿼리 + clickedPoint 재조회 |
| `true` | 실패 (URL/키 오류) | `'db-unavailable'` | 정적 geojson 로 폴백 (콘솔 경고) |

[src/data/buildings.js](../src/data/buildings.js) 참조.
