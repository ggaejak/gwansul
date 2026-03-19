import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  MapContainer, TileLayer, useMapEvents,
  GeoJSON, CircleMarker, Popup, ZoomControl
} from 'react-leaflet'
import * as turf from '@turf/turf'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend
} from 'recharts'
import Nav from '../components/Nav'
import 'leaflet/dist/leaflet.css'
import '../styles/gis.css'

// ─── 서울 중구 ──────────────────────────────────────────────────
const CENTER     = [37.5636, 126.9975]
const JUNG_GU_BOUNDS = [[37.5417, 126.9574], [37.5868, 127.0302]]

const RADIUS_OPTIONS = [
  { label: '5분', value: 400,  walk: '05:00' },
  { label: '10분', value: 800, walk: '10:00' },
]

// ─── 6 레이어 ───────────────────────────────────────────────────
const LAYERS = [
  { id: 'pedshed',    num: '01', label: '도보권',      sub: '이동 가능 영역',   color: '#5eead4' },
  { id: 'figground',  num: '02', label: '피겨그라운드', sub: '건물 · 공지 분포', color: '#e2e8f0' },
  { id: 'landuse',    num: '03', label: '토지 이용',   sub: '기능별 면적 분포', color: '#86efac' },
  { id: 'transit',    num: '04', label: '대중교통',    sub: '지하철 · 버스',    color: '#a5b4fc' },
  { id: 'demo',       num: '05', label: '인구통계',    sub: '인구 · 연령 구성', color: '#fca5a5' },
  { id: 'intensity',  num: '06', label: '개발강도',    sub: '층수 · 밀도',      color: '#fde68a' },
]

const CHART_COLORS = ['#5eead4','#a5b4fc','#fb923c','#86efac','#f472b6','#fbbf24','#60a5fa','#e879f9']

// ─── 서울 중구 통계 (2023 기준) ────────────────────────────────
const JUNG_GU_STATS = {
  population: 124157,
  areaSqKm: 9.96,
  density: 12466,
  ageGroups: [
    { label: '0–14세',  value: 9.2  },
    { label: '15–29세', value: 16.8 },
    { label: '30–44세', value: 21.3 },
    { label: '45–59세', value: 22.4 },
    { label: '60–74세', value: 18.1 },
    { label: '75세+',   value: 12.2 },
  ],
  foreignerRatio: 10.6,
  foreigners: 13200,
}

// ─── 토지이용 색상 ──────────────────────────────────────────────
const LANDUSE_COLOR = {
  residential:       '#fb923c',
  commercial:        '#60a5fa',
  retail:            '#a78bfa',
  industrial:        '#f87171',
  park:              '#4ade80',
  green:             '#86efac',
  cemetery:          '#94a3b8',
  education:         '#fde68a',
  religious:         '#e879f9',
  recreation_ground: '#34d399',
}
function getLandUseColor(type) {
  return LANDUSE_COLOR[type] || '#888'
}

// ─── 층수 → 색상 ────────────────────────────────────────────────
function getHeightColor(levels) {
  const n = parseInt(levels) || 1
  if (n <= 2)  return '#fde68a'
  if (n <= 5)  return '#fb923c'
  if (n <= 10) return '#f97316'
  return '#dc2626'
}

// ─── Overpass ──────────────────────────────────────────────────
const OVERPASS = 'https://overpass-api.de/api/interpreter'
async function fetchOverpass(query) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  })
  if (!res.ok) throw new Error(`Overpass ${res.status}`)
  return res.json()
}

// OSM way + geometry → GeoJSON FeatureCollection
function osmToGeoJSON(elements) {
  const features = elements
    .filter(el => el.type === 'way' && el.geometry?.length >= 3)
    .map(el => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [el.geometry.map(p => [p.lon, p.lat])],
      },
      properties: el.tags || {},
    }))
  return { type: 'FeatureCollection', features }
}

// ─── Shannon 엔트로피 ──────────────────────────────────────────
function entropy(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (!total) return 0
  const H = Object.values(counts).reduce((h, c) => {
    if (!c) return h
    const p = c / total
    return h - p * Math.log(p)
  }, 0)
  const maxH = Math.log(Math.max(Object.keys(counts).length, 1))
  return maxH ? +(H / maxH).toFixed(2) : 0
}

// ─── 도보권 버퍼 ───────────────────────────────────────────────
function buildShed(lat, lng, radiusM) {
  return turf.buffer(turf.point([lng, lat]), radiusM / 1000, { units: 'kilometers', steps: 72 })
}

