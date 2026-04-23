// Supabase RPC(buildings_within) 행 → 기존 GeoJSON Feature 형상 변환.
//
// - DB 컬럼은 snake_case (vl_rat, bld_nm, use_apr_day …)
// - 기존 GisPage.jsx 와 chatContext.js 는 camelCase 속성
//   (vlRat, bldNm, useAprDay …) 을 기대하므로 1:1 매핑.
//
// 결측값 처리:
//   ETL 에서 이미 원본 0/'' 를 NULL 로 치환해 저장했으므로
//   여기서는 NULL 을 그대로 반환한다.
//   기존 클라이언트 로직은 `props.vlRat > 0` 같은 느슨한 비교를 쓰므로
//   null 이어도 결측으로 자연히 걸러진다 (null > 0 === false).
//
// 이 파일은 향후 다른 테이블(zoning, population …) 이관 시에도
// 같은 패턴(adapters/xxxAdapter.js)으로 추가할 수 있도록 분리.

export function rpcRowToFeature(row) {
  const geometry = typeof row.geom_json === 'string'
    ? JSON.parse(row.geom_json)
    : row.geom_json

  return {
    type: 'Feature',
    geometry,
    properties: {
      pnu:          row.pnu,
      address:      row.address,
      bldNm:        row.bld_nm,
      regType:      row.reg_type,
      mainPurps:    row.main_purps,
      strct:        row.strct,
      archArea:     row.arch_area,
      totArea:      row.tot_area,
      platArea:     row.plat_area,
      bcRat:        row.bc_rat,
      vlRat:        row.vl_rat,
      grndFlrCnt:   row.grnd_flr_cnt,
      ugrndFlrCnt:  row.ugrnd_flr_cnt,
      useAprDay:    row.use_apr_day,
      bjdongCd:     row.bjdong_cd,
    },
  }
}

export function rpcRowsToFeatureCollection(rows) {
  return {
    type: 'FeatureCollection',
    features: (rows || []).map(rpcRowToFeature),
  }
}
