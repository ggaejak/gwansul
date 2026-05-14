// 신당동 영역 내 조사 마커 레이어.
//
// surveyType 별 색상 + SVG 아이콘:
//   building → 파랑  (#1e88e5) + 집/건물 외곽선
//   road     → 주황  (#fb8c00) + 평행선 + 점선 중앙선
//   point    → 보라  (#8e24aa) + category 별 아이콘:
//     public_toilet → WC 문자
//     smoking_area  → 담배 + 연기
//     그 외         → 채워진 원 (기본)
//
// status (pending/approved/rejected) 는 마커 색에 반영하지 않음 —
// 시각 구분의 1차 축은 type. status 는 상세 시트 / 어드민에서만 확인.
//
// 클릭 시 onSelect(feature) 호출 — 호출 측이 상세 시트 표시.
//
// 건물 조사에 entrance_location 이 있으면 보조 마커(빨간 문 아이콘)도 같이 표시.
// 보조 마커는 비-인터랙티브 (CSS pointer-events: none).

import { Fragment } from 'react'
import { Marker } from 'react-leaflet'
import L from 'leaflet'
import { getEntranceLocations } from '../../lib/surveyLabels'

const TYPE_COLOR = {
  building: '#1e88e5',  // 파랑
  road:     '#fb8c00',  // 주황
  point:    '#8e24aa',  // 보라
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

// point category 별 전용 아이콘. 매칭 안 되면 ICON_SVG.point 로 폴백.
// viewBox(24×24) 를 거의 꽉 채우게 디자인 — 마커 안에서 충분히 커 보이도록.
const POINT_ICON_SVG = {
  public_toilet: `
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
      <circle cx="5.5" cy="4" r="2.8" />
      <path d="M1 8.5 L10 8.5 L10 15 L8.5 15 L8.5 21 L2.5 21 L2.5 15 L1 15 Z" />
      <circle cx="18.5" cy="4" r="2.8" />
      <path d="M13.5 15 L15.5 8.5 L21.5 8.5 L23 15 Z" />
      <rect x="15.5" y="14" width="6" height="7" />
    </svg>`,
  smoking_area: `
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
      <rect x="2" y="14" width="14" height="4" rx="0.6" />
      <rect x="16" y="14" width="5" height="4" rx="0.6" opacity="0.45" />
      <path d="M5 11c0-2 3-2 3-4M11 11c0-2 3-2 3-4M17 11c0-2 3-2 3-4"
            fill="none" stroke="currentColor" stroke-width="1.8"
            stroke-linecap="round" />
    </svg>`,
}

const ICON_CACHE = {}

function getIcon(surveyType, pointCategory) {
  const key = surveyType === 'point'
    ? `point-${pointCategory || 'default'}`
    : surveyType
  if (ICON_CACHE[key]) return ICON_CACHE[key]

  const color = TYPE_COLOR[surveyType] || TYPE_COLOR.point
  let svg
  if (surveyType === 'point' && POINT_ICON_SVG[pointCategory]) {
    svg = POINT_ICON_SVG[pointCategory]
  } else {
    svg = ICON_SVG[surveyType] || ICON_SVG.point
  }

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

// ─── 입구 위치 보조 마커 (빨간 문 아이콘) ─────────────────
const ENTRANCE_ICON_SVG = `
  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4"
       stroke-linecap="round" stroke-linejoin="round" width="11" height="11">
    <path d="M7 3h10v18H7z" />
    <circle cx="14" cy="13" r="1" fill="#fff" stroke="none" />
  </svg>`

let ENTRANCE_ICON = null
function getEntranceIcon() {
  if (ENTRANCE_ICON) return ENTRANCE_ICON
  const html = `
    <div class="sv-entrance-marker">
      <span class="sv-entrance-marker-icon">${ENTRANCE_ICON_SVG}</span>
    </div>`
  ENTRANCE_ICON = L.divIcon({
    className: 'sv-entrance-marker-wrapper',
    html,
    iconSize:   [20, 20],
    iconAnchor: [10, 10],
  })
  return ENTRANCE_ICON
}

// 폼 내부에서 편집 중인 (아직 저장 전) 입구 좌표를 즉시 빨간 문 아이콘으로 표시.
// SurveyForm 의 entranceLocations 가 변할 때마다 SurveyMap 이 broadcast.
export function DraftEntranceMarkers({ locations }) {
  if (!locations || locations.length === 0) return null
  return locations.map((ent, i) => (
    <Marker
      key={`draft-ent-${i}`}
      position={[ent.lat, ent.lng]}
      icon={getEntranceIcon()}
      interactive={false}
      keyboard={false}
    />
  ))
}

// 건물 조사 features 중 입구 좌표가 있는 것만 빨간 문 보조 마커로.
// 한 조사에 입구가 여러 개일 수 있으므로 각각 별도 마커로 렌더.
// GIS 페이지처럼 메인 마커를 폴리곤 하이라이트로 대체하는 경우에 단독 사용.
export function EntranceMarkers({ features }) {
  if (!features || features.length === 0) return null
  const markers = []
  for (const f of features) {
    if (f.properties?.surveyType !== 'building') continue
    const ents = getEntranceLocations(f.properties?.payload)
    ents.forEach((ent, i) => {
      markers.push(
        <Marker
          key={`${f.properties.id}-ent-${i}`}
          position={[ent.lat, ent.lng]}
          icon={getEntranceIcon()}
          interactive={false}
          keyboard={false}
        />,
      )
    })
  }
  return markers
}

export default function SurveyMarkers({ features, onSelect }) {
  if (!features || features.length === 0) return null
  return features.map(f => {
    const coords = f?.geometry?.coordinates
    if (!coords || coords.length < 2) return null
    const type = f.properties.surveyType
    const entrances = type === 'building' ? getEntranceLocations(f.properties.payload) : []
    return (
      <Fragment key={f.properties.id}>
        <Marker
          position={[coords[1], coords[0]]}
          icon={getIcon(type, f.properties.payload?.category)}
          eventHandlers={{
            click(e) {
              // 마커 클릭이 map click 으로 전파돼 빈 곳 탭(B5) 트리거하지 않도록 차단
              L.DomEvent.stopPropagation(e)
              onSelect(f)
            },
          }}
        />
        {entrances.map((ent, i) => (
          <Marker
            key={`ent-${i}`}
            position={[ent.lat, ent.lng]}
            icon={getEntranceIcon()}
            interactive={false}
            keyboard={false}
          />
        ))}
      </Fragment>
    )
  })
}
