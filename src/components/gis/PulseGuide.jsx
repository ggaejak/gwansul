// 첫 진입 안내 펄스 마커.
// clickedPoint 가 null 일 때만 GisPage 가 마운트한다.
//
// 구현: L.divIcon + CSS 애니메이션 (transform/opacity 만, JS 인터벌 X).
// 클릭(또는 터치) 시 onClick() 호출 → GisPage 가 setClickedPoint(position).

import { Marker } from 'react-leaflet'
import L from 'leaflet'
import '../../styles/pulse.css'

const pulseIcon = L.divIcon({
  className: 'pulse-icon-wrap',
  html: `
    <div class="pulse-dot"></div>
    <span class="pulse-ring"></span>
    <span class="pulse-ring pulse-ring-2"></span>
    <div class="pulse-label">지도를 클릭해서 분석을 시작하세요</div>
  `,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

export default function PulseGuide({ position, onClick }) {
  return (
    <Marker
      position={position}
      icon={pulseIcon}
      // 마커 자체에 keyboard tabindex 가 자동 부여되지 않도록 단순화.
      keyboard={false}
      eventHandlers={{
        click: (e) => {
          // 마커 클릭이 베이스 맵의 click 으로 전파되어 좌표가 살짝 어긋나는
          // 케이스 방지. 우리는 명시적으로 position(CENTER) 을 사용.
          L.DomEvent.stopPropagation(e.originalEvent)
          onClick && onClick()
        },
      }}
    />
  )
}
