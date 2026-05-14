// Supabase RPC(fetch_business_history_by_building) 행 → 클라이언트 객체.
//
// DB 컬럼은 snake_case (business_name, business_type, opened_at …).
// UI 측 코드 가독성을 위해 camelCase 로 변환.
//
// 결측값:
//   ETL 에서 빈값/0 을 NULL 로 저장. 여기서는 null 그대로 반환.
//   UI 측은 ?? '—' 또는 조건부 렌더로 처리.
//
// 영업 상태 판정:
//   원본 status 는 '영업/정상' | '폐업'. UI 에서 boolean 으로 다루기 위해
//   isActive 파생값을 추가. (status === '영업/정상')
//   향후 '휴업' 추가될 가능성 대비 — 명시적 비교.

export function rpcRowToBusinessHistory(row) {
  return {
    id:            row.id,
    name:          row.business_name,
    type:          row.business_type,
    openedAt:      row.opened_at,
    closedAt:      row.closed_at,
    status:        row.status,
    isActive:      row.status === '영업/정상',
    jibunAddress:  row.jibun_address,
    roadAddress:   row.road_address,
    siteAreaM2:    row.site_area_m2,
  }
}

export function rpcRowsToBusinessHistoryList(rows) {
  return (rows || []).map(rpcRowToBusinessHistory)
}