// ─── 레이어별 분석 ────────────────────────────────────────────
async function analyzePedshed(lat, lng, radius) {
  const shed = buildShed(lat, lng, radius)
  return { areaSqm: turf.area(shed) }
}

async function analyzeFigGround(lat, lng, radius) {
  const q = `[out:json][timeout:25];way["building"](around:${radius},${lat},${lng});out geom;`
  const data = await fetchOverpass(q)
  const elements = data.elements || []
  const geoJSON = osmToGeoJSON(elements)
  const shed = buildShed(lat, lng, radius)
  const shedArea = turf.area(shed)
  const builtArea = geoJSON.features.reduce((sum, f) => sum + turf.area(f), 0)
  const solidRatio = Math.min(1, builtArea / shedArea)
  return { geoJSON, count: elements.length, solidRatio, voidRatio: 1 - solidRatio, builtArea }
}

async function analyzeLanduse(lat, lng, radius) {
  const q = `[out:json][timeout:25];way["landuse"](around:${radius},${lat},${lng});out geom;`
  const data = await fetchOverpass(q)
  const elements = data.elements || []
  const geoJSON = osmToGeoJSON(elements)
  const counts = {}
  elements.forEach(el => {
    const t = el.tags?.landuse || 'other'
    counts[t] = (counts[t] || 0) + 1
  })
  const entropyScore = entropy(counts)
  const breakdown = Object.entries(counts)
    .map(([type, value]) => ({ name: mapLanduse(type), value, type }))
    .sort((a, b) => b.value - a.value)
  return { geoJSON, breakdown, entropyScore, total: elements.length }
}

async function analyzeTransit(lat, lng, radius) {
  const q = `[out:json][timeout:20];
(
  node["railway"="station"](around:${radius},${lat},${lng});
  node["railway"="subway_entrance"](around:${radius},${lat},${lng});
  node["highway"="bus_stop"](around:${radius},${lat},${lng});
);out body;`
  const data = await fetchOverpass(q)
  const nodes = data.elements || []
  const subway = nodes.filter(n => n.tags?.railway === 'station' || n.tags?.railway === 'subway_entrance')
  const bus    = nodes.filter(n => n.tags?.highway === 'bus_stop')
  return { nodes, subway, bus, total: nodes.length }
}

async function analyzeDemo(lat, lng, radius) {
  // 서울 중구 전체 통계 + 반경 내 추정
  const shed = buildShed(lat, lng, radius)
  const shedArea = turf.area(shed) / 1_000_000 // km²
  const ratio = shedArea / JUNG_GU_STATS.areaSqKm
  return {
    ...JUNG_GU_STATS,
    estimatedPop: Math.round(JUNG_GU_STATS.population * Math.min(1, ratio * 1.2)),
    shedAreaSqKm: +shedArea.toFixed(3),
  }
}

async function analyzeIntensity(lat, lng, radius) {
  const q = `[out:json][timeout:25];way["building"](around:${radius},${lat},${lng});out tags geom;`
  const data = await fetchOverpass(q)
  const elements = data.elements || []
  const geoJSON = {
    type: 'FeatureCollection',
    features: elements
      .filter(el => el.type === 'way' && el.geometry?.length >= 3)
      .map(el => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [el.geometry.map(p => [p.lon, p.lat])] },
        properties: { levels: parseInt(el.tags?.['building:levels']) || 1, ...el.tags },
      })),
  }
  const buckets = { '1–2층': 0, '3–5층': 0, '6–10층': 0, '11층+': 0 }
  elements.forEach(el => {
    const n = parseInt(el.tags?.['building:levels']) || 1
    if (n <= 2) buckets['1–2층']++
    else if (n <= 5) buckets['3–5층']++
    else if (n <= 10) buckets['6–10층']++
    else buckets['11층+']++
  })
  const highrise = elements.filter(el => (parseInt(el.tags?.['building:levels']) || 1) > 5).length
  const breakdown = Object.entries(buckets).map(([name, value]) => ({ name, value }))
  return { geoJSON, breakdown, total: elements.length, highRiseRatio: elements.length ? highrise / elements.length : 0 }
}

