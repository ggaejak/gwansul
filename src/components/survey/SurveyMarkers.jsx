// 신당동 영역 내 조사 마커 레이어.
//
// status 별 색상:
//   pending  → 노랑 (#f4b400)
//   approved → 초록 (#34a853)
//   rejected → 회색 (#888)
//
// survey_type 별 SVG 아이콘:
//   building → 집/건물 외곽선
//   road     → 평행선 + 점선 중앙선
//   point    → 채워진 원
//
// 클릭 시 onSelect(feature) 호출 — 호출 측이 상세 시트 표시.

import { Marker } from 'react-leaflet'
import L from 'leaflet'

const STATUS_COLOR = {
  pending:  '#f4b400',
  approved: '#34a853',
  rejected: '#9aa0a6',
}

const ICON_SVG = {
  building: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
      <path d="M4 21V9l8-6 8 6v12H4z" />
      <path d="M9 21v-7h6v7" />
    </svg>`,
  road: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" width="14" height="14">
      <path d="M5 4v16M19 4v16" />
      <path d="M12 5v3M12 11v3M12 17v3" />
    </svg>`,
  point: `
    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
      <circle cx="12" cy="12" r="6" />
    </svg>`,
}

const ICON_CACHE = {}

function getIcon(status, surveyType) {
  const key = `${status}-${surveyType}`
  if (ICON_CACHE[key]) return ICON_CACHE[key]

  const color = STATUS_COLOR[status] || STATUS_COLOR.pending
  const svg = ICON_SVG[surveyType] || ICON_SVG.point

  const html = `
    <div class="sv-marker" style="background:${color}">
      <span class="sv-marker-icon">${svg}</span>
    </div>`

  ICON_CACHE[key] = L.divIcon({
    className: 'sv-marker-wrapper',
    html,
    iconSize:   [30, 30],
    iconAnchor: [15, 15],
  })
  return ICON_CACHE[key]
}

export default function SurveyMarkers({ features, onSelect }) {
  if (!features || features.length === 0) return null
  return features.map(f => {
    const coords = f?.geometry?.coordinates
    if (!coords || coords.length < 2) return null
    const status = f.properties.status
    const type   = f.properties.surveyType
    return (
      <Marker
        key={f.properties.id}
        position={[coords[1], coords[0]]}
        icon={getIcon(status, type)}
        eventHandlers={{
          click(e) {
            // 마커 클릭이 map click 으로 전파돼 빈 곳 탭(B5) 트리거하지 않도록 차단
            L.DomEvent.stopPropagation(e)
            onSelect(f)
          },
        }}
      />
    )
  })
}
