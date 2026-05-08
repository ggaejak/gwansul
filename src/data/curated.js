// 정제(curated) 데이터 추상화. 대시보드(/gis Phase D) 표시용.
//
// raw(field_surveys) 와 분리: 메달리언 원칙상 대시보드는 정제 데이터만 본다.
// SurveyPage / SurveyAdminPage 는 이 파일을 사용하지 않음.
//
// Supabase 미초기화 또는 RPC 실패 시 빈 FeatureCollection + 콘솔 경고.
// 정적 폴백 없음 — 정제 데이터는 DB 가 진실의 단일 원천.

import { supabase, isSupabaseReady } from '../lib/supabase'
import {
  dbRowsToCuratedBuildingFeatureCollection,
  dbRowsToCuratedRoadFeatureCollection,
  dbRowsToCuratedPointFeatureCollection,
} from './adapters/curatedAdapter'

const EMPTY_FC = { type: 'FeatureCollection', features: [] }

// ─────────────────────────────────────────────────────────────

async function callRpc(rpcName, adapt, fnLabel) {
  if (!isSupabaseReady()) {
    console.warn(`[curated.${fnLabel}] Supabase 미초기화 — 빈 결과 반환`)
    return EMPTY_FC
  }
  const { data, error } = await supabase.rpc(rpcName)
  if (error) {
    console.warn(`[curated.${fnLabel}] RPC 실패:`, error.message)
    return EMPTY_FC
  }
  return adapt(data)
}

// ─────────────────────────────────────────────────────────────

/**
 * 정제된 건물 데이터 (1층 업종 / 공실 등).
 * buildings 와 LEFT JOIN 되어 폴리곤 geom 포함.
 *
 * geom 이 null 인 row 는 어댑터에서 자동 제거 (orphan 정제 방지).
 */
export function fetchCuratedBuildings() {
  return callRpc(
    'fetch_curated_buildings',
    dbRowsToCuratedBuildingFeatureCollection,
    'fetchCuratedBuildings',
  )
}

/**
 * 정제된 도로 점 조사 (야간 밝기, 도로 폭).
 */
export function fetchCuratedRoads() {
  return callRpc(
    'fetch_curated_roads',
    dbRowsToCuratedRoadFeatureCollection,
    'fetchCuratedRoads',
  )
}

/**
 * 정제된 일반 점 조사 (화장실/흡연/소음/냄새/기타).
 */
export function fetchCuratedPoints() {
  return callRpc(
    'fetch_curated_points',
    dbRowsToCuratedPointFeatureCollection,
    'fetchCuratedPoints',
  )
}
