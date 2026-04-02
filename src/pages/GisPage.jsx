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
import 'leaflet/dist/leaflet.css'
import '../styles/gis.css'

const CENTER = [37.5636, 126.9976]
const BOUNDS = [[37.53, 126.95], [37.60, 127.04]]

// ─── 색상 ──────────────────────────────────────────────────────
function getVlRatColor(v) {
  if (!v || v <= 0) return '#ccc'
  if (v <= 100) return '#2166ac'
  if (v <= 300) return '#67a9cf'
  if (v <= 500) return '#ef8a62'
  return '#b2182b'
}

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
  const [loading, setLoading] = useState(true)
  const [clickedPoint, setClickedPoint] = useState(null)
  const [radius, setRadius] = useState(400)
  const [visibleSection, setVisibleSection] = useState('intensity')
  const [ageFilterYear, setAgeFilterYear] = useState(2025)
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
    ]).then(([buildings, transit, demo, commerce]) => {
      setBuildingData(buildings)
      setTransitData(transit)
      setDemoData(demo)
      setCommerceData(commerce)
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
    const center = turf.point([clickedPoint[1], clickedPoint[0]])
    return buildingData.features.filter(f => {
      const c = getCentroid(f)
      if (!c) return false
      return turf.distance(center, turf.point(c), { units: 'meters' }) <= radius
    })
  }, [buildingData, clickedPoint, radius])

  // 반경 내 대중교통 필터링
  const filteredTransit = useMemo(() => {
    if (!transitData || !clickedPoint) return { busStops: [], subwayLines: {} }
    const center = turf.point([clickedPoint[1], clickedPoint[0]])

    const busStops = transitData.busStops.filter(s =>
      turf.distance(center, turf.point([s.lng, s.lat]), { units: 'meters' }) <= radius
    )

    const subwayLines = {}
    for (const [line, info] of Object.entries(transitData.subwayLines)) {
      const stations = info.stations.filter(s =>
        turf.distance(center, turf.point([s.lng, s.lat]), { units: 'meters' }) <= radius
      )
      if (stations.length > 0) {
        subwayLines[line] = { color: info.color, stations }
      }
    }

    return { busStops, subwayLines }
  }, [transitData, clickedPoint, radius])

  // 반경 내 상권 필터링
  const filteredCommerce = useMemo(() => {
    if (!commerceData || !clickedPoint) return []
    const center = turf.point([clickedPoint[1], clickedPoint[0]])
    return commerceData.areas.filter(a =>
      turf.distance(center, turf.point([a.lng, a.lat]), { units: 'meters' }) <= radius
    )
  }, [commerceData, clickedPoint, radius])

  // 반경 내 인구 점 필터링
  const filteredDots = useMemo(() => {
    if (!demoData || !clickedPoint) return []
    const center = turf.point([clickedPoint[1], clickedPoint[0]])
    return demoData.dots.filter(d =>
      turf.distance(center, turf.point([d.lng, d.lat]), { units: 'meters' }) <= radius
    )
  }, [demoData, clickedPoint, radius])

  // 반경 내 건물 PNU Set
  const filteredSet = useMemo(() => {
    return new Set(filtered.map(f => f.properties.pnu))
  }, [filtered])

  // 원 밖 건물 스타일
  const OUTSIDE_STYLE = { fillColor: '#ddd', fillOpacity: 0.35, weight: 0.2, color: 'rgba(0,0,0,0.04)' }

  // 지도 스타일 — visibleSection + 원 안/밖 구분
  const buildingStyle = useCallback((feature) => {
    const inside = !clickedPoint || filteredSet.has(feature.properties.pnu)

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
      return { fillColor: getVlRatColor(feature.properties.vlRat), fillOpacity: 0.75, weight: 0.3, color: 'rgba(0,0,0,0.08)' }
    }
    if (visibleSection === 'transit' || visibleSection === 'demo' || visibleSection === 'commerce') {
      return { fillColor: '#e8e8e8', fillOpacity: 0.4, weight: 0.2, color: 'rgba(0,0,0,0.03)' }
    }
    return { fillColor: '#bbb', fillOpacity: 0.5, weight: 0.3, color: 'rgba(0,0,0,0.06)' }
  }, [visibleSection, clickedPoint, filteredSet, ageFilterYear])

  const onEachBuilding = useCallback((feature, layer) => {
    layer.on({
      mouseover: e => { e.target.setStyle({ weight: 1.5, color: '#333', fillOpacity: 0.95 }); e.target.bringToFront() },
      mouseout: e => { if (geoRef.current) geoRef.current.resetStyle(e.target) },
    })
  }, [])

  const tileUrl = visibleSection === 'figground'
    ? 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

  return (
    <div className="gis-page">
      <Nav />
      <div className="gis-layout">
        {/* 사이드 패널 */}
        <aside className="g-panel" ref={panelRef}>
          {/* 헤더 */}
          <div className="g-header">
            <div className="g-header-badge">관설 Urban Analytics</div>
            <h1 className="g-header-title">서울 중구</h1>
            <p className="g-header-sub">도시 환경 분석 플랫폼</p>
          </div>

          {loading && <div className="g-empty">데이터 로딩 중...</div>}

          {!loading && !clickedPoint && (
            <div className="g-empty">
              <div className="g-empty-icon">⊕</div>
              <p>지도에서 분석할 위치를<br />클릭하세요</p>
            </div>
          )}

          {!loading && clickedPoint && (
            <div className="g-sections">

              {/* ── Pedestrian Shed 제목 (스크롤됨) ── */}
              <section data-section="pedshed" className="g-sec active g-sec-no-pad-bottom">
                <div className="g-sec-header">
                  <h2 className="g-sec-title">Pedestrian Shed</h2>
                  <p className="g-sec-desc">보행권역 · Catchment Area</p>
                </div>
              </section>

              {/* ── 슬라이더 (sticky 고정) ── */}
              <div className="g-sticky-controls">
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
              </div>

              <div className="g-section-divider" />

              {/* ── 2. Development Intensity ── */}
              <section data-section="intensity" className={visibleSection === 'intensity' ? 'g-sec active' : 'g-sec'}>
                <div className="g-sec-header">
                  <h2 className="g-sec-title">Development Intensity</h2>
                  <p className="g-sec-desc">개발강도 · 용적률 활용 현황</p>
                </div>
                <IntensityContent buildings={filtered} />
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
                <LandUseContent buildings={filtered} />
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
                <DemographicsContent dots={filteredDots} demoData={demoData} radius={radius} />
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

              <div style={{ height: '65vh' }} />
            </div>
          )}
        </aside>

        {/* 지도 */}
        <div className="g-map">
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
            <MapClick onClick={p => setClickedPoint(p)} />

            {buildingData && (
              <GeoJSON
                key={`${visibleSection}-${filteredSet.size}-${clickedPoint?.[0]}-${ageFilterYear}`}
                ref={geoRef}
                data={buildingData}
                style={buildingStyle}
                onEachFeature={onEachBuilding}
              />
            )}

            {clickedPoint && (
              <DraggableCenter
                position={clickedPoint}
                radius={radius}
                onMove={p => setClickedPoint(p)}
              />
            )}

            {visibleSection === 'commerce' && commerceData && clickedPoint && (
              <CommerceLayer commerceData={commerceData} filteredCommerce={filteredCommerce} />
            )}

            {visibleSection === 'demo' && demoData && clickedPoint && (
              <DemoLayer dots={filteredDots} />
            )}

            {visibleSection === 'transit' && transitData && clickedPoint && (
              <TransitLayer
                transitData={transitData}
                filteredTransit={filteredTransit}
                clickedPoint={clickedPoint}
                radius={radius}
              />
            )}
          </MapContainer>
        </div>
      </div>
    </div>
  )
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
function IntensityContent({ buildings }) {
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
function LandUseContent({ buildings }) {
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

  return (
    <>
      <div className="g-stats-row">
        <Stat label="건물 수" value={buildings.length} />
        <Stat label="용도 수" value={sorted.length} />
        <Stat label="Entropy" value={entropyScore} />
      </div>

      <div className="g-sub-title">용도별 분포</div>
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
    </>
  )
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

function DemoLayer({ dots }) {
  const map = useMap()
  const layerRef = useRef(null)

  useEffect(() => {
    if (layerRef.current) map.removeLayer(layerRef.current)

    const canvas = L.canvas({ padding: 0.5 })
    const group = L.layerGroup()

    for (const d of dots) {
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
  }, [map, dots])

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

function DemographicsContent({ dots, demoData, radius }) {
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

      <div className="g-sub-title">Age Distribution</div>
      <div className="g-bar-list">
        {ageData.map(d => (
          <div key={d.key} className="g-bar-item">
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

// ─── 공통 ───────────────────────────────────────────────────────
function Stat({ label, value }) {
  return (
    <div className="g-stat">
      <div className="g-stat-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="g-stat-label">{label}</div>
    </div>
  )
}
