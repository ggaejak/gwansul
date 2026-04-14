import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  MapContainer, TileLayer, GeoJSON, ZoomControl, Circle, Marker, useMapEvents, useMap
} from 'react-leaflet'
import L from 'leaflet'
import * as turf from '@turf/turf'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend
} from 'recharts'
import Nav from '../components/Nav'
import GisChatbot from '../components/gis/GisChatbot'
import landmarksData from '../gis/data/junggu-landmarks.json'
import surveyAreaData from '../gis/data/survey-area.json'
import 'leaflet/dist/leaflet.css'
import '../styles/gis.css'

const CENTER = [37.5636, 126.9976]
const BOUNDS = [[37.53, 126.95], [37.60, 127.04]]

// ─── 편의시설 카테고리 ──────────────────────────────────────────
const AMENITY_CATS = [
  { code: 'FD6', label: '음식점', icon: '🍽', color: '#e74c3c' },
  { code: 'CE7', label: '카페', icon: '☕', color: '#8B4513' },
  { code: 'CT1', label: '문화시설', icon: '🏛', color: '#9b59b6' },
  { code: 'HP8', label: '의료시설', icon: '🏥', color: '#2ecc71' },
  { code: 'SC4', label: '교육시설', icon: '🏫', color: '#3498db' },
  { code: 'CS2', label: '편의점', icon: '🏪', color: '#f39c12' },
  { code: 'PO3', label: '공공기관', icon: '🏢', color: '#34495e' },
]

// TODO: 프로덕션에서는 Cloudflare Workers 프록시로 전환 필요
const KAKAO_KEY = import.meta.env.VITE_KAKAO_REST_API_KEY

