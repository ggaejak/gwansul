// Supabase RPC(zoning_intersect) 행 → 기존 GeoJSON Feature 변환.
//
// 원본 land_use_junggu.geojson 의 properties 는 한국어 키
// ('용도지역명', 'ATRB_SE', 'DGM_AR', '구이름') 를 사용한다.
// 클라이언트 코드(GisPage.jsx, chatContext.js)가
//   f.properties['용도지역명']
//   f.properties.DGM_AR
// 를 직접 참조하므로 어댑터는 snake_case → 원본 한국어 키로 매핑.
// 이렇게 해야 클라이언트 코드 수정이 발생하지 않는다.
//
// ATRB_SE, 구이름은 현재 클라이언트가 직접 사용하진 않지만 데이터
// 보존 차원에서 매핑해 둔다 (향후 분석/디버깅 활용).
//
// 결측값:
//   ETL 에서 dgm_ar=0 이 NULL 로 치환되어 들어옴.
//   클라이언트 측 `parseFloat(... ) || 0` 패턴이 NULL 도 0 으로
//   안전 처리하므로 추가 후처리 불필요.

export function rpcRowToZoningFeature(row) {
  const geometry = typeof row.geom_json === 'string'
    ? JSON.parse(row.geom_json)
    : row.geom_json

  return {
    type: 'Feature',
    geometry,
    properties: {
      '용도지역명': row.zone_name,
      'ATRB_SE':   row.atrb_se,
      'DGM_AR':    row.dgm_ar,
      '구이름':     row.source_district,
    },
  }
}

export function rpcRowsToZoningFeatureCollection(rows) {
  return {
    type: 'FeatureCollection',
    features: (rows || []).map(rpcRowToZoningFeature),
  }
}
