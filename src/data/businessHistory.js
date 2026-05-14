// 건물별 음식점 영업 이력 데이터 소스.
//
// Supabase RPC(fetch_business_history_by_building) 호출 결과를
// UI 가 다루기 좋은 camelCase 배열로 반환.
//
// 데이터 소스는 DB 전용 (정적 폴백 없음 — buildings 와 달리 시기별 변동이 핵심).
// Supabase 미준비 시 빈 배열을 반환하여 UI 는 섹션 자체를 숨긴다.

import { supabase, isSupabaseReady } from '../lib/supabase'
import { rpcRowsToBusinessHistoryList } from './adapters/businessHistoryAdapter'

/**
 * 건물의 영업 이력을 opened_at 내림차순으로 반환.
 *
 * pnu 와 buildingId 중 적어도 하나 제공. 둘 다 주면 RPC 가 OR 매칭.
 * (ETL 매칭 결과가 한쪽만 채워졌을 가능성 대비)
 *
 * Supabase 미준비 또는 RPC 에러 시 빈 배열 반환 (UI 는 섹션 숨김).
 *
 * @param {Object} params
 * @param {string|null} params.pnu
 * @param {number|null} params.buildingId
 * @returns {Promise<Array>} businessHistoryAdapter 가 변환한 객체 배열
 */
export async function fetchBusinessHistoryByBuilding({ pnu = null, buildingId = null } = {}) {
  if (!isSupabaseReady()) return []
  if (!pnu && !buildingId) return []

  const { data, error } = await supabase.rpc('fetch_business_history_by_building', {
    p_pnu: pnu,
    p_building_id: buildingId,
  })
  if (error) {
    console.warn('[businessHistory] RPC 실패:', error.message || error)
    return []
  }
  return rpcRowsToBusinessHistoryList(data)
}