async function fetchCategoryPlaces(code, x, y, radiusM) {
  const places = []
  for (let page = 1; page <= 3; page++) {
    const params = new URLSearchParams({
      category_group_code: code,
      x: String(x), y: String(y),
      radius: String(Math.min(radiusM, 20000)),
      size: '15', page: String(page), sort: 'distance',
    })
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/category.json?${params}`, {
      headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
    })
    if (!res.ok) break
    const data = await res.json()
    places.push(...data.documents)
    if (data.meta.is_end) break
  }
  return places.map(p => ({
    name: p.place_name,
    lat: parseFloat(p.y),
    lng: parseFloat(p.x),
    dist: parseInt(p.distance),
    address: p.road_address_name || p.address_name,
    category: code,
  }))
}

// ─── 색상 ──────────────────────────────────────────────────────
function getVlRatColor(v) {
  if (!v || v <= 0) return '#ccc'
  if (v <= 100) return '#2166ac'
  if (v <= 300) return '#67a9cf'
  if (v <= 500) return '#ef8a62'
  return '#b2182b'
}

// ─── 용도지역 색상 + 허용 용적률 ─────────────────────────────────
const ZONING_COLORS = {
  '제1종전용주거지역': '#ffffb2', '제2종전용주거지역': '#fed976',
  '제1종일반주거지역': '#feb24c', '제2종일반주거지역': '#fd8d3c',
  '제3종일반주거지역': '#f03b20', '준주거지역': '#bd0026',
  '근린상업지역': '#ff69b4', '일반상업지역': '#e31a1c',
  '중심상업지역': '#800026', '준공업지역': '#9e9ac8',
  '자연녹지지역': '#41ab5d',
}
function getZoningColor(name) {
  if (ZONING_COLORS[name]) return ZONING_COLORS[name]
  if (name && name.includes('녹지')) return '#41ab5d'
  return '#cccccc'
}

const MAX_FAR_BY_ZONE = {
  '제1종전용주거지역': 100, '제2종전용주거지역': 150,
  '제1종일반주거지역': 200, '제2종일반주거지역': 250,
  '제3종일반주거지역': 300, '준주거지역': 500,
  '근린상업지역': 600, '일반상업지역': 800,
  '중심상업지역': 1000, '준공업지역': 400,
}
function getMaxFAR(zoneName) { return MAX_FAR_BY_ZONE[zoneName] || null }

const PURPS_COLORS = {
  '단독주택': '#fbbf24', '공동주택': '#f59e0b', '제1종근린생활시설': '#fb923c',
  '제2종근린생활시설': '#f97316', '업무시설': '#60a5fa', '판매시설': '#f472b6',
  '숙박시설': '#a78bfa', '교육연구시설': '#34d399', '의료시설': '#2dd4bf',
  '문화및집회시설': '#e879f9', '종교시설': '#c084fc', '운동시설': '#4ade80',
  '공장': '#94a3b8', '창고시설': '#64748b',
}
function getPurpsColor(p) {
  for (const [k, c] of Object.entries(PURPS_COLORS)) { if (p && p.includes(k)) return c }
  return '#94a3b8'
}

function calcEntropy(counts) {
  const vals = Object.values(counts).filter(v => v > 0)
  const total = vals.reduce((s, v) => s + v, 0)
  if (!total || vals.length <= 1) return 0
  let H = 0
  for (const v of vals) { const p = v / total; H -= p * Math.log(p) }
  return +(H / Math.log(vals.length)).toFixed(2)
}

// ─── 건물 연령 ──────────────────────────────────────────────────
function getBuildYear(props) {
  const d = props.useAprDay
  if (!d || typeof d !== 'string') return 0
  const y = parseInt(d.substring(0, 4))
  return (y >= 1900 && y <= 2030) ? y : 0
}

function getAgeColor(year) {
  if (!year) return '#ccc'
  if (year >= 2020) return '#2166ac'
  if (year >= 2000) return '#67a9cf'
  if (year >= 1980) return '#f7f7f7'
  if (year >= 1960) return '#ef8a62'
  return '#b2182b'
}

const AGE_BUCKETS = [
  { label: '~1960', min: 0, max: 1959, color: '#b2182b' },
  { label: '1960s', min: 1960, max: 1969, color: '#d6604d' },
  { label: '1970s', min: 1970, max: 1979, color: '#ef8a62' },
  { label: '1980s', min: 1980, max: 1989, color: '#fddbc7' },
  { label: '1990s', min: 1990, max: 1999, color: '#f7f7f7' },
  { label: '2000s', min: 2000, max: 2009, color: '#d1e5f0' },
  { label: '2010s', min: 2010, max: 2019, color: '#67a9cf' },
  { label: '2020s~', min: 2020, max: 9999, color: '#2166ac' },
]

function getCentroid(f) {
  if (f._c) return f._c
  try { f._c = turf.centroid(f).geometry.coordinates; return f._c } catch { return null }
}

// 경량 거리 계산 (Haversine 대신 평면 근사, 중구 범위에서 오차 <1%)
const DEG_TO_M_LAT = 111320
const DEG_TO_M_LNG = 111320 * Math.cos(37.56 * Math.PI / 180) // ~88,400m

function fastDistM(lat1, lng1, lat2, lng2) {
  const dy = (lat2 - lat1) * DEG_TO_M_LAT
  const dx = (lng2 - lng1) * DEG_TO_M_LNG
  return Math.sqrt(dx * dx + dy * dy)
}

// ─── 섹션 ID ────────────────────────────────────────────────────
const SECTIONS = ['pedshed', 'intensity', 'figground', 'landuse', 'transit', 'demo']

function MapClick({ onClick }) {
  useMapEvents({ click: e => onClick([e.latlng.lat, e.latlng.lng]) })
  return null
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="g-tooltip">
      <div className="g-tooltip-label">{label}</div>
      <div className="g-tooltip-value">{payload[0].value}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
export default function GisPage() {
  const [buildingData, setBuildingData] = useState(null)
  const [transitData, setTransitData] = useState(null)
  const [demoData, setDemoData] = useState(null)
  const [commerceData, setCommerceData] = useState(null)
  const [zoningData, setZoningData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [clickedPoint, setClickedPoint] = useState(null)
  const [radius, setRadius] = useState(400)
  const [visibleSection, setVisibleSection] = useState('intensity')
  const [ageFilterYear, setAgeFilterYear] = useState(2025)
  const [circleEnabled, setCircleEnabled] = useState(true)
  const [demoAgeFilter, setDemoAgeFilter] = useState(null) // null=전체, 'age_0_19' 등
  const [missingFilter, setMissingFilter] = useState(null) // null=용적률색상, 'vlRat','grndFlrCnt','platArea','totArea'
  const [showSurveyArea, setShowSurveyArea] = useState(false)
  const [selectedBuilding, setSelectedBuilding] = useState(null)
  const [toast, setToast] = useState(null)
  const [mobileSheet, setMobileSheet] = useState(0) // 0=숨김, 1=작게, 2=크게
  const touchYRef = useRef(0)
  const [amenities, setAmenities] = useState({})       // { FD6: [...], CE7: [...] }
  const [amenityLoading, setAmenityLoading] = useState(false)
  const [enabledCats, setEnabledCats] = useState(() => new Set(AMENITY_CATS.map(c => c.code)))
  const amenityCacheRef = useRef({})                    // "lat,lng,radius" → data
  const geoRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    document.documentElement.classList.add('gis-mode')
    return () => document.documentElement.classList.remove('gis-mode')
  }, [])

  useEffect(() => {
    Promise.all([
      fetch(new URL('../gis/data/junggu-buildings-final-lite.geojson', import.meta.url)).then(r => r.json()),
      fetch(new URL('../gis/data/junggu-transit.json', import.meta.url)).then(r => r.json()),
      fetch(new URL('../gis/data/junggu-demographics.json', import.meta.url)).then(r => r.json()),
      fetch(new URL('../gis/data/junggu-commerce.json', import.meta.url)).then(r => r.json()),
      fetch(new URL('../gis/data/land_use_junggu.geojson', import.meta.url)).then(r => r.json()),
    ]).then(([buildings, transit, demo, commerce, zoning]) => {
      setBuildingData(buildings)
      setTransitData(transit)
      setDemoData(demo)
      setCommerceData(commerce)
      setZoningData(zoning)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  // 스크롤 기반 활성 섹션 감지
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const sections = panel.querySelectorAll('[data-section]')
        const panelRect = panel.getBoundingClientRect()
        const triggerY = panelRect.top + panelRect.height * 0.35

        let active = null
        for (const sec of sections) {
          const rect = sec.getBoundingClientRect()
          if (rect.top <= triggerY) {
            active = sec.dataset.section
          }
        }
        if (active && active !== 'pedshed') setVisibleSection(active)
      })
    }

    panel.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { panel.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf) }
  }, [loading, clickedPoint])

  const filtered = useMemo(() => {
    if (!buildingData || !clickedPoint) return []
    const [clat, clng] = clickedPoint
    return buildingData.features.filter(f => {
      const c = getCentroid(f)
      if (!c) return false
      return fastDistM(clat, clng, c[1], c[0]) <= radius
    })
  }, [buildingData, clickedPoint, radius])

  // 반경 내 대중교통 필터링
  const filteredTransit = useMemo(() => {
    if (!transitData || !clickedPoint) return { busStops: [], subwayLines: {} }
    const [clat, clng] = clickedPoint

    const busStops = transitData.busStops.filter(s =>
      fastDistM(clat, clng, s.lat, s.lng) <= radius
    )

    const subwayLines = {}
    for (const [line, info] of Object.entries(transitData.subwayLines)) {
      const stations = info.stations.filter(s =>
        fastDistM(clat, clng, s.lat, s.lng) <= radius
      )
      if (stations.length > 0) {
        subwayLines[line] = { color: info.color, stations }
      }
    }

    return { busStops, subwayLines }
  }, [transitData, clickedPoint, radius])

  // 편의시설 API 호출 (디바운스 500ms)
  useEffect(() => {
    if (!clickedPoint || !KAKAO_KEY) return
    const key = `${clickedPoint[0].toFixed(4)},${clickedPoint[1].toFixed(4)},${radius}`
    if (amenityCacheRef.current[key]) {
      setAmenities(amenityCacheRef.current[key])
      return
    }
    setAmenityLoading(true)
    const timer = setTimeout(async () => {
      try {
        const results = {}
        const promises = AMENITY_CATS.map(async (cat) => {
          results[cat.code] = await fetchCategoryPlaces(cat.code, clickedPoint[1], clickedPoint[0], radius)
        })
        await Promise.all(promises)
        amenityCacheRef.current[key] = results
        setAmenities(results)
      } catch (e) {
        console.error('편의시설 로드 실패', e)
      } finally {
        setAmenityLoading(false)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [clickedPoint, radius])

  const toggleCat = useCallback((code) => {
    setEnabledCats(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code); else next.add(code)
      return next
    })
  }, [])

  // 반경 내 용도지역 필터링 (교차 판정)
  const filteredZoning = useMemo(() => {
    if (!zoningData || !clickedPoint) return []
    const circle = turf.circle([clickedPoint[1], clickedPoint[0]], radius / 1000, { units: 'kilometers', steps: 32 })
    return zoningData.features.filter(f => {
      try { return turf.booleanIntersects(circle, f) } catch { return false }
    })
  }, [zoningData, clickedPoint, radius])

  // 반경 내 상권 필터링
  const filteredCommerce = useMemo(() => {
    if (!commerceData || !clickedPoint) return []
    const [clat, clng] = clickedPoint
    return commerceData.areas.filter(a =>
      fastDistM(clat, clng, a.lat, a.lng) <= radius
    )
  }, [commerceData, clickedPoint, radius])

  // 반경 내 인구 점 필터링
  const filteredDots = useMemo(() => {
    if (!demoData || !clickedPoint) return []
    const [clat, clng] = clickedPoint
    return demoData.dots.filter(d =>
      fastDistM(clat, clng, d.lat, d.lng) <= radius
    )
  }, [demoData, clickedPoint, radius])

  // 역사적 랜드마크 필터링 (반경 기준, 항상 최대 1500m)
  const filteredLandmarks = useMemo(() => {
    if (!clickedPoint) return landmarksData.landmarks
    const R = 6371000
    const [lat, lng] = clickedPoint
    return landmarksData.landmarks.map(lm => {
      const dLat = (lm.lat - lat) * Math.PI / 180
      const dLng = (lm.lng - lng) * Math.PI / 180
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(lm.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
      return { ...lm, dist: Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) }
    }).sort((a, b) => a.dist - b.dist)
  }, [clickedPoint])

  // 반경 내 건물 PNU Set
  const filteredSet = useMemo(() => {
    return new Set(filtered.map(f => f.properties.pnu))
  }, [filtered])

  // 원 밖 건물 스타일
  const OUTSIDE_STYLE = { fillColor: '#ddd', fillOpacity: 0.35, weight: 0.2, color: 'rgba(0,0,0,0.04)' }

  // 지도 스타일 — visibleSection + 원 안/밖 구분
  const buildingStyle = useCallback((feature) => {
    // 원 비활성 → 전체 건물에 색상 적용 (안/밖 구분 없음)
    const inside = !circleEnabled || !clickedPoint || filteredSet.has(feature.properties.pnu)

    if (visibleSection === 'history') {
      const year = getBuildYear(feature.properties)
      if (!inside) return OUTSIDE_STYLE
      if (year && year > ageFilterYear) return { fillColor: 'transparent', fillOpacity: 0, weight: 0, color: 'transparent' }
      return { fillColor: getAgeColor(year), fillOpacity: 0.8, weight: 0.3, color: 'rgba(0,0,0,0.1)' }
    }

    if (!inside) return OUTSIDE_STYLE

    if (visibleSection === 'figground') {
      return { fillColor: '#111', fillOpacity: 0.9, weight: 0, color: 'transparent' }
    }
    if (visibleSection === 'landuse') {
      return { fillColor: getPurpsColor(feature.properties.mainPurps), fillOpacity: 0.75, weight: 0.3, color: 'rgba(0,0,0,0.1)' }
    }
    if (visibleSection === 'intensity') {
      if (missingFilter) {
        const val = feature.properties[missingFilter]
        const isMissing = val === null || val === undefined || val === '' || val === 0
        return isMissing
          ? { fillColor: '#e74c3c', fillOpacity: 0.7, weight: 0.3, color: 'rgba(0,0,0,0.1)' }
          : { fillColor: '#2ecc71', fillOpacity: 0.4, weight: 0.2, color: 'rgba(0,0,0,0.05)' }
      }
      return { fillColor: getVlRatColor(feature.properties.vlRat), fillOpacity: 0.75, weight: 0.3, color: 'rgba(0,0,0,0.08)' }
    }
    if (visibleSection === 'transit' || visibleSection === 'demo' || visibleSection === 'commerce') {
      return { fillColor: '#e8e8e8', fillOpacity: 0.4, weight: 0.2, color: 'rgba(0,0,0,0.03)' }
    }
    return { fillColor: '#bbb', fillOpacity: 0.5, weight: 0.3, color: 'rgba(0,0,0,0.06)' }
  }, [visibleSection, clickedPoint, filteredSet, ageFilterYear, circleEnabled, missingFilter])

  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }, [])

  const copyAddress = useCallback(async (address) => {
    try {
      await navigator.clipboard.writeText(address)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = address
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
  }, [])

  const openEum = useCallback(async (address) => {
    await copyAddress(address)
    window.open('https://www.eum.go.kr/web/ar/lu/luLandDet.jsp', '_blank')
    showToast('주소가 복사되었습니다. 토지이음에서 붙여넣기하세요')
  }, [copyAddress, showToast])

  const onEachBuilding = useCallback((feature, layer) => {
    layer.on({
      mouseover: e => { e.target.setStyle({ weight: 1.5, color: '#333', fillOpacity: 0.95 }); e.target.bringToFront() },
      mouseout: e => { if (geoRef.current) geoRef.current.resetStyle(e.target) },
      click: async () => {
        setSelectedBuilding(feature)
        setMobileSheet(1)
        await copyAddress(feature.properties.address || '')
        showToast('📋 주소가 복사되었습니다')
      },
    })
  }, [copyAddress, showToast])

  const tileUrl = visibleSection === 'figground'
    ? 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

  return (
    <div className="gis-page">
      <Nav />
      <div className="gis-layout">
        {/* 사이드 패널 */}
        <aside
          className={`g-panel g-mobile-sheet-${mobileSheet}`}
          ref={panelRef}
        >
          {/* 모바일 드래그 핸들 — 이 영역에서만 스와이프 */}
          <div
            className="g-mobile-handle"
            onTouchStart={e => { touchYRef.current = e.touches[0].clientY }}
            onTouchEnd={e => {
              const dy = touchYRef.current - e.changedTouches[0].clientY
              if (Math.abs(dy) < 30) return
              if (dy > 0) setMobileSheet(s => Math.min(2, s + 1))
              else setMobileSheet(s => Math.max(0, s - 1))
            }}
          >
            <div className="g-mobile-handle-bar" />
          </div>
          {/* 헤더 */}
          <div className="g-header">
            <div className="g-header-badge">관설 Urban Analytics</div>
            <h1 className="g-header-title">서울 중구</h1>
            <p className="g-header-sub">도시 환경 분석 플랫폼</p>
          </div>

          {/* 뷰 토글 — 항상 고정 */}
          {!loading && (
            <div className="g-view-toggle-fixed">
              <button
                className={`g-view-btn ${circleEnabled ? 'active' : ''}`}
                onClick={() => setCircleEnabled(true)}
              >반경 분석</button>
              <button
                className={`g-view-btn ${!circleEnabled ? 'active' : ''}`}
                onClick={() => setCircleEnabled(false)}
              >전체 보기</button>
            </div>
          )}

          {loading && <div className="g-empty">데이터 로딩 중...</div>}

          {!loading && !clickedPoint && circleEnabled && (
            <div className="g-empty">
              <div className="g-empty-icon">⊕</div>
              <p>지도에서 분석할 위치를<br />클릭하세요</p>
            </div>
          )}

          {/* 전체 보기 + 건물 선택 → 건물 상세 카드 */}
          {!loading && !circleEnabled && selectedBuilding && (
            <BuildingDetailCard
              feature={selectedBuilding}
              zoningData={zoningData}
              onClose={() => setSelectedBuilding(null)}
              onOpenEum={() => openEum(selectedBuilding.properties.address)}
            />
          )}

          {!loading && !circleEnabled && !selectedBuilding && (
            <div className="g-empty">
              <div className="g-empty-icon">⊕</div>
              <p>건물을 클릭하면<br />상세 정보를 확인할 수 있습니다</p>
            </div>
          )}

          {!loading && clickedPoint && circleEnabled && (
            <div className="g-sections">

              {/* ── Pedestrian Shed ── */}
              <section data-section="pedshed" className="g-sec active">
                <div className="g-sec-header">
                  <h2 className="g-sec-title">Pedestrian Shed</h2>
                  <p className="g-sec-desc">보행권역 · Catchment Area</p>
                </div>

                <div className="g-stats-row">
                  <Stat label="반경 내 건물" value={filtered.length} />
                  <Stat label="도보 시간" value={`~${Math.round(radius / 80)}분`} />
                </div>

                <div className="g-divider-thin" />

                <div className="g-sub-title">Amenities {amenityLoading && <span className="g-amenity-loading">로딩 중...</span>}</div>

                <div className="g-amenity-grid">
                  {AMENITY_CATS.map(cat => {
                    const items = amenities[cat.code] || []
                    const enabled = enabledCats.has(cat.code)
                    return (
                      <AmenityCategory
                        key={cat.code}
                        cat={cat}
                        items={items}
                        enabled={enabled}
                        onToggle={() => toggleCat(cat.code)}
                      />
                    )
                  })}
                </div>
              </section>

              {/* ── 슬라이더 (sticky 고정) ── */}
              <div className="g-sticky-controls">
                {circleEnabled && (
                  <>
                    <div className="g-slider-row">
                      <span className="g-slider-value">{(radius / 1000).toFixed(2)} km</span>
                      <input
                        type="range"
                        className="g-slider"
                        min={100}
                        max={1000}
                        step={10}
                        value={radius}
                        onChange={e => setRadius(Number(e.target.value))}
                      />
                    </div>
                    <div className="g-slider-labels">
                      <span>0.10 km</span>
                      <span>1.00 km</span>
                    </div>
                  </>
                )}
              </div>

              {/* ── 선택된 건물 정보 (반경 분석 모드: 간략) ── */}
              {selectedBuilding && circleEnabled && (
                <div className="g-selected-building">
                  <div className="g-selected-header">
                    <div className="g-selected-info">
                      {selectedBuilding.properties.bldNm && <div className="g-selected-name">{selectedBuilding.properties.bldNm}</div>}
                      <div className="g-selected-address">{selectedBuilding.properties.address}</div>
                    </div>
                    <button className="g-selected-close" onClick={() => setSelectedBuilding(null)}>✕</button>
                  </div>
                  <div className="g-selected-details">
                    {selectedBuilding.properties.vlRat > 0 && <span>용적률 {selectedBuilding.properties.vlRat}%</span>}
                    {selectedBuilding.properties.grndFlrCnt > 0 && <span>{selectedBuilding.properties.grndFlrCnt}층</span>}
                    {selectedBuilding.properties.mainPurps && <span>{selectedBuilding.properties.mainPurps}</span>}
                  </div>
                  <button className="g-eum-btn" onClick={() => openEum(selectedBuilding.properties.address)}>
                    🔗 토지이음에서 열람
                  </button>
                </div>
              )}

              <div className="g-section-divider" />

              {/* ── 2. Development Intensity ── */}
              <section data-section="intensity" className={visibleSection === 'intensity' ? 'g-sec active' : 'g-sec'}>
                <div className="g-sec-header">
                  <h2 className="g-sec-title">Development Intensity</h2>
                  <p className="g-sec-desc">개발강도 · 용적률 활용 현황</p>
                </div>
                <IntensityContent buildings={filtered} missingFilter={missingFilter} onMissingFilterChange={setMissingFilter} />
              </section>

              <div className="g-section-divider" />

              {/* ── 3. Figure Ground ── */}
              <section data-section="figground" className={visibleSection === 'figground' ? 'g-sec active' : 'g-sec'}>
                <div className="g-sec-header">
                  <h2 className="g-sec-title">Figure Ground</h2>
                  <p className="g-sec-desc">흑백도 · 건물과 공지의 비율</p>
                </div>
                <FigGroundContent buildings={filtered} />
              </section>

              <div className="g-section-divider" />

              {/* ── 4. Land Use ── */}
              <section data-section="landuse" className={visibleSection === 'landuse' ? 'g-sec active' : 'g-sec'}>
                <div className="g-sec-header">
                  <h2 className="g-sec-title">Land Use</h2>
                  <p className="g-sec-desc">토지이용 · 용도 혼합도</p>
                </div>
                <LandUseContent buildings={filtered} zoningFeatures={filteredZoning} />
              </section>

              <div className="g-section-divider" />

              {/* ── 5. Building Age ── */}
              <section data-section="history" className={visibleSection === 'history' ? 'g-sec active' : 'g-sec'}>
                <div className="g-sec-header">
                  <h2 className="g-sec-title">Building Age</h2>
                  <p className="g-sec-desc">건물이력 · 건물 연령 분포</p>
                </div>
                <BuildingAgeContent
                  buildings={filtered}
                  ageFilterYear={ageFilterYear}
                  onAgeFilterChange={setAgeFilterYear}
                />
              </section>

              <div className="g-section-divider" />

              {/* ── 6. Transit ── */}
              <section data-section="transit" className={visibleSection === 'transit' ? 'g-sec active' : 'g-sec'}>
                <div className="g-sec-header">
                  <h2 className="g-sec-title">Transit Network</h2>
                  <p className="g-sec-desc">대중교통 접근성 · 도보 가능 거리 내 대중교통 분석</p>
                </div>
                <TransitContent data={filteredTransit} />
              </section>

              <div className="g-section-divider" />

              {/* ── 6. Demographics ── */}
              <section data-section="demo" className={visibleSection === 'demo' ? 'g-sec active' : 'g-sec'}>
                <div className="g-sec-header">
                  <h2 className="g-sec-title">Demographics</h2>
                  <p className="g-sec-desc">인구 데이터는 도시의 현재 상태를 이해하는 데 필수적입니다</p>
                </div>
                <DemographicsContent dots={filteredDots} demoData={demoData} radius={radius} ageFilter={demoAgeFilter} onAgeFilterChange={setDemoAgeFilter} />
              </section>

              <div className="g-section-divider" />

              {/* ── 8. Commerce ── */}
              <section data-section="commerce" className={visibleSection === 'commerce' ? 'g-sec active' : 'g-sec'}>
                <div className="g-sec-header">
                  <h2 className="g-sec-title">Commerce</h2>
                  <p className="g-sec-desc">상권분석 · 반경 내 상권 현황</p>
                </div>
                <CommerceContent areas={filteredCommerce} commerceData={commerceData} />
              </section>

              <div className="g-section-divider" />

              {/* ── 9. Historical Context ── */}
              <section data-section="heritage" className={visibleSection === 'heritage' ? 'g-sec active' : 'g-sec'}>
                <div className="g-sec-header">
                  <h2 className="g-sec-title">Historical Context</h2>
                  <p className="g-sec-desc">역사적 맥락 · 도시 정체성의 층위</p>
                </div>
                <HistoricalContextContent landmarks={filteredLandmarks} clickedPoint={clickedPoint} />
              </section>

              <div style={{ height: '65vh' }} />
            </div>
          )}
        </aside>

        {/* 지도 */}
        <div className={`g-map g-map-sheet-${mobileSheet}`}>
          <MapContainer
            center={CENTER}
            zoom={15}
            minZoom={13}
            maxZoom={18}
            maxBounds={BOUNDS}
            maxBoundsViscosity={1.0}
            zoomControl={false}
            style={{ width: '100%', height: '100%' }}
          >
            <TileLayer
              key={tileUrl}
              url={tileUrl}
              attribution='&copy; OpenStreetMap &copy; CARTO'
              subdomains="abcd"
              maxZoom={18}
            />
            <ZoomControl position="bottomright" />
            <MapClick onClick={p => { setClickedPoint(p); setMobileSheet(1) }} />

            {buildingData && (
              <BuildingLayer
                geoRef={geoRef}
                data={buildingData}
                styleFn={buildingStyle}
                onEachBuilding={onEachBuilding}
                deps={`${visibleSection}-${filteredSet.size}-${clickedPoint?.[0]}-${ageFilterYear}-${circleEnabled}-${missingFilter}`}
              />
            )}

            {clickedPoint && circleEnabled && (
              <DraggableCenter
                position={clickedPoint}
                radius={radius}
                onMove={p => setClickedPoint(p)}
              />
            )}

            {visibleSection === 'pedshed' && Object.keys(amenities).length > 0 && circleEnabled && (
              <AmenityLayer amenities={amenities} enabledCats={enabledCats} />
            )}

            {visibleSection === 'landuse' && zoningData && (clickedPoint || !circleEnabled) && (
              <ZoningLayer zoningData={zoningData} filteredZoning={!circleEnabled ? zoningData.features : filteredZoning} />
            )}

            {visibleSection === 'commerce' && commerceData && (clickedPoint || !circleEnabled) && (
              <CommerceLayer
                commerceData={commerceData}
                filteredCommerce={!circleEnabled ? commerceData.areas : filteredCommerce}
              />
            )}

            {visibleSection === 'demo' && demoData && (clickedPoint || !circleEnabled) && (
              <DemoLayer dots={!circleEnabled ? demoData.dots : filteredDots} ageFilter={demoAgeFilter} />
            )}

            {visibleSection === 'transit' && transitData && (clickedPoint || !circleEnabled) && (
              <TransitLayer
                transitData={transitData}
                filteredTransit={!circleEnabled ? { busStops: transitData.busStops, subwayLines: transitData.subwayLines } : filteredTransit}
                clickedPoint={clickedPoint}
                radius={radius}
              />
            )}

            {showSurveyArea && (
              <SurveyAreaLayer data={surveyAreaData} />
            )}

            {visibleSection === 'heritage' && (
              <LandmarkLayer landmarks={filteredLandmarks} clickedPoint={clickedPoint} radius={radius} circleEnabled={circleEnabled} />
            )}
          </MapContainer>

          {toast && <div className="g-toast">{toast}</div>}

          <button
            className={`g-survey-toggle ${showSurveyArea ? 'active' : ''}`}
            onClick={() => setShowSurveyArea(v => !v)}
            title="답사 영역 표시"
          >
            답사 영역
          </button>

          <GisChatbot
            clickedPoint={clickedPoint}
            radius={radius}
            filtered={filtered}
            filteredTransit={filteredTransit}
            filteredDots={filteredDots}
            filteredCommerce={filteredCommerce}
            filteredZoning={filteredZoning}
            amenities={amenities}
          />
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  건물 레이어 (한 번 생성, 스타일만 업데이트)
// ═══════════════════════════════════════════════════════════════
function BuildingLayer({ geoRef, data, styleFn, onEachBuilding, deps }) {
  const map = useMap()
  const layerRef = useRef(null)
  const initializedRef = useRef(false)

  // 최초 1회: GeoJSON 레이어 생성
  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current)
    }
    const layer = L.geoJSON(data, {
      style: styleFn,
      onEachFeature: onEachBuilding,
    }).addTo(map)
    layerRef.current = layer
    geoRef.current = layer
    initializedRef.current = true

    return () => {
      map.removeLayer(layer)
    }
  }, [map, data]) // data가 바뀔 때만 재생성

  // 스타일 변경 시: 레이어 삭제 없이 스타일만 업데이트
  useEffect(() => {
    if (!initializedRef.current || !layerRef.current) return
    layerRef.current.eachLayer(layer => {
      const feature = layer.feature
      if (feature) {
        layer.setStyle(styleFn(feature))
      }
    })
  }, [deps, styleFn])

  return null
}

// ═══════════════════════════════════════════════════════════════
//  편의시설 카테고리 (아코디언)
// ═══════════════════════════════════════════════════════════════
function AmenityCategory({ cat, items, enabled, onToggle }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="g-amenity-cat">
      <div className="g-amenity-cat-header" onClick={() => items.length > 0 && setOpen(!open)}>
        <button
          className={`g-amenity-toggle ${enabled ? 'on' : 'off'}`}
          onClick={e => { e.stopPropagation(); onToggle() }}
          style={enabled ? { background: cat.color } : {}}
        >
          <span className="g-amenity-icon">{cat.icon}</span>
        </button>
        <span className="g-amenity-label">{cat.label}</span>
        <span className="g-amenity-count" style={enabled ? { color: cat.color } : {}}>{items.length}</span>
        {items.length > 0 && <span className={`g-amenity-arrow ${open ? 'open' : ''}`}>›</span>}
      </div>
      {open && enabled && items.length > 0 && (
        <div className="g-amenity-list">
          {items.slice(0, 15).map((p, i) => (
            <div key={i} className="g-amenity-item">
              <span className="g-amenity-name">{p.name}</span>
              <span className="g-amenity-dist">{p.dist}m</span>
            </div>
          ))}
          {items.length > 15 && <div className="g-amenity-more">+{items.length - 15}개 더</div>}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  편의시설 지도 레이어
// ═══════════════════════════════════════════════════════════════
const AMENITY_COLOR_MAP = Object.fromEntries(AMENITY_CATS.map(c => [c.code, c.color]))

function AmenityLayer({ amenities, enabledCats }) {
  const map = useMap()
  const layerRef = useRef(null)

  useEffect(() => {
    if (layerRef.current) map.removeLayer(layerRef.current)
    const group = L.layerGroup().addTo(map)
    layerRef.current = group

    for (const [code, places] of Object.entries(amenities)) {
      if (!enabledCats.has(code)) continue
      const color = AMENITY_COLOR_MAP[code] || '#999'
      for (const p of places) {
        L.circleMarker([p.lat, p.lng], {
          radius: 4,
          fillColor: color,
          fillOpacity: 0.8,
          weight: 1,
          color: '#fff',
          opacity: 0.9,
        }).bindPopup(
          `<div style="font-size:13px;font-weight:600">${p.name}</div><div style="font-size:11px;color:#888">${p.address || ''}</div>`,
          { closeButton: false, offset: [0, -4] }
        ).addTo(group)
      }
    }

    return () => { map.removeLayer(group) }
  }, [map, amenities, enabledCats])

  return null
}

// ═══════════════════════════════════════════════════════════════
//  드래그 가능한 분석 원
// ═══════════════════════════════════════════════════════════════
function DraggableCenter({ position, radius, onMove }) {
  const map = useMap()
  const circleRef = useRef(null)
  const overlayRef = useRef(null)
  const draggingRef = useRef(false)
  const offsetRef = useRef({ lat: 0, lng: 0 })

  // position/radius 변경 시 업데이트
  useEffect(() => {
    if (circleRef.current) circleRef.current.setLatLng(position)
    if (overlayRef.current) overlayRef.current.setLatLng(position)
  }, [position])

  useEffect(() => {
    if (circleRef.current) circleRef.current.setRadius(radius)
    if (overlayRef.current) overlayRef.current.setRadius(radius)
  }, [radius])

  useEffect(() => {
    // 보이는 원 (점선 테두리)
    const circle = L.circle(position, {
      radius,
      color: '#333',
      weight: 1.5,
      dashArray: '6 4',
      fillColor: '#000',
      fillOpacity: 0.04,
      interactive: false,
    }).addTo(map)
    circleRef.current = circle

    // 투명 드래그용 오버레이 (같은 크기, 이벤트 받음)
    const overlay = L.circle(position, {
      radius,
      color: 'transparent',
      fillColor: 'transparent',
      fillOpacity: 0,
      weight: 0,
      interactive: true,
      bubblingMouseEvents: false,
      className: 'g-drag-overlay',
    }).addTo(map)
    overlayRef.current = overlay

    const el = overlay.getElement?.()

    overlay.on('mouseover', () => {
      if (!draggingRef.current && el) el.style.cursor = 'grab'
    })
    overlay.on('mouseout', () => {
      if (!draggingRef.current && el) el.style.cursor = ''
    })

    overlay.on('mousedown', (e) => {
      L.DomEvent.stopPropagation(e)
      draggingRef.current = true
      if (el) el.style.cursor = 'grabbing'
      map.dragging.disable()

      const center = circle.getLatLng()
      offsetRef.current = {
        lat: center.lat - e.latlng.lat,
        lng: center.lng - e.latlng.lng,
      }

      map.on('mousemove', onDrag)
      map.once('mouseup', onDragEnd)
    })

    function onDrag(e) {
      const newLat = e.latlng.lat + offsetRef.current.lat
      const newLng = e.latlng.lng + offsetRef.current.lng
      circle.setLatLng([newLat, newLng])
      overlay.setLatLng([newLat, newLng])
    }

    function onDragEnd(e) {
      map.off('mousemove', onDrag)
      draggingRef.current = false
      map.dragging.enable()
      if (el) el.style.cursor = 'grab'

      const center = circle.getLatLng()
      onMove([center.lat, center.lng])
    }

    return () => {
      map.off('mousemove', onDrag)
      map.off('mouseup', onDragEnd)
      map.removeLayer(circle)
      map.removeLayer(overlay)
    }
  }, [map]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

// ═══════════════════════════════════════════════════════════════
//  개발강도
// ═══════════════════════════════════════════════════════════════
const MISSING_FILTERS = [
  { key: 'vlRat', label: '용적률', icon: '📊' },
  { key: 'grndFlrCnt', label: '층수', icon: '🏢' },
  { key: 'platArea', label: '대지면적', icon: '📐' },
  { key: 'totArea', label: '연면적', icon: '📏' },
]

function IntensityContent({ buildings, missingFilter, onMissingFilterChange }) {
  const withVl = buildings.filter(b => b.properties.vlRat > 0)
  const avg = withVl.length ? Math.round(withVl.reduce((s, b) => s + b.properties.vlRat, 0) / withVl.length) : 0

  const buckets = [
    { range: '0–100', min: 0, max: 100, color: '#2166ac' },
    { range: '100–200', min: 100, max: 200, color: '#67a9cf' },
    { range: '200–300', min: 200, max: 300, color: '#a8d4e6' },
    { range: '300–500', min: 300, max: 500, color: '#ef8a62' },
    { range: '500+', min: 500, max: Infinity, color: '#b2182b' },
  ]
  const hist = buckets.map(b => ({
    name: b.range,
    value: withVl.filter(f => {
      const v = f.properties.vlRat
      return b.min === 0 ? (v > 0 && v <= b.max) : (v > b.min && (b.max === Infinity || v <= b.max))
    }).length,
    color: b.color,
  }))

  const under = withVl.filter(b => b.properties.vlRat <= 100).length
  const normal = withVl.filter(b => b.properties.vlRat > 100 && b.properties.vlRat <= 500).length
  const over = withVl.filter(b => b.properties.vlRat > 500).length
  const pieData = [
    { name: '저활용 ≤100%', value: under, color: '#2166ac' },
    { name: '적정 100–500%', value: normal, color: '#67a9cf' },
    { name: '과밀 500%+', value: over, color: '#b2182b' },
  ].filter(d => d.value > 0)

  return (
    <>
      <div className="g-stats-row">
        <Stat label="건물 수" value={buildings.length} />
        <Stat label="용적률 보유" value={withVl.length} />
        <Stat label="평균 용적률" value={`${avg}%`} />
      </div>

      <div className="g-sub-title">용적률 분포</div>
      <div className="g-chart">
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={hist} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#999' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#bbb' }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTip />} />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {hist.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {pieData.length > 0 && (
        <>
          <div className="g-sub-title">활용 구분</div>
          <div className="g-chart">
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={38} outerRadius={62} dataKey="value" paddingAngle={2}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip content={<ChartTip />} />
                <Legend iconSize={8} formatter={v => <span style={{ fontSize: 11, color: '#666' }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <div className="g-divider-thin" />

      <div className="g-sub-title">결측값 시각화 {missingFilter && <span className="g-age-filter-hint">클릭하여 해제</span>}</div>
      <div className="g-missing-grid">
        {MISSING_FILTERS.map(mf => {
          const total = buildings.length
          const missing = buildings.filter(b => {
            const v = b.properties[mf.key]
            return v === null || v === undefined || v === '' || v === 0
          }).length
          const pct = total > 0 ? ((missing / total) * 100).toFixed(1) : 0
          const active = missingFilter === mf.key

          return (
            <div
              key={mf.key}
              className={`g-missing-card ${active ? 'active' : ''}`}
              onClick={() => onMissingFilterChange(active ? null : mf.key)}
            >
              <div className="g-missing-icon">{mf.icon}</div>
              <div className="g-missing-label">{mf.label}</div>
              <div className="g-missing-numbers">
                <span className="g-missing-red">{missing.toLocaleString()}</span>
                <span className="g-missing-slash"> / {total.toLocaleString()}</span>
              </div>
              <div className="g-missing-bar-track">
                <div className="g-missing-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="g-missing-pct">{pct}% 결측</div>
            </div>
          )
        })}
      </div>
      {missingFilter && (
        <div className="g-missing-legend">
          <span className="g-missing-legend-item"><span className="g-dot" style={{ background: '#e74c3c' }} />결측</span>
          <span className="g-missing-legend-item"><span className="g-dot" style={{ background: '#2ecc71' }} />값 있음</span>
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
//  흑백도
// ═══════════════════════════════════════════════════════════════
function FigGroundContent({ buildings }) {
  let solidArea = 0
  const totalPlat = buildings.reduce((s, b) => s + (b.properties.platArea || 0), 0)
  for (const b of buildings) {
    const floors = b.properties.grndFlrCnt || 1
    solidArea += (b.properties.totArea || 0) / Math.max(floors, 1)
  }
  const solidRatio = totalPlat > 0 ? Math.min(1, solidArea / totalPlat) : 0
  const voidRatio = 1 - solidRatio

  const pieData = [
    { name: 'Solid (건물)', value: +(solidRatio * 100).toFixed(1), color: '#111' },
    { name: 'Void (공지)', value: +(voidRatio * 100).toFixed(1), color: '#e0e0e0' },
  ]

  return (
    <>
      <div className="g-stats-row">
        <Stat label="건물 수" value={buildings.length} />
        <Stat label="Footprints Area" value={`${Math.round(solidArea).toLocaleString()}㎡`} />
      </div>

      <div className="g-sub-title">Solid / Void Ratio</div>
      <div className="g-sv-bar">
        <div className="g-sv-fill" style={{ width: `${solidRatio * 100}%` }} />
      </div>
      <div className="g-sv-labels">
        <span>Solid {(solidRatio * 100).toFixed(1)}%</span>
        <span>Void {(voidRatio * 100).toFixed(1)}%</span>
      </div>

      <div className="g-chart" style={{ marginTop: 12 }}>
        <ResponsiveContainer width="100%" height={170}>
          <PieChart>
            <Pie data={pieData} cx="50%" cy="50%" innerRadius={38} outerRadius={62} dataKey="value" paddingAngle={2}>
              {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Legend iconSize={8} formatter={v => <span style={{ fontSize: 11, color: '#666' }}>{v}</span>} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
//  토지이용
// ═══════════════════════════════════════════════════════════════
function LandUseContent({ buildings, zoningFeatures }) {
  const counts = {}
  for (const b of buildings) {
    const p = b.properties.mainPurps || '기타'
    counts[p] = (counts[p] || 0) + 1
  }
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value, color: getPurpsColor(name) }))
  const entropyScore = calcEntropy(counts)
  const maxCount = sorted.length ? sorted[0].value : 1

  // 용도지역 집계
  const zoningAgg = {}
  for (const f of (zoningFeatures || [])) {
    const name = f.properties['용도지역명'] || '기타'
    if (name.startsWith('기타')) continue
    const area = parseFloat(f.properties.DGM_AR) || 0
    if (!zoningAgg[name]) zoningAgg[name] = 0
    zoningAgg[name] += area
  }
  const totalZoningArea = Object.values(zoningAgg).reduce((s, v) => s + v, 0)
  const zoningSorted = Object.entries(zoningAgg)
    .sort((a, b) => b[1] - a[1])
    .map(([name, area]) => ({
      name,
      area: Math.round(area),
      pct: totalZoningArea > 0 ? ((area / totalZoningArea) * 100).toFixed(1) : 0,
      color: getZoningColor(name),
      maxFar: getMaxFAR(name),
    }))

  return (
    <>
      <div className="g-stats-row">
        <Stat label="건물 수" value={buildings.length} />
        <Stat label="용도 수" value={sorted.length} />
        <Stat label="Entropy" value={entropyScore} />
      </div>

      <div className="g-sub-title">건물 용도별 분포</div>
      <div className="g-bar-list">
        {sorted.slice(0, 10).map(d => (
          <div key={d.name} className="g-bar-item">
            <div className="g-bar-header">
              <span className="g-bar-dot" style={{ background: d.color }} />
              <span className="g-bar-name">{d.name}</span>
              <span className="g-bar-count">{d.value}</span>
            </div>
            <div className="g-bar-track">
              <div className="g-bar-fill" style={{ width: `${(d.value / maxCount) * 100}%`, background: d.color }} />
            </div>
          </div>
        ))}
      </div>

      <div className="g-entropy-box">
        <span className="g-entropy-label">Entropy Score</span>
        <span className="g-entropy-value">{entropyScore}</span>
        <span className="g-entropy-max">/ 1.0</span>
      </div>
      <p className="g-entropy-note">1에 가까울수록 용도가 다양합니다</p>

      {zoningSorted.length > 0 && (
        <>
          <div className="g-divider-thin" />
          <div className="g-sub-title">Zoning (용도지역)</div>
          <div className="g-zoning-list">
            {zoningSorted.map(z => (
              <div key={z.name} className="g-zoning-item">
                <span className="g-zoning-dot" style={{ background: z.color }} />
                <div className="g-zoning-info">
                  <span className="g-zoning-name">{z.name}</span>
                  {z.maxFar && <span className="g-zoning-far">허용 {z.maxFar}%</span>}
                </div>
                <div className="g-zoning-values">
                  <span className="g-zoning-area">{z.area.toLocaleString()}㎡</span>
                  <span className="g-zoning-pct">{z.pct}%</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
//  용도지역 지도 레이어
// ═══════════════════════════════════════════════════════════════
function ZoningLayer({ zoningData, filteredZoning }) {
  const map = useMap()
  const layerRef = useRef(null)

  useEffect(() => {
    if (layerRef.current) map.removeLayer(layerRef.current)
    const group = L.layerGroup().addTo(map)
    layerRef.current = group

    const insideFeatures = new Set(filteredZoning)

    for (const feat of zoningData.features) {
      const name = feat.properties['용도지역명'] || '기타'
      const color = getZoningColor(name)
      const inside = insideFeatures.has(feat)

      L.geoJSON(feat, {
        style: {
          fillColor: color,
          fillOpacity: inside ? 0.2 : 0.03,
          color: color,
          weight: inside ? 1.5 : 0.5,
          opacity: inside ? 0.7 : 0.05,
        },
        interactive: false,
      }).addTo(group)
    }

    // 건물 레이어 위로 올리지 않도록 뒤로 보내기
    group.eachLayer(l => { if (l.bringToBack) l.bringToBack() })

    return () => { map.removeLayer(group) }
  }, [map, zoningData, filteredZoning])

  return null
}

// ═══════════════════════════════════════════════════════════════
//  대중교통 지도 레이어
// ═══════════════════════════════════════════════════════════════
function TransitLayer({ transitData, filteredTransit, clickedPoint, radius }) {
  const map = useMap()
  const layerGroupRef = useRef(null)

  useEffect(() => {
    if (layerGroupRef.current) {
      map.removeLayer(layerGroupRef.current)
    }
    const group = L.layerGroup().addTo(map)
    layerGroupRef.current = group

    const center = clickedPoint ? turf.point([clickedPoint[1], clickedPoint[0]]) : null
    const insideBusSet = new Set(filteredTransit.busStops.map(s => `${s.lat}-${s.lng}`))
    const insideStationSet = new Set()
    for (const info of Object.values(filteredTransit.subwayLines)) {
      for (const s of info.stations) insideStationSet.add(s.name)
    }

    // 지하철 노선 (전체 그리되 반경 밖은 흐리게)
    for (const [line, info] of Object.entries(transitData.subwayLines)) {
      const allStations = info.stations
      if (allStations.length < 2) continue

      const coords = allStations.map(s => [s.lat, s.lng])
      // 전체 노선 선 (흐리게)
      L.polyline(coords, {
        color: info.color,
        weight: 5,
        opacity: 0.12,
        interactive: false,
      }).addTo(group)

      // 반경 내 구간 강조
      const insideCoords = allStations
        .filter(s => insideStationSet.has(s.name))
        .map(s => [s.lat, s.lng])
      if (insideCoords.length >= 2) {
        L.polyline(insideCoords, {
          color: info.color,
          weight: 5,
          opacity: 0.9,
          interactive: false,
        }).addTo(group)
      }

      // 역 마커 + 라벨
      for (const s of allStations) {
        const inside = insideStationSet.has(s.name)
        L.circleMarker([s.lat, s.lng], {
          radius: inside ? 7 : 4,
          fillColor: info.color,
          fillOpacity: inside ? 0.9 : 0.15,
          color: '#fff',
          weight: inside ? 2 : 1,
          opacity: inside ? 1 : 0.15,
        }).addTo(group)

        if (inside) {
          L.marker([s.lat, s.lng], {
            icon: L.divIcon({
              className: 'g-station-label',
              html: `<span>${s.name}</span>`,
              iconSize: [0, 0],
              iconAnchor: [0, -12],
            }),
            interactive: false,
          }).addTo(group)
        }
      }
    }

    // 버스 정류장 (divIcon으로 줌 레벨 무관 고정 크기)
    for (const s of transitData.busStops) {
      const inside = insideBusSet.has(`${s.lat}-${s.lng}`)
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: inside ? 'g-bus-dot inside' : 'g-bus-dot outside',
          iconSize: [10, 10],
          iconAnchor: [5, 5],
        }),
        interactive: false,
      }).addTo(group)
    }

    return () => { map.removeLayer(group) }
  }, [map, transitData, filteredTransit, clickedPoint, radius])

  return null
}

// ═══════════════════════════════════════════════════════════════
//  대중교통 사이드 패널
// ═══════════════════════════════════════════════════════════════
function TransitContent({ data }) {
  const { busStops, subwayLines } = data
  const subwayEntries = Object.entries(subwayLines)
  // 환승역 중복 제거한 고유 역 수
  const uniqueStationNames = new Set()
  subwayEntries.forEach(([, info]) => info.stations.forEach(s => uniqueStationNames.add(s.name)))
  const totalStations = uniqueStationNames.size

  return (
    <>
      {/* Bus */}
      <div className="g-transit-group">
        <div className="g-transit-header">
          <span className="g-transit-icon" style={{ background: '#3366cc' }} />
          <span className="g-transit-group-title">Bus Network</span>
        </div>
        <div className="g-stats-row">
          <Stat label="Stops" value={busStops.length} />
        </div>
      </div>

      <div className="g-divider-thin" />

      {/* Subway */}
      <div className="g-transit-group">
        <div className="g-transit-header">
          <span className="g-transit-icon" style={{ background: '#f59e0b' }} />
          <span className="g-transit-group-title">Subway Network</span>
        </div>
        <div className="g-stats-row">
          <Stat label="Lines" value={subwayEntries.length} />
          <Stat label="Stations" value={totalStations} />
        </div>

        {subwayEntries.length > 0 && (
          <div className="g-transit-lines">
            {subwayEntries.map(([line, info]) => (
              <div key={line} className="g-transit-line">
                <span className="g-transit-line-badge" style={{ background: info.color }}>
                  {line.replace('0', '').replace('호선', '')}
                </span>
                <div className="g-transit-stations">
                  {info.stations.map(s => (
                    <span key={s.code} className="g-transit-station-tag">{s.name}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {subwayEntries.length === 0 && (
          <p className="g-age-note" style={{ marginTop: 8 }}>반경 내 지하철역이 없습니다</p>
        )}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
//  인구 Dot Density 지도 레이어
// ═══════════════════════════════════════════════════════════════
const AGE_DOT_COLORS = {
  'age_0_19': '#3366cc',
  'age_20_39': '#2ecc71',
  'age_40_59': '#f39c12',
  'age_60_plus': '#e74c3c',
}

function DemoLayer({ dots, ageFilter }) {
  const map = useMap()
  const layerRef = useRef(null)

  useEffect(() => {
    if (layerRef.current) map.removeLayer(layerRef.current)

    const canvas = L.canvas({ padding: 0.5 })
    const group = L.layerGroup()

    for (const d of dots) {
      if (ageFilter && d.g !== ageFilter) continue
      L.circleMarker([d.lat, d.lng], {
        radius: 2.5,
        fillColor: AGE_DOT_COLORS[d.g] || '#999',
        fillOpacity: 0.7,
        weight: 0,
        renderer: canvas,
        interactive: false,
      }).addTo(group)
    }

    group.addTo(map)
    layerRef.current = group

    return () => { map.removeLayer(group) }
  }, [map, dots, ageFilter])

  return null
}

// ═══════════════════════════════════════════════════════════════
//  인구 사이드 패널
// ═══════════════════════════════════════════════════════════════
const AGE_LABELS = {
  'age_0_19': '19세 이하',
  'age_20_39': '20~39세',
  'age_40_59': '40~59세',
  'age_60_plus': '60세 이상',
}

function DemographicsContent({ dots, demoData, radius, ageFilter, onAgeFilterChange }) {
  if (!demoData) return <div className="g-coming-soon">데이터 로딩 중...</div>

  const dotPer = demoData.dotPer || 10
  const totalPop = dots.length * dotPer
  const areaSqKm = Math.PI * (radius / 1000) ** 2
  const density = areaSqKm > 0 ? Math.round(totalPop / areaSqKm) : 0

  // 연령대별 집계
  const ageCounts = { age_0_19: 0, age_20_39: 0, age_40_59: 0, age_60_plus: 0 }
  for (const d of dots) ageCounts[d.g] = (ageCounts[d.g] || 0) + 1
  const totalDots = dots.length || 1

  const ageData = Object.entries(ageCounts).map(([key, count]) => ({
    key,
    label: AGE_LABELS[key],
    color: AGE_DOT_COLORS[key],
    count: count * dotPer,
    pct: ((count / totalDots) * 100).toFixed(1),
  }))

  // 연령 다양성 (Shannon Entropy)
  const entropyVal = calcEntropy(ageCounts)

  // 시간대별 차트
  const hourlyChart = demoData.hourlyChart || []

  return (
    <>
      <div className="g-sub-title">Population Density</div>
      <div className="g-stats-row">
        <Stat label="People" value={Math.round(totalPop).toLocaleString()} />
        <Stat label="People / km²" value={density.toLocaleString()} />
      </div>

      <div className="g-divider-thin" />

      <div className="g-sub-title">Age Distribution <span className="g-age-filter-hint">{ageFilter ? '클릭하여 해제' : '클릭하여 필터'}</span></div>
      <div className="g-bar-list">
        {ageData.map(d => (
          <div
            key={d.key}
            className={`g-bar-item g-bar-clickable ${ageFilter === d.key ? 'selected' : ''} ${ageFilter && ageFilter !== d.key ? 'dimmed' : ''}`}
            onClick={() => onAgeFilterChange(ageFilter === d.key ? null : d.key)}
          >
            <div className="g-bar-header">
              <span className="g-bar-dot" style={{ background: d.color }} />
              <span className="g-bar-name">{d.label}</span>
              <span className="g-bar-count">{d.pct}%</span>
            </div>
            <div className="g-bar-track">
              <div className="g-bar-fill" style={{ width: `${d.pct}%`, background: d.color }} />
            </div>
          </div>
        ))}
      </div>

      <div className="g-divider-thin" />

      <div className="g-sub-title">시간대별 유동인구</div>
      {hourlyChart.length > 0 ? (
        <div className="g-chart">
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={hourlyChart} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="hour"
                tick={{ fontSize: 9, fill: '#aaa' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={h => h % 3 === 0 ? `${h}시` : ''}
              />
              <YAxis tick={{ fontSize: 9, fill: '#bbb' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} />
              <Bar dataKey="pop" fill="#3366cc" radius={[2, 2, 0, 0]} opacity={0.7} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="g-coming-soon">데이터 준비 중</div>
      )}

      <div className="g-divider-thin" />

      <div className="g-entropy-box">
        <span className="g-entropy-label">Age Diversity</span>
        <span className="g-entropy-value">{entropyVal}</span>
        <span className="g-entropy-max">/ 1.0</span>
      </div>
      <p className="g-entropy-note">연령대 분포의 다양성 지수 (Shannon Entropy)</p>

      <div className="g-divider-thin" />

      <div className="g-sub-title">범례</div>
      <div className="g-age-legend">
        {ageData.map(d => (
          <div key={d.key} className="g-age-legend-item">
            <div className="g-age-legend-color" style={{ background: d.color }} />
            <span>{d.label}</span>
          </div>
        ))}
      </div>
      <p className="g-age-note" style={{ marginTop: 8 }}>1점 = {dotPer}명 · 오후 2시 기준 생활인구</p>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
//  상권 지도 레이어
// ═══════════════════════════════════════════════════════════════
const COMMERCE_COLORS = {
  '골목상권': '#3366cc',
  '발달상권': '#e74c3c',
  '전통시장': '#2ecc71',
  '관광특구': '#f39c12',
}

function CommerceLayer({ commerceData, filteredCommerce }) {
  const map = useMap()
  const layerRef = useRef(null)

  useEffect(() => {
    if (layerRef.current) map.removeLayer(layerRef.current)
    const group = L.layerGroup().addTo(map)
    layerRef.current = group

    const insideSet = new Set(filteredCommerce.map(a => a.code))

    for (const a of commerceData.areas) {
      const inside = insideSet.has(a.code)
      const color = COMMERCE_COLORS[a.type] || '#999'

      L.circle([a.lat, a.lng], {
        radius: a.radius || 50,
        color: color,
        weight: inside ? 2 : 1,
        dashArray: inside ? null : '4 4',
        opacity: inside ? 0.8 : 0.2,
        fillColor: color,
        fillOpacity: inside ? 0.15 : 0,
        interactive: inside,
      }).addTo(group)

      if (inside) {
        L.marker([a.lat, a.lng], {
          icon: L.divIcon({
            className: 'g-commerce-label',
            html: `<span>${a.name}</span>`,
            iconSize: [0, 0],
            iconAnchor: [0, 8],
          }),
          interactive: false,
        }).addTo(group)
      }
    }

    return () => { map.removeLayer(group) }
  }, [map, commerceData, filteredCommerce])

  return null
}

// ═══════════════════════════════════════════════════════════════
//  상권 사이드 패널
// ═══════════════════════════════════════════════════════════════
function CommerceContent({ areas, commerceData }) {
  if (!commerceData) return <div className="g-coming-soon">데이터 로딩 중...</div>

  const totalStores = areas.reduce((s, a) => s + a.stores, 0)
  const totalOpen = areas.reduce((s, a) => s + a.openStores, 0)
  const totalClose = areas.reduce((s, a) => s + a.closeStores, 0)
  const totalSales = areas.reduce((s, a) => s + a.salesTotal, 0)
  const closeRate = totalStores > 0 ? ((totalClose / totalStores) * 100).toFixed(1) : 0

  // 상권 유형별 카운트
  const typeCounts = {}
  for (const a of areas) {
    typeCounts[a.type] = (typeCounts[a.type] || 0) + 1
  }

  // 업종별 점포 수 집계
  const catCounts = {}
  for (const a of areas) {
    for (const [cat, count] of a.topCategories) {
      catCounts[cat] = (catCounts[cat] || 0) + count
    }
  }
  const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const maxCat = sortedCats.length ? sortedCats[0][1] : 1

  return (
    <>
      <div className="g-stats-row">
        <Stat label="상권 수" value={areas.length} />
        <Stat label="총 점포" value={totalStores.toLocaleString()} />
      </div>

      {/* 상권 유형 태그 */}
      <div className="g-commerce-tags">
        {Object.entries(typeCounts).map(([type, count]) => (
          <span key={type} className="g-commerce-tag" style={{ borderColor: COMMERCE_COLORS[type] || '#999', color: COMMERCE_COLORS[type] || '#999' }}>
            {type} {count}
          </span>
        ))}
      </div>

      <div className="g-divider-thin" />

      <div className="g-sub-title">업종 분포</div>
      <div className="g-bar-list">
        {sortedCats.map(([name, value]) => (
          <div key={name} className="g-bar-item">
            <div className="g-bar-header">
              <span className="g-bar-name">{name}</span>
              <span className="g-bar-count">{value}</span>
            </div>
            <div className="g-bar-track">
              <div className="g-bar-fill" style={{ width: `${(value / maxCat) * 100}%`, background: '#666' }} />
            </div>
          </div>
        ))}
      </div>

      <div className="g-divider-thin" />

      <div className="g-sub-title">개업 / 폐업</div>
      <div className="g-stats-row">
        <Stat label="개업" value={totalOpen} />
        <Stat label="폐업" value={totalClose} />
        <Stat label="폐업률" value={`${closeRate}%`} />
      </div>

      <div className="g-divider-thin" />

      <div className="g-sub-title">추정 매출 ({commerceData.quarter.slice(0,4)}년 {commerceData.quarter.slice(4)}분기)</div>
      <div className="g-stats-row">
        <Stat label="총 매출" value={totalSales > 0 ? `${(totalSales / 100000000).toFixed(1)}억` : '—'} />
        <Stat label="상권 수" value={areas.filter(a => a.salesTotal > 0).length} />
      </div>

      {areas.filter(a => a.salesTotal > 0).length > 0 && (
        <div className="g-commerce-sales-list">
          {[...areas].filter(a => a.salesTotal > 0).sort((a, b) => b.salesTotal - a.salesTotal).map(a => (
            <div key={a.code} className="g-commerce-sales-item">
              <div className="g-commerce-sales-header">
                <span className="g-commerce-sales-dot" style={{ background: COMMERCE_COLORS[a.type] || '#999' }} />
                <span className="g-commerce-sales-name">{a.name}</span>
              </div>
              <div className="g-commerce-sales-row">
                <span className="g-commerce-sales-value">{(a.salesTotal / 100000000).toFixed(1)}억</span>
                <span className="g-commerce-sales-meta">{a.stores}개 점포 · {a.type}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="g-divider-thin" />

      <div className="g-sub-title">범례</div>
      <div className="g-age-legend">
        {Object.entries(COMMERCE_COLORS).map(([type, color]) => (
          <div key={type} className="g-age-legend-item">
            <div className="g-age-legend-color" style={{ background: color }} />
            <span>{type}</span>
          </div>
        ))}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
//  건물이력
// ═══════════════════════════════════════════════════════════════
function BuildingAgeContent({ buildings, ageFilterYear, onAgeFilterChange }) {
  const currentYear = 2026

  const withYear = buildings.filter(b => getBuildYear(b.properties) > 0)
  const years = withYear.map(b => getBuildYear(b.properties))
  const avgAge = years.length ? Math.round(years.reduce((s, y) => s + (currentYear - y), 0) / years.length) : 0
  const maxAge = years.length ? currentYear - Math.min(...years) : 0

  const hist = AGE_BUCKETS.map(bucket => ({
    name: bucket.label,
    value: withYear.filter(b => {
      const y = getBuildYear(b.properties)
      return y >= bucket.min && y <= bucket.max
    }).length,
    color: bucket.color,
  }))

  return (
    <>
      <div className="g-stats-row">
        <Stat label="건물 수" value={buildings.length} />
        <Stat label="연도 보유" value={withYear.length} />
        <Stat label="평균 연령" value={`${avgAge}년`} />
        <Stat label="최고 연령" value={`${maxAge}년`} />
      </div>

      <div className="g-sub-title">연대별 분포</div>
      <div className="g-chart">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={hist} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#999' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#bbb' }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTip />} />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {hist.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="g-divider-thin" />

      <div className="g-sub-title">시간 슬라이더</div>
      <div className="g-slider-row">
        <span className="g-slider-value">~{ageFilterYear}년</span>
        <input
          type="range"
          className="g-slider"
          min={1950}
          max={2025}
          step={1}
          value={ageFilterYear}
          onChange={e => onAgeFilterChange(Number(e.target.value))}
        />
      </div>
      <div className="g-slider-labels">
        <span>1950</span>
        <span>2025</span>
      </div>
      <p className="g-age-note">{ageFilterYear}년 이전에 지어진 건물만 표시됩니다</p>

      <div className="g-divider-thin" />

      <div className="g-sub-title">범례</div>
      <div className="g-age-legend">
        {AGE_BUCKETS.map(b => (
          <div key={b.label} className="g-age-legend-item">
            <div className="g-age-legend-color" style={{ background: b.color }} />
            <span>{b.label}</span>
          </div>
        ))}
        <div className="g-age-legend-item">
          <div className="g-age-legend-color" style={{ background: '#ccc' }} />
          <span>데이터 없음</span>
        </div>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
//  역사적 맥락 사이드바
// ═══════════════════════════════════════════════════════════════
const CATEGORY_COLORS = {
  '조선 성곽': '#8B4513',
  '조선 궁궐': '#D4A017',
  '근대 종교건축': '#5B4A8A',
  '근대 시장': '#2E7D32',
  '근대 행정건축': '#1565C0',
  '근대 교통건축': '#E65100',
  '도시재생': '#00695C',
  '현대건축': '#37474F',
  '현대 랜드마크': '#37474F',
}

function HistoricalContextContent({ landmarks, clickedPoint }) {
  const [expanded, setExpanded] = useState(null)

  const nearby = clickedPoint
    ? landmarks.filter(lm => lm.dist <= 1500)
    : landmarks

  const farther = clickedPoint
    ? landmarks.filter(lm => lm.dist > 1500)
    : []

  const LandmarkCard = ({ lm }) => {
    const isOpen = expanded === lm.id
    const color = CATEGORY_COLORS[lm.category] || '#555'
    const yearStr = lm.originalYear && lm.originalYear !== lm.year
      ? `원축 ${lm.originalYear}년 · 현재 ${lm.year}년`
      : `${lm.year}년`

    return (
      <div className="g-landmark-card" onClick={() => setExpanded(isOpen ? null : lm.id)}>
        <div className="g-landmark-header">
          <span className="g-landmark-icon">{lm.icon}</span>
          <div className="g-landmark-info">
            <div className="g-landmark-name">{lm.name}</div>
            <div className="g-landmark-meta">
              <span className="g-landmark-cat" style={{ color }}>{lm.category}</span>
              <span className="g-landmark-year">{yearStr}</span>
              {lm.dist != null && <span className="g-landmark-dist">{lm.dist < 1000 ? `${lm.dist}m` : `${(lm.dist / 1000).toFixed(1)}km`}</span>}
            </div>
          </div>
          <span className={`g-amenity-arrow ${isOpen ? 'open' : ''}`}>›</span>
        </div>
        {isOpen && (
          <div className="g-landmark-body">
            <p className="g-landmark-desc">{lm.description}</p>
            <p className="g-landmark-sig"><strong>도시적 의미:</strong> {lm.significance}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {nearby.length > 0 && (
        <>
          <div className="g-sub-title">반경 1.5km 내 ({nearby.length}개)</div>
          {nearby.map(lm => <LandmarkCard key={lm.id} lm={lm} />)}
        </>
      )}
      {!clickedPoint && landmarks.map(lm => <LandmarkCard key={lm.id} lm={lm} />)}
      {clickedPoint && nearby.length === 0 && (
        <div className="g-empty-small">반경 1.5km 내 주요 랜드마크 없음</div>
      )}
      {farther.length > 0 && (
        <>
          <div className="g-divider-thin" />
          <div className="g-sub-title" style={{ color: '#999' }}>중구 전체 ({farther.length}개)</div>
          {farther.map(lm => <LandmarkCard key={lm.id} lm={lm} />)}
        </>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
//  역사적 랜드마크 지도 레이어
// ═══════════════════════════════════════════════════════════════
function LandmarkLayer({ landmarks, clickedPoint, radius, circleEnabled }) {
  const map = useMap()
  const layerRef = useRef(null)

  useEffect(() => {
    if (layerRef.current) map.removeLayer(layerRef.current)
    const group = L.layerGroup().addTo(map)
    layerRef.current = group

    const nearby = (circleEnabled && clickedPoint)
      ? landmarks.filter(lm => lm.dist <= Math.max(radius, 1500))
      : landmarks

    for (const lm of nearby) {
      const color = CATEGORY_COLORS[lm.category] || '#555'
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          background:${color};
          border:2px solid white;
          border-radius:50%;
          width:28px;height:28px;
          display:flex;align-items:center;justify-content:center;
          font-size:14px;
          box-shadow:0 2px 6px rgba(0,0,0,0.35);
          cursor:pointer;
        ">${lm.icon}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })
      const marker = L.marker([lm.lat, lm.lng], { icon })
      const yearStr = lm.originalYear && lm.originalYear !== lm.year
        ? `원축 ${lm.originalYear}년 · 현재 ${lm.year}년`
        : `${lm.year}년`
      marker.bindPopup(`
        <div style="max-width:240px;font-family:inherit">
          <div style="font-weight:700;margin-bottom:4px">${lm.name}</div>
          <div style="color:${color};font-size:11px;margin-bottom:6px">${lm.category} · ${yearStr}</div>
          <div style="font-size:12px;line-height:1.5;color:#333">${lm.significance}</div>
        </div>
      `, { maxWidth: 260 })
      marker.addTo(group)
    }

    return () => { map.removeLayer(group) }
  }, [map, landmarks, clickedPoint, radius, circleEnabled])

  return null
}

// ═══════════════════════════════════════════════════════════════
//  답사 영역 레이어
// ═══════════════════════════════════════════════════════════════
function SurveyAreaLayer({ data }) {
  const map = useMap()
  const layerRef = useRef(null)

  useEffect(() => {
    if (layerRef.current) map.removeLayer(layerRef.current)
    const layer = L.geoJSON(data, {
      style: {
        color: '#f1c40f',
        weight: 3,
        dashArray: '8 4',
        fillColor: '#f1c40f',
        fillOpacity: 0.08,
      },
      interactive: false,
    }).addTo(map)
    layer.bringToFront()
    layerRef.current = layer
    return () => { map.removeLayer(layer) }
  }, [map, data])

  return null
}

// ═══════════════════════════════════════════════════════════════
//  건물 상세 카드 (전체 보기 모드)
// ═══════════════════════════════════════════════════════════════
function BuildingDetailCard({ feature, zoningData, onClose, onOpenEum }) {
  const p = feature.properties
  const currentYear = 2026

  // 건물 연령
  const buildYear = getBuildYear(p)
  const age = buildYear ? currentYear - buildYear : null

  // 바닥면적 (폴리곤)
  const footprint = useMemo(() => {
    try { return Math.round(turf.area(feature)) } catch { return null }
  }, [feature])

  // 용도지역 판별
  const zoning = useMemo(() => {
    if (!zoningData) return null
    const centroid = getCentroid(feature)
    if (!centroid) return null
    const pt = turf.point(centroid)
    for (const zf of zoningData.features) {
      try {
        if (turf.booleanPointInPolygon(pt, zf)) {
          const name = zf.properties['용도지역명']
          if (name && !name.startsWith('기타')) return name
        }
      } catch { /* skip */ }
    }
    return null
  }, [feature, zoningData])

  const maxFar = zoning ? getMaxFAR(zoning) : null
  const farUtil = (p.vlRat > 0 && maxFar) ? Math.round(p.vlRat / maxFar * 100) : null

  return (
    <div className="g-detail-card">
      {/* 헤더 */}
      <div className="g-detail-header">
        <div>
          {p.bldNm && <h2 className="g-detail-name">{p.bldNm}</h2>}
          <p className="g-detail-address">{p.address}</p>
        </div>
        <button className="g-selected-close" onClick={onClose}>✕</button>
      </div>

      {/* 핵심 수치 */}
      <div className="g-detail-stats">
        <div className="g-detail-stat-main">
          <span className="g-detail-stat-value" style={{ color: getVlRatColor(p.vlRat) }}>
            {p.vlRat > 0 ? `${p.vlRat}%` : '—'}
          </span>
          <span className="g-detail-stat-label">용적률</span>
        </div>
        <div className="g-detail-stat-main">
          <span className="g-detail-stat-value">{p.bcRat > 0 ? `${p.bcRat}%` : '—'}</span>
          <span className="g-detail-stat-label">건폐율</span>
        </div>
        <div className="g-detail-stat-main">
          <span className="g-detail-stat-value">{p.grndFlrCnt > 0 ? `${p.grndFlrCnt}층` : '—'}</span>
          <span className="g-detail-stat-label">지상 층수</span>
        </div>
      </div>

      {/* 상세 정보 */}
      <div className="g-detail-section">
        <div className="g-sub-title">건물 정보</div>
        <div className="g-detail-rows">
          <DetailRow label="주용도" value={p.mainPurps || '—'} />
          <DetailRow label="구조" value={p.strct || '—'} />
          <DetailRow label="지하 층수" value={p.ugrndFlrCnt > 0 ? `${p.ugrndFlrCnt}층` : '—'} />
          <DetailRow label="사용승인일" value={p.useAprDay || '—'} />
          {age && <DetailRow label="건물 연령" value={`${age}년`} />}
        </div>
      </div>

      {/* 면적 정보 */}
      <div className="g-detail-section">
        <div className="g-sub-title">면적</div>
        <div className="g-detail-rows">
          <DetailRow label="연면적" value={p.totArea > 0 ? `${p.totArea.toLocaleString()}㎡` : '—'} />
          <DetailRow label="대지면적" value={p.platArea > 0 ? `${p.platArea.toLocaleString()}㎡` : '—'} />
          {footprint && <DetailRow label="바닥면적 (폴리곤)" value={`${footprint.toLocaleString()}㎡`} />}
        </div>
      </div>

      {/* 용도지역 */}
      {zoning && (
        <div className="g-detail-section">
          <div className="g-sub-title">용도지역</div>
          <div className="g-detail-zoning">
            <span className="g-detail-zoning-dot" style={{ background: getZoningColor(zoning) }} />
            <span className="g-detail-zoning-name">{zoning}</span>
            {maxFar && <span className="g-detail-zoning-far">허용 {maxFar}%</span>}
          </div>
          {farUtil !== null && (
            <div className="g-detail-far-util">
              <div className="g-detail-far-bar">
                <div className="g-detail-far-fill" style={{ width: `${Math.min(farUtil, 100)}%` }} />
              </div>
              <span className="g-detail-far-text">FAR 활용률 {farUtil}%</span>
            </div>
          )}
        </div>
      )}

      {/* 토지이음 버튼 */}
      <button className="g-eum-btn" onClick={onOpenEum}>
        🔗 토지이음에서 열람
      </button>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="g-detail-row">
      <span className="g-detail-row-label">{label}</span>
      <span className="g-detail-row-value">{value}</span>
    </div>
  )
}

// ─── 공통 ───────────────────────────────────────────────────────
function Stat({ label, value }) {
  return (
    <div className="g-stat">
      <div className="g-stat-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="g-stat-label">{label}</div>
    </div>
  )
}
