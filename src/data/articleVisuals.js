// 아티클별 GIS 시각 자료 확장 포인트.
//
// 1차 구현 (현재): 모든 아티클이 사이드 패널(메타 + PDF) 만 표시.
// 매핑은 비어 있음.
//
// 미래: 특정 아티클이 지도 위에 마커/추가 레이어, 패널에 차트 등
// 커스텀 시각 자료를 가져야 할 때, 그 아티클별로 React 컴포넌트를
// 직접 작성한 뒤 이 매핑에 등록한다. 이 모듈은 아티클별 시각 자료를
// 한 곳에서 발견(discover) 할 수 있게 하는 인덱스 역할.
//
// ─── 시그니처 (전부 optional) ─────────────────────────────────
//   ARTICLE_VISUALS[articleId] = {
//     // 사이드 패널 상세 본문 아래에 추가로 렌더할 React 컴포넌트.
//     // props: { article }
//     PanelExtra: React.ComponentType<{ article: object }>,
//
//     // 지도 위에 추가로 렌더할 React 컴포넌트 (react-leaflet 컨텍스트 내).
//     // props: { article }. <GeoJSON>, <Marker>, <Polygon> 등 자유.
//     MapLayer: React.ComponentType<{ article: object }>,
//
//     // 아티클 선택 시 지도 자동 이동 좌표 (Leaflet [lat, lng] 순).
//     flyTo: [lat: number, lng: number, zoom?: number],
//   }
//
// ─── 등록 예시 (실제 미구현) ──────────────────────────────────
//   import TaeanLayer from './articleVisualComponents/TaeanLayer'
//   import TaeanCharts from './articleVisualComponents/TaeanCharts'
//
//   export const ARTICLE_VISUALS = {
//     2: {
//       MapLayer: TaeanLayer,
//       PanelExtra: TaeanCharts,
//       flyTo: [36.7456, 126.2978, 13],
//     },
//   }
//
// articleId 는 number/string 어느 쪽으로 전달해도 안전 (객체 키는
// 자동으로 문자열로 변환됨).

export const ARTICLE_VISUALS = {
  // 비어 있음. 아티클별 시각 자료가 필요해지면 위 시그니처에 따라
  // 컴포넌트를 작성한 뒤 여기 등록.
}

/**
 * 특정 아티클의 시각 자료 정의를 반환. 등록 안 됐으면 null.
 */
export function getArticleVisuals(articleId) {
  return ARTICLE_VISUALS[articleId] || null
}
