// "내 위치로 이동" 버튼 (지도 우측 상단).
//
// 상태에 따라 외형/동작 변화:
//   tracking  → 활성 (클릭 시 flyTo)
//   requesting→ 비활성 + spinner 느낌 (점선 외곽)
//   denied/unavailable/error → 비활성 + 회색
//
// 클릭 시 useMap 의 flyTo 사용. zoom 인자 미지정 시 현재 zoom 유지.

import { useMap } from 'react-leaflet'

const ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <line x1="12" y1="2"  x2="12" y2="5"  />
    <line x1="12" y1="19" x2="12" y2="22" />
    <line x1="2"  y1="12" x2="5"  y2="12" />
    <line x1="19" y1="12" x2="22" y2="12" />
  </svg>
)

export default function LocateButton({ position, status, onDeniedClick }) {
  const map = useMap()
  const isReady = status === 'tracking' && Array.isArray(position)
  const isUnavailable = status === 'denied' || status === 'unavailable' || status === 'error'

  const handleClick = () => {
    if (isReady) {
      const targetZoom = Math.max(map.getZoom(), 17)
      map.flyTo(position, targetZoom, { duration: 0.6 })
    } else if (isUnavailable && onDeniedClick) {
      onDeniedClick()  // 호출 측이 토스트 재노출
    }
  }

  let title
  if (isReady)        title = '내 위치로 이동'
  else if (status === 'requesting') title = '위치 확인 중...'
  else if (status === 'denied')     title = '위치 권한이 거부됐습니다'
  else if (status === 'unavailable')title = '브라우저가 위치 기능을 지원하지 않습니다'
  else                              title = '위치 정보 오류'

  return (
    <button
      type="button"
      className={
        'sv-locate-btn' +
        (isReady ? ' active' : '') +
        (isUnavailable ? ' disabled' : '') +
        (status === 'requesting' ? ' loading' : '')
      }
      title={title}
      aria-label={title}
      onClick={handleClick}
      // disabled 속성은 안 씀 — denied 상태에서도 onClick 으로 토스트 재노출 가능해야 함
    >
      {ICON}
    </button>
  )
}
