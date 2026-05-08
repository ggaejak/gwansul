// SurveyPage 의 지도 본문.
//
// Step B2: 신당동 경계(점선) + 위치 펄스 + "내 위치로" 버튼
// Step B3: 모든 조사 마커 (status 색 / type 아이콘) + 상세 시트
// Step B4: 마커 [수정] → prefill 폼 / 사진 압축·업로드 / save·update
// Step B5: 빈 곳 탭 → TypeSelectPicker (당시 road / point)
// 좌표 우선 모드 전환 (00013 마이그레이션 이후):
//   - 건물 폴리곤 GeoJSON 레이어 제거 (회색/노랑/초록 채색 사라짐)
//   - 어느 점이든 클릭 → picker (건물 / 도로 / 점 3 종)
//   - 건물 조사도 자유 좌표 — building_id / building_pnu NULL 허용
//   - admin 정제 시 좌표/사진으로 매핑 (Phase C 의 책임)

import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON, ZoomControl, useMapEvents } from 'react-leaflet'
import L from 'leaflet'

import sindangArea from '../../gis/data/sindang-survey-area.json'
import { fetchSurveysInArea } from '../../data/surveys'
import { useCurrentLocation } from '../../hooks/useCurrentLocation'
import CurrentLocationMarker from './CurrentLocationMarker'
import LocateButton from './LocateButton'
import SurveyMarkers from './SurveyMarkers'
import SurveyDetailSheet from './SurveyDetailSheet'
import SurveyForm from './SurveyForm'
import TypeSelectPicker from './TypeSelectPicker'

import '../../styles/survey-map.css'

// 신당동 영역 폴리곤 → Leaflet bounds 로 변환 (초기 fitBounds 용).
function computeAreaBounds(fc) {
  const coords = fc?.features?.[0]?.geometry?.coordinates?.[0] || []
  if (coords.length === 0) return null
  const lats = coords.map(c => c[1])
  const lngs = coords.map(c => c[0])
  return L.latLngBounds(
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  )
}

const AREA_BOUNDS = computeAreaBounds(sindangArea)
const SINDANG_RING = sindangArea?.features?.[0]?.geometry?.coordinates?.[0] || []

// 기본 배경 지도 — VWorld(브이월드, 정부 운영).
//   - 한국 건물/도로 디테일이 가장 정확
//   - WMTS URL 의 좌표 순서가 {z}/{y}/{x} (일반 TMS 와 다름)
//   - 레이어명은 첫 글자 대문자 강제: Base / Gray / Midnight / Hybrid / Satellite
//   - 도메인 화이트리스트 필수: 발급 시 localhost + 배포 도메인 등록
//   - VITE_VWORLD_API_KEY 미설정 시 CARTO 로 폴백 (key 누락이 빌드 차단하지 않도록)
const VWORLD_KEY = import.meta.env.VITE_VWORLD_API_KEY
const TILE_URL = VWORLD_KEY
  ? `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Base/{z}/{y}/{x}.png`
  : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
const TILE_ATTR = VWORLD_KEY
  ? '&copy; <a href="https://www.vworld.kr">VWorld</a>'
  : '&copy; OpenStreetMap &copy; CARTO'

