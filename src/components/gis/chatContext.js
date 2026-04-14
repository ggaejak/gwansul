// 위치 데이터를 LLM 컨텍스트용 통계 요약 텍스트로 직렬화
// 원본 GeoJSON 배열 대신 집계 통계만 전달 (~2K 토큰)

import landmarksData from '../../gis/data/junggu-landmarks.json'

const AMENITY_LABELS = {
  FD6: '음식점', CE7: '카페', CT1: '문화시설',
  HP8: '의료시설', SC4: '교육시설', CS2: '편의점', PO3: '공공기관',
}

function getBuildYear(props) {
  const raw = props.useAprDay || props.pmsDay || ''
  const y = parseInt(String(raw).slice(0, 4), 10)
  return y > 1800 && y <= 2026 ? y : 0
}

function pct(value, total) {
  return total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
}

function topN(counts, n = 5) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

export function buildLocationContext({
  clickedPoint, radius, filtered, filteredTransit,
  filteredDots, filteredCommerce, filteredZoning, amenities,
}) {
  if (!clickedPoint) return ''
  const lines = []

  lines.push(`위치: ${clickedPoint[0].toFixed(4)}, ${clickedPoint[1].toFixed(4)} | 반경: ${radius}m`)
  lines.push('')

  // ── 건물 ──
  if (filtered && filtered.length > 0) {
    const total = filtered.length
    const withVl = filtered.filter(b => b.properties.vlRat > 0)
    const avgVl = withVl.length
      ? Math.round(withVl.reduce((s, b) => s + b.properties.vlRat, 0) / withVl.length)
      : 0
    const maxVl = withVl.length
      ? Math.round(Math.max(...withVl.map(b => b.properties.vlRat)))
      : 0

    const withFloors = filtered.filter(b => b.properties.grndFlrCnt > 0)
    const avgFloors = withFloors.length
      ? (withFloors.reduce((s, b) => s + b.properties.grndFlrCnt, 0) / withFloors.length).toFixed(1)
      : 0

    lines.push(`건물 (${total}동): 평균 용적률 ${avgVl}%, 최대 ${maxVl}%, 평균 층수 ${avgFloors}층`)

    // 용도 분포
    const purpCounts = {}
    for (const b of filtered) {
      const p = b.properties.mainPurps || '기타'
      purpCounts[p] = (purpCounts[p] || 0) + 1
    }
    const purpTop = topN(purpCounts, 5)
    if (purpTop.length > 0) {
      const purpStr = purpTop.map(([name, count]) => `${name} ${pct(count, total)}%`).join(', ')
      lines.push(`용도: ${purpStr}`)
    }

    // 건물 연령
    const withYear = filtered.filter(b => getBuildYear(b.properties) > 0)
    if (withYear.length > 0) {
      const years = withYear.map(b => getBuildYear(b.properties))
      const avgAge = Math.round(years.reduce((s, y) => s + (2026 - y), 0) / years.length)
      const oldest = Math.min(...years)
      const newest = Math.max(...years)
      lines.push(`건물연령: 평균 ${avgAge}년, 최고령 ${oldest}년 준공, 최신 ${newest}년 준공`)
    }

    // 결측 현황
    const missingVl = filtered.filter(b => !b.properties.vlRat || b.properties.vlRat === 0).length
    const missingFloor = filtered.filter(b => !b.properties.grndFlrCnt || b.properties.grndFlrCnt === 0).length
    if (missingVl > 0 || missingFloor > 0) {
      lines.push(`결측: 용적률 ${pct(missingVl, total)}%, 층수 ${pct(missingFloor, total)}%`)
    }

    lines.push('')
  }

  // ── 용도지역 ──
  if (filteredZoning && filteredZoning.length > 0) {
    const zoningAgg = {}
    for (const f of filteredZoning) {
      const name = f.properties['용도지역명'] || '기타'
      if (name.startsWith('기타')) continue
      const area = parseFloat(f.properties.DGM_AR) || 0
      zoningAgg[name] = (zoningAgg[name] || 0) + area
    }
    const totalArea = Object.values(zoningAgg).reduce((s, v) => s + v, 0)
    const zoningTop = topN(zoningAgg, 5)
    if (zoningTop.length > 0) {
      const zoningStr = zoningTop.map(([name, area]) => `${name} ${pct(area, totalArea)}%`).join(', ')
      lines.push(`용도지역: ${zoningStr}`)
      lines.push('')
    }
  }

  // ── 교통 ──
  if (filteredTransit) {
    const parts = []
    const busCount = filteredTransit.busStops?.length || 0
    if (busCount > 0) parts.push(`버스정류장 ${busCount}개`)

    const subwayLines = filteredTransit.subwayLines || {}
    const subwayParts = []
    for (const [line, info] of Object.entries(subwayLines)) {
      const stationNames = info.stations.map(s => s.name).join(', ')
      subwayParts.push(`${line}: ${stationNames}`)
    }
    if (subwayParts.length > 0) parts.push(`지하철 (${subwayParts.join(' / ')})`)

    if (parts.length > 0) {
      lines.push(`교통: ${parts.join(', ')}`)
      lines.push('')
    }
  }

  // ── 인구 ──
  if (filteredDots && filteredDots.length > 0) {
    let total = 0, age0 = 0, age20 = 0, age40 = 0, age60 = 0
    for (const d of filteredDots) {
      const sum = (d.age_0_19 || 0) + (d.age_20_39 || 0) + (d.age_40_59 || 0) + (d.age_60_plus || 0)
      total += sum
      age0 += d.age_0_19 || 0
      age20 += d.age_20_39 || 0
      age40 += d.age_40_59 || 0
      age60 += d.age_60_plus || 0
    }
    if (total > 0) {
      lines.push(`인구: 약 ${total.toLocaleString()}명 (0-19세 ${pct(age0, total)}%, 20-39세 ${pct(age20, total)}%, 40-59세 ${pct(age40, total)}%, 60세+ ${pct(age60, total)}%)`)
      lines.push('')
    }
  }

  // ── 상권 ──
  if (filteredCommerce && filteredCommerce.length > 0) {
    const totalStores = filteredCommerce.reduce((s, a) => s + a.stores, 0)
    const totalSales = filteredCommerce.reduce((s, a) => s + a.salesTotal, 0)
    const closeRate = totalStores > 0
      ? ((filteredCommerce.reduce((s, a) => s + a.closeStores, 0) / totalStores) * 100).toFixed(1)
      : 0

    let salesStr = ''
    if (totalSales > 0) {
      salesStr = `, 총매출 ${(totalSales / 100000000).toFixed(1)}억원`
    }

    lines.push(`상권: ${filteredCommerce.length}개 상권, 점포 ${totalStores.toLocaleString()}개${salesStr}, 폐업률 ${closeRate}%`)

    // 업종 분포
    const catCounts = {}
    for (const a of filteredCommerce) {
      for (const [cat, count] of a.topCategories) {
        catCounts[cat] = (catCounts[cat] || 0) + count
      }
    }
    const catTop = topN(catCounts, 5)
    if (catTop.length > 0) {
      const totalCat = Object.values(catCounts).reduce((s, v) => s + v, 0)
      const catStr = catTop.map(([name, count]) => `${name} ${pct(count, totalCat)}%`).join(', ')
      lines.push(`업종: ${catStr}`)
    }
    lines.push('')
  }

  // ── 편의시설 ──
  if (amenities && Object.keys(amenities).length > 0) {
    const amenityParts = []
    for (const [code, places] of Object.entries(amenities)) {
      if (places.length > 0) {
        amenityParts.push(`${AMENITY_LABELS[code] || code} ${places.length}`)
      }
    }
    if (amenityParts.length > 0) {
      lines.push(`편의시설: ${amenityParts.join(', ')}`)
    }
  }

  // ── 역사적 맥락 ──
  const [lng, lat] = clickedPoint
  const R = 6371000 // 지구 반지름 (m)
  const nearbyLandmarks = landmarksData.landmarks.filter(lm => {
    const dLat = (lm.lat - lat) * Math.PI / 180
    const dLng = (lm.lng - lng) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(lm.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    lm._dist = Math.round(dist)
    return dist <= 1500
  }).sort((a, b) => a._dist - b._dist)

  if (nearbyLandmarks.length > 0) {
    lines.push('')
    lines.push('역사적 맥락 (반경 1.5km 내 랜드마크):')
    for (const lm of nearbyLandmarks.slice(0, 5)) {
      const yearStr = lm.originalYear && lm.originalYear !== lm.year
        ? `${lm.originalYear}년 원축·${lm.year}년 현재`
        : `${lm.year}년`
      lines.push(`- ${lm.name} (${lm._dist}m, ${lm.category}, ${yearStr}): ${lm.significance}`)
    }
  }

  return lines.join('\n')
}