// ─── 분류 매핑 ─────────────────────────────────────────────────
const LANDUSE_LABELS = {
  residential:'주거', commercial:'상업', retail:'판매', industrial:'산업',
  park:'공원', green:'녹지', cemetery:'묘지', education:'교육',
  religious:'종교', recreation_ground:'여가', military:'군사',
}
function mapLanduse(raw) { return LANDUSE_LABELS[raw] || raw }

// ─── 지도 클릭 핸들러 ──────────────────────────────────────────
function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: e => onMapClick(e.latlng.lat, e.latlng.lng) })
  return null
}

// ─── 툴팁 ─────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 6, padding: '0.45rem 0.7rem', fontSize: 12, color: '#fff',
    }}>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{payload[0].value}{payload[0].unit || ''}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  메인 컴포넌트
// ═══════════════════════════════════════════════════════════════
export default function GisPage() {
  const [activeLayer, setActiveLayer]   = useState('pedshed')
  const [radius, setRadius]             = useState(400)
  const [clickedPoint, setClickedPoint] = useState(null)
  const [shedGeoJSON, setShedGeoJSON]   = useState(null)
  const [mapOverlay, setMapOverlay]     = useState(null)   // GeoJSON on map
  const [transitNodes, setTransitNodes] = useState([])
  const [analysisData, setAnalysisData] = useState(null)
  const [isLoading, setIsLoading]       = useState(false)

  useEffect(() => {
    document.documentElement.classList.add('gis-mode')
    return () => document.documentElement.classList.remove('gis-mode')
  }, [])

  const layerConfig = LAYERS.find(l => l.id === activeLayer)

  const runAnalysis = useCallback(async (lat, lng, layer, r) => {
    setIsLoading(true)
    setAnalysisData(null)
    setMapOverlay(null)
    setTransitNodes([])
    setShedGeoJSON(buildShed(lat, lng, r))

    try {
      let data = null
      switch (layer) {
        case 'pedshed': {
          data = await analyzePedshed(lat, lng, r)
          break
        }
        case 'figground': {
          data = await analyzeFigGround(lat, lng, r)
          setMapOverlay(data.geoJSON)
          break
        }
        case 'landuse': {
          data = await analyzeLanduse(lat, lng, r)
          setMapOverlay(data.geoJSON)
          break
        }
        case 'transit': {
          data = await analyzeTransit(lat, lng, r)
          setTransitNodes(data.nodes)
          break
        }
        case 'demo': {
          data = await analyzeDemo(lat, lng, r)
          break
        }
        case 'intensity': {
          data = await analyzeIntensity(lat, lng, r)
          setMapOverlay(data.geoJSON)
          break
        }
      }
      setAnalysisData(data)
    } catch (err) {
      console.error(err)
      setAnalysisData({ error: '데이터를 불러오지 못했습니다.' })
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleMapClick = useCallback((lat, lng) => {
    setClickedPoint({ lat, lng })
    runAnalysis(lat, lng, activeLayer, radius)
  }, [activeLayer, radius, runAnalysis])

  const handleLayerChange = useCallback((id) => {
    setActiveLayer(id)
    if (clickedPoint) runAnalysis(clickedPoint.lat, clickedPoint.lng, id, radius)
  }, [clickedPoint, radius, runAnalysis])

  const handleRadiusChange = useCallback((r) => {
    setRadius(r)
    if (clickedPoint) runAnalysis(clickedPoint.lat, clickedPoint.lng, activeLayer, r)
  }, [clickedPoint, activeLayer, runAnalysis])

  // GeoJSON 스타일 함수
  const getOverlayStyle = useCallback((feature) => {
    if (activeLayer === 'figground') {
      return { color: 'rgba(255,255,255,0.25)', fillColor: 'rgba(226,232,240,0.18)', fillOpacity: 1, weight: 0.5 }
    }
    if (activeLayer === 'landuse') {
      const c = getLandUseColor(feature.properties.landuse)
      return { color: c, fillColor: c, fillOpacity: 0.35, weight: 0.5 }
    }
    if (activeLayer === 'intensity') {
      const c = getHeightColor(feature.properties.levels)
      return { color: c, fillColor: c, fillOpacity: 0.45, weight: 0.5 }
    }
    return {}
  }, [activeLayer])

  const overlayKey = `${activeLayer}-${clickedPoint?.lat}-${clickedPoint?.lng}-${radius}`

  return (
    <div className="gis-page">
      <Nav />

      <div className="gis-container">

        {/* ── 사이드 패널 ── */}
        <aside className="gis-panel">

          {/* 헤더 */}
          <div className="panel-header">
            <div className="panel-badge">Urban Analytics · Beta</div>
            <div className="panel-title">서울 중구</div>
            <div className="panel-subtitle">도시 환경 분석 플랫폼</div>
          </div>

          {/* 레이어 목록 */}
          <div className="layer-list">
            {LAYERS.map(l => (
              <button
                key={l.id}
                className={`layer-item${activeLayer === l.id ? ' active' : ''}`}
                style={{ '--accent': l.color }}
                onClick={() => handleLayerChange(l.id)}
              >
                <span className="layer-num">{l.num}</span>
                <div className="layer-info">
                  <span className="layer-label">{l.label}</span>
                  <span className="layer-sub">{l.sub}</span>
                </div>
                <div className="layer-dot" />
              </button>
            ))}
          </div>

          {/* 반경 선택 */}
          <div className="radius-selector">
            <span className="radius-label">분석 반경</span>
            <div className="radius-options">
              {RADIUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`radius-btn${radius === opt.value ? ' active' : ''}`}
                  style={radius === opt.value ? { '--accent': layerConfig.color } : {}}
                  onClick={() => handleRadiusChange(opt.value)}
                >
                  <span>{opt.value}m</span>
                  <span className="radius-walk">도보 {opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 분석 영역 */}
          <div className="analysis-area">
            {!clickedPoint && !isLoading && (
              <div className="analysis-hint">
                <span className="hint-icon">◎</span>
                <p>지도에서 분석할 위치를<br />클릭하세요</p>
              </div>
            )}

            {isLoading && (
              <div className="analysis-loading">
                <div className="loading-spinner" style={{ borderTopColor: layerConfig.color }} />
                <p>분석 중...</p>
              </div>
            )}

            {!isLoading && analysisData && (
              <AnalysisResult
                layer={activeLayer}
                data={analysisData}
                color={layerConfig.color}
                radius={radius}
              />
            )}
          </div>
        </aside>

        {/* ── 지도 ── */}
        <div className="gis-map">
          <MapContainer
            center={CENTER}
            zoom={15}
            minZoom={14}
            maxZoom={18}
            maxBounds={JUNG_GU_BOUNDS}
            maxBoundsViscosity={1.0}
            zoomControl={false}
            style={{ width: '100%', height: '100%' }}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
              subdomains="abcd"
              bounds={JUNG_GU_BOUNDS}
              maxZoom={18}
            />
            <ZoomControl position="bottomright" />
            <MapClickHandler onMapClick={handleMapClick} />

            {/* 도보권 버퍼 */}
            {shedGeoJSON && (
              <GeoJSON
                key={`shed-${overlayKey}`}
                data={shedGeoJSON}
                style={{
                  color: layerConfig.color,
                  fillColor: layerConfig.color,
                  fillOpacity: 0.08,
                  weight: 1.5,
                  dashArray: '5 5',
                }}
              />
            )}

            {/* 레이어별 지도 오버레이 (건물·토지) */}
            {mapOverlay && (
              <GeoJSON
                key={`overlay-${overlayKey}`}
                data={mapOverlay}
                style={getOverlayStyle}
              />
            )}

            {/* 대중교통 노드 */}
            {transitNodes.map((node, i) => {
              const isSubway = node.tags?.railway === 'station' || node.tags?.railway === 'subway_entrance'
              return (
                <CircleMarker
                  key={node.id || i}
                  center={[node.lat, node.lon]}
                  radius={isSubway ? 6 : 3}
                  pathOptions={{
                    color: isSubway ? '#818cf8' : '#a78bfa',
                    fillColor: isSubway ? '#818cf8' : '#c4b5fd',
                    fillOpacity: isSubway ? 0.9 : 0.7,
                    weight: isSubway ? 2 : 1,
                  }}
                >
                  <Popup>
                    <span style={{ fontSize: 12 }}>
                      {node.tags?.name || (isSubway ? '지하철역' : '버스 정류장')}
                    </span>
                  </Popup>
                </CircleMarker>
              )
            })}

            {/* 클릭 포인트 */}
            {clickedPoint && (
              <CircleMarker
                center={[clickedPoint.lat, clickedPoint.lng]}
                radius={5}
                pathOptions={{
                  color: '#fff',
                  fillColor: layerConfig.color,
                  fillOpacity: 1,
                  weight: 2,
                }}
              />
            )}
          </MapContainer>

          {!clickedPoint && (
            <div className="map-hint">지도를 클릭하면 분석이 시작됩니다</div>
          )}

          {clickedPoint && (
            <div className="coords-display">
              {clickedPoint.lat.toFixed(5)}°N &nbsp;{clickedPoint.lng.toFixed(5)}°E
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  분석 결과 컴포넌트
// ═══════════════════════════════════════════════════════════════
function AnalysisResult({ layer, data, color, radius }) {
  if (data.error) return <div className="analysis-error">{data.error}</div>
  switch (layer) {
    case 'pedshed':   return <PedshedResult   data={data} color={color} radius={radius} />
    case 'figground': return <FigGroundResult data={data} color={color} />
    case 'landuse':   return <LandUseResult   data={data} color={color} />
    case 'transit':   return <TransitResult   data={data} color={color} />
    case 'demo':      return <DemoResult      data={data} color={color} />
    case 'intensity': return <IntensityResult data={data} color={color} />
    default:          return null
  }
}

// ── 01 도보권 ──────────────────────────────────────────────────
function PedshedResult({ data, color, radius }) {
  const ha = (data.areaSqm / 10000).toFixed(1)
  const walkMin = radius === 400 ? '5분' : '10분'
  return (
    <div className="result-card">
      <div className="result-heading">도보권 분석</div>
      <div className="result-metric">
        <span className="metric-value" style={{ color }}>{ha}</span>
        <span className="metric-unit">ha</span>
        <div className="metric-label">도보 {walkMin} 권역 면적</div>
      </div>
      <div className="result-divider" />
      <div className="result-rings">
        {[radius * 0.25, radius * 0.5, radius * 0.75, radius].map((r, i) => (
          <div key={r} className="ring-row">
            <div className="ring-bar">
              <div
                className="ring-fill"
                style={{ width: `${(i + 1) * 25}%`, background: color, opacity: 0.3 + i * 0.2 }}
              />
            </div>
            <span className="ring-label">{Math.round(r)}m</span>
          </div>
        ))}
      </div>
      <div className="result-note">도보 속도 80m/분 기준 · 직선거리 근사</div>
    </div>
  )
}

// ── 02 피겨그라운드 ────────────────────────────────────────────
function FigGroundResult({ data, color }) {
  const solidPct = (data.solidRatio * 100).toFixed(1)
  const voidPct  = (data.voidRatio  * 100).toFixed(1)
  const pieData  = [
    { name: '건물 (Solid)', value: +solidPct },
    { name: '공지 (Void)',  value: +voidPct  },
  ]
  return (
    <div className="result-card">
      <div className="result-heading">피겨그라운드</div>
      <div className="result-metric">
        <span className="metric-value" style={{ color }}>{data.count}</span>
        <span className="metric-unit">동</span>
        <div className="metric-label">반경 내 건물 수</div>
      </div>
      <div className="result-divider" />
      <div className="solid-void">
        <div className="sv-bar">
          <div className="sv-solid" style={{ width: `${solidPct}%`, background: color }} />
        </div>
        <div className="sv-labels">
          <span style={{ color }}>Solid {solidPct}%</span>
          <span className="sv-void-label">Void {voidPct}%</span>
        </div>
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={130}>
          <PieChart>
            <Pie
              data={pieData}
              cx="50%" cy="50%"
              innerRadius={35} outerRadius={55}
              dataKey="value"
              paddingAngle={2}
            >
              <Cell fill={color} />
              <Cell fill="rgba(255,255,255,0.08)" />
            </Pie>
            <Tooltip content={<ChartTooltip />} />
            <Legend
              iconSize={8}
              formatter={(v) => <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>{v}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="result-note">OSM 건물 데이터 기준</div>
    </div>
  )
}

// ── 03 토지이용 ────────────────────────────────────────────────
function LandUseResult({ data, color }) {
  if (!data.total) return (
    <div className="result-card">
      <div className="result-heading">토지 이용</div>
      <div className="result-empty">해당 반경 내 데이터 없음</div>
    </div>
  )
  return (
    <div className="result-card">
      <div className="result-heading">토지 이용</div>
      <div className="result-metric">
        <span className="metric-value" style={{ color }}>{data.entropyScore}</span>
        <span className="metric-unit">/ 1.0</span>
        <div className="metric-label">토지 이용 다양성 (엔트로피)</div>
      </div>
      <div className="result-divider" />
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={Math.max(100, data.breakdown.length * 26)}>
          <BarChart
            data={data.breakdown.slice(0, 7)}
            layout="vertical"
            margin={{ top: 0, right: 24, left: 44, bottom: 0 }}
          >
            <XAxis type="number" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="value" radius={[0, 3, 3, 0]}>
              {data.breakdown.slice(0, 7).map((d, i) => (
                <Cell key={i} fill={getLandUseColor(d.type)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="result-note">총 {data.total}개 구역 · OSM 데이터</div>
    </div>
  )
}

// ── 04 대중교통 ────────────────────────────────────────────────
function TransitResult({ data, color }) {
  const chartData = [
    { name: '지하철', value: data.subway?.length || 0 },
    { name: '버스',   value: data.bus?.length    || 0 },
  ]
  const scoreRaw = Math.min(100, (data.subway?.length || 0) * 25 + (data.bus?.length || 0) * 3)
  const stations = data.subway
    ?.filter(n => n.tags?.railway === 'station')
    .filter((n, i, arr) => arr.findIndex(x => x.tags?.name === n.tags?.name) === i)
    .slice(0, 5) || []

  return (
    <div className="result-card">
      <div className="result-heading">대중교통</div>
      <div className="result-metric">
        <span className="metric-value" style={{ color }}>{data.total || 0}</span>
        <span className="metric-unit">개소</span>
        <div className="metric-label">반경 내 교통시설</div>
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={90}>
          <BarChart data={chartData} margin={{ top: 0, right: 8, left: -24, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {stations.length > 0 && (
        <>
          <div className="result-divider" />
          <div className="transit-list">
            {stations.map((s, i) => (
              <div key={i} className="transit-item">
                <div className="transit-dot" style={{ background: color }} />
                <span className="transit-name">{s.tags?.name || '지하철역'}</span>
                <span className="transit-type">지하철</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="result-divider" />
      <div className="score-section">
        <div className="score-label">교통 접근성 점수</div>
        <div className="score-bar">
          <div className="score-fill" style={{ width: `${scoreRaw}%`, background: color }} />
        </div>
      </div>
    </div>
  )
}

// ── 05 인구통계 ────────────────────────────────────────────────
function DemoResult({ data, color }) {
  return (
    <div className="result-card">
      <div className="result-heading">인구통계 <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'rgba(255,255,255,0.2)' }}>서울 중구 기준</span></div>
      <div className="result-metric">
        <span className="metric-value" style={{ color }}>{data.estimatedPop.toLocaleString()}</span>
        <span className="metric-unit">명</span>
        <div className="metric-label">반경 내 추정 인구</div>
      </div>
      <div className="demo-row">
        <div className="demo-stat">
          <div className="demo-value">{data.density.toLocaleString()}</div>
          <div className="demo-label">인구밀도 (명/km²)</div>
        </div>
        <div className="demo-stat">
          <div className="demo-value">{data.foreignerRatio}%</div>
          <div className="demo-label">외국인 비율</div>
        </div>
      </div>
      <div className="result-divider" />
      <div className="result-sub-heading">연령 분포</div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={120}>
          <BarChart
            data={data.ageGroups}
            margin={{ top: 0, right: 8, left: -28, bottom: 0 }}
          >
            <XAxis dataKey="label" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 9 }} axisLine={false} tickLine={false} unit="%" />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="result-note">2023 서울특별시 통계 · 반경 내 추정치</div>
    </div>
  )
}

// ── 06 개발강도 ────────────────────────────────────────────────
function IntensityResult({ data, color }) {
  const highPct = data.total ? (data.highRiseRatio * 100).toFixed(0) : 0
  return (
    <div className="result-card">
      <div className="result-heading">개발강도</div>
      <div className="result-metric">
        <span className="metric-value" style={{ color }}>{data.total}</span>
        <span className="metric-unit">동</span>
        <div className="metric-label">반경 내 건물 수</div>
      </div>
      <div className="result-divider" />
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height={110}>
          <BarChart data={data.breakdown} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="value" radius={[3, 3, 0, 0]}>
              {data.breakdown.map((_, i) => (
                <Cell key={i} fill={['#fde68a','#fb923c','#f97316','#dc2626'][i]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="result-divider" />
      <div className="score-section">
        <div className="score-label">고층 비율 (6층+) · {highPct}%</div>
        <div className="score-bar">
          <div className="score-fill" style={{ width: `${highPct}%`, background: color }} />
        </div>
      </div>
      <div className="result-note">OSM building:levels 태그 기준</div>
    </div>
  )
}
