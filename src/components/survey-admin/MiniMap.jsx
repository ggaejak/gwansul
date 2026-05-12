// 단일 좌표를 보여주는 작은 지도.
//
// SurveyDetailPanel 의 "위치" 섹션에서 사용.
// VWorld 타일 (없으면 CARTO 폴백) — SurveyMap.jsx 와 동일한 컨벤션.
//
// MapContainer 의 center 는 mount 시 한 번만 적용되므로,
// 다른 survey 선택 시 컴포넌트를 새로 mount 하기 위해
// 부모에서 key 를 좌표 기반으로 넘기는 패턴을 권장 (또는 useEffect + map.setView).
// 여기서는 단순화를 위해 key prop 패턴을 외부에 위임.

import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'

const VWORLD_KEY = import.meta.env.VITE_VWORLD_API_KEY
const TILE_URL = VWORLD_KEY
  ? `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Base/{z}/{y}/{x}.png`
  : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const TILE_ATTR = VWORLD_KEY
  ? '&copy; <a href="https://www.vworld.kr">VWorld</a>'
  : '&copy; OpenStreetMap &copy; CARTO'

// 검은 점 마커 (SurveyMarkers 와 톤 일치).
const PIN_ICON = L.divIcon({
  className: 'sa-mini-pin',
  html:      '<span></span>',
  iconSize:   [16, 16],
  iconAnchor: [8, 8],
})

// 좌표가 바뀔 때 map view 를 갱신 (key 패턴 없이도 동작).
function Recenter({ lng, lat, zoom }) {
  const map = useMap()
  useEffect(() => {
    if (typeof lng === 'number' && typeof lat === 'number') {
      map.setView([lat, lng], zoom, { animate: false })
    }
  }, [lng, lat, zoom, map])
  return null
}

export default function MiniMap({ lng, lat, zoom = 17, height = 220 }) {
  if (typeof lng !== 'number' || typeof lat !== 'number') {
    return <div className="sa-minimap-empty" style={{ height }}>좌표 정보 없음</div>
  }
  return (
    <div className="sa-minimap" style={{ height }}>
      <MapContainer
        center={[lat, lng]}
        zoom={zoom}
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        dragging={false}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        <Marker position={[lat, lng]} icon={PIN_ICON} />
        <Recenter lng={lng} lat={lat} zoom={zoom} />
      </MapContainer>
    </div>
  )
}