// 점이 신당동 폴리곤 내부에 있는지 (ray casting). 외부 라이브러리 의존 없음.
function isInsideSindang(lng, lat) {
  let inside = false
  const ring = SINDANG_RING
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

// react-leaflet 훅 — 부모로 click 이벤트를 올림.
function MapClickHandler({ onClick }) {
  useMapEvents({ click: onClick })
  return null
}

const AREA_STYLE = {
  color:       '#111',
  weight:      2,
  opacity:     0.7,
  fillOpacity: 0,
  dashArray:   '6 4',
}


export default function SurveyMap() {
  const [surveys,   setSurveys]   = useState(null)
  const [selected,  setSelected]  = useState(null)   // 마커 클릭 → 상세 시트
  const [formState, setFormState] = useState(null)   // 입력/수정 폼 상태
  const [pickerState, setPickerState] = useState(null) // 빈 곳 탭 → 유형 선택
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)

  const { position, accuracy, status, error: geoError } = useCurrentLocation()

  async function refreshSurveys() {
    const srv = await fetchSurveysInArea()
    setSurveys(srv)
  }

  // 모든 조사 fetch (마운트 시 1 회).
  useEffect(() => {
    let cancelled = false
    fetchSurveysInArea().then(srv => {
      if (!cancelled) setSurveys(srv)
    })
    return () => { cancelled = true }
  }, [])

  // geolocation denied/error → 자동 토스트 1 회 (마운트 직후).
  useEffect(() => {
    if (status === 'denied' || status === 'unavailable' || status === 'error') {
      showToast(geoError || '위치 정보 사용 불가')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  function showToast(msg) {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 4000)
  }

  // 조사 데이터 의존 키 — 데이터 갱신 시 강제 재렌더.
  const markersKey = surveys
    ? `s-${surveys.features.length}-${surveys.features.map(f => f.properties?.updatedAt || '').join('|').length}`
    : 's-0'

  return (
    <div className="sv-map-shell">
      <MapContainer
        bounds={AREA_BOUNDS || undefined}
        center={AREA_BOUNDS ? undefined : [37.565, 127.017]}
        zoom={AREA_BOUNDS ? undefined : 16}
        minZoom={14}
        maxZoom={19}
        zoomControl={false}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          url={TILE_URL}
          attribution={TILE_ATTR}
          subdomains="abcd"
          maxZoom={19}
        />
        <ZoomControl position="bottomright" />

        {/* 신당동 영역 외곽 (점선) */}
        <GeoJSON data={sindangArea} style={AREA_STYLE} interactive={false} />

        {/* 어느 점 클릭이든 → 유형 선택 picker (좌표 우선 모드) */}
        <MapClickHandler
          onClick={(e) => {
            // 다른 시트/폼/picker 가 열린 동안은 무시
            if (formState || selected || pickerState) return
            const { lng, lat } = e.latlng
            if (!isInsideSindang(lng, lat)) {
              showToast('신당동 영역 안에서만 조사 가능합니다')
              return
            }
            setPickerState({ location: { lng, lat } })
          }}
        />

        {/* 모든 조사 마커 (status 색 / type 아이콘) */}
        {surveys && (
          <SurveyMarkers
            key={markersKey}
            features={surveys.features}
            onSelect={setSelected}
          />
        )}

        {/* 현재 위치 */}
        <CurrentLocationMarker position={position} accuracy={accuracy} />

        {/* 우측 상단 "내 위치로" 버튼 — useMap 사용을 위해 MapContainer 내부 */}
        <LocateButton
          position={position}
          status={status}
          onDeniedClick={() => showToast(geoError || '위치 정보 사용 불가')}
        />
      </MapContainer>

      {toast && <div className="sv-toast" role="status">{toast}</div>}

      {/* 조사 상세 시트 (마커 클릭 시) — 폼 열린 동안 숨김 */}
      {!formState && (
        <SurveyDetailSheet
          feature={selected}
          onClose={() => setSelected(null)}
          onEdit={(f) => {
            setSelected(null)
            setFormState({
              mode:           'edit',
              surveyType:     f.properties.surveyType,
              location:       {
                lng: f.geometry.coordinates[0],
                lat: f.geometry.coordinates[1],
              },
              building:       null,           // 좌표 우선 모드: 건물 메타 lookup 안 함
              initialFeature: f,
            })
          }}
        />
      )}

      {/* 빈 곳 탭 → 조사 유형 선택 (건물 / 도로 / 일반 점) */}
      {pickerState && !formState && (
        <TypeSelectPicker
          location={pickerState.location}
          onCancel={() => setPickerState(null)}
          onPick={(surveyType) => {
            const loc = pickerState.location
            setPickerState(null)
            setFormState({
              mode:       'new',
              surveyType,
              location:   loc,
              building:   null,
            })
          }}
        />
      )}

      {/* 입력 / 수정 폼 */}
      {formState && (
        <SurveyForm
          mode={formState.mode}
          surveyType={formState.surveyType}
          location={formState.location}
          building={formState.building}
          initialFeature={formState.initialFeature}
          onClose={() => setFormState(null)}
          onSaved={async () => {
            showToast(formState.mode === 'edit' ? '수정 완료' : '저장 완료')
            await refreshSurveys()
          }}
        />
      )}
    </div>
  )
}
