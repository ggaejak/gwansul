// 현재 위치 펄스 마커.
//
// Google Maps 의 파란 점 + 펄스 링 패턴.
// position 이 null 이면 아무것도 렌더하지 않음 (호출 측이 조건부 분기).
//
// 정확도(accuracy) 가 30m 이상일 때만 정확도 원 표시 — GPS 가 정확할 땐 굳이 안 그림.

import { Marker, Circle } from 'react-leaflet'
import L from 'leaflet'

const PULSE_ICON = L.divIcon({
  className: 'sv-current-loc-icon',
  html: '<span class="sv-loc-pulse"></span><span class="sv-loc-dot"></span>',
  iconSize:   [22, 22],
  iconAnchor: [11, 11],
})

export default function CurrentLocationMarker({ position, accuracy }) {
  if (!position) return null
  return (
    <>
      {accuracy != null && accuracy >= 30 && (
        <Circle
          center={position}
          radius={accuracy}
          pathOptions={{
            color:       '#1976d2',
            weight:      1,
            opacity:     0.4,
            fillColor:   '#1976d2',
            fillOpacity: 0.08,
          }}
          interactive={false}
        />
      )}
      <Marker position={position} icon={PULSE_ICON} interactive={false} keyboard={false} />
    </>
  )
}
