// 브라우저 Geolocation API 추적 훅.
//
// 반환:
//   position : [lat, lng] | null   — Leaflet LatLng 호환 튜플
//   accuracy : number | null       — 정확도(미터)
//   status   : 'idle' | 'requesting' | 'tracking' | 'denied' | 'unavailable' | 'error'
//   error    : string | null       — 사람이 읽을 수 있는 에러 메시지
//
// 동작:
//   1) 마운트 시 watchPosition 시작 (enableHighAccuracy + 적당한 timeout)
//   2) 권한 거부 시 status='denied' — 호출 측이 토스트 등으로 안내
//   3) 언마운트 시 자동 정리

import { useEffect, useState } from 'react'

const WATCH_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge:         5000,    // 5 초 캐시
  timeout:            10000,   // 10 초 타임아웃
}

export function useCurrentLocation() {
  const [position, setPosition] = useState(null)
  const [accuracy, setAccuracy] = useState(null)
  const [status,   setStatus]   = useState('idle')
  const [error,    setError]    = useState(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable')
      setError('이 브라우저는 위치 기능을 지원하지 않습니다')
      return
    }

    setStatus('requesting')

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition([pos.coords.latitude, pos.coords.longitude])
        setAccuracy(pos.coords.accuracy)
        setStatus('tracking')
        setError(null)
      },
      (err) => {
        // err.code: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT
        if (err.code === 1) {
          setStatus('denied')
          setError('위치 권한이 거부됐습니다')
        } else if (err.code === 2) {
          setStatus('error')
          setError('현재 위치를 찾을 수 없습니다')
        } else if (err.code === 3) {
          setStatus('error')
          setError('위치 요청이 시간 초과됐습니다')
        } else {
          setStatus('error')
          setError(err.message || '위치 정보 오류')
        }
      },
      WATCH_OPTIONS,
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [])

  return { position, accuracy, status, error }
}
