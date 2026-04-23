// 건물 데이터 소스 추상화.
//
// GisPage.jsx 는 이 파일만 import 한다. Supabase 를 직접 알지 못함.
// 데이터 소스 교체(예: 다른 백엔드, 캐시 프록시) 시 이 파일만 수정.
//
// 모드 선택 (VITE_USE_DB_BUILDINGS):
//   - 'true' + Supabase 초기화 성공 → RPC 'buildings_within'
//       반경 내 건물만 반환 (중심점 이동 시 재호출 전제)
//   - 그 외 → 정적 geojson 전체 반환 (기존 동작 유지)
//
// DB 모드에서 런타임 에러 발생 시 자동으로 정적 geojson 폴백.
// (docs/migration-questions.md Q3/Q4 결정사항 반영)

import { supabase, isSupabaseReady } from '../lib/supabase'
import { rpcRowsToFeatureCollection } from './adapters/buildingAdapter'

const STATIC_URL = new URL(
  '../gis/data/junggu-buildings-final-lite.geojson',
  import.meta.url,
)

const USE_DB = import.meta.env.VITE_USE_DB_BUILDINGS === 'true'

// ─────────────────────────────────────────────────────────────

async function fetchFromStatic() {
  const res = await fetch(STATIC_URL)
  if (!res.ok) {
    throw new Error(`정적 geojson 로드 실패: HTTP ${res.status}`)
  }
  return await res.json()
}

async function fetchFromDB(lng, lat, maxRadius, district) {
  const { data, error } = await supabase.rpc('buildings_within', {
    lng,
    lat,
    radius_m: maxRadius,
    district,
  })
  if (error) throw error
  return rpcRowsToFeatureCollection(data)
}

// ─────────────────────────────────────────────────────────────

/**
 * 중심점 주변 건물을 GeoJSON FeatureCollection 형태로 반환.
 *
 * DB 모드: 반경 내 건물만. 중심점이 이동하면 재호출 필요.
 * 정적 모드: 전체 건물. 중심점/반경 인자는 무시됨. 반경 필터는 호출 측(useMemo)에서.
 *
 * DB 실패 시 자동으로 정적 폴백 — 호출 측은 try/catch 불필요.
 *
 * @param {number} lng       - 중심 경도
 * @param {number} lat       - 중심 위도
 * @param {number} maxRadius - 최대 반경(미터). DB 모드에서만 사용 (기본 1000).
 * @param {string} [district='11140'] - 자치구 코드 (중구 기본)
 * @returns {Promise<{type:'FeatureCollection', features:Array}>}
 */
export async function fetchBuildingsNearPoint(lng, lat, maxRadius = 1000, district = '11140') {
  if (USE_DB && isSupabaseReady()) {
    try {
      return await fetchFromDB(lng, lat, maxRadius, district)
    } catch (err) {
      console.warn(
        '[buildings] Supabase RPC 실패 — 정적 geojson 으로 폴백합니다:',
        err?.message || err,
      )
      return await fetchFromStatic()
    }
  }
  return await fetchFromStatic()
}

/**
 * 현재 데이터 소스 모드. 디버깅/UI 표시용.
 *  - 'db'              : DB 모드 정상 작동
 *  - 'db-unavailable'  : DB 모드 요청되었으나 Supabase 초기화 실패 → 정적 사용
 *  - 'static'          : 정적 모드 (기본)
 */
export function getBuildingsMode() {
  if (USE_DB && isSupabaseReady()) return 'db'
  if (USE_DB) return 'db-unavailable'
  return 'static'
}
