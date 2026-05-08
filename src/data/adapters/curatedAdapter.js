// fetch_curated_buildings / fetch_curated_roads / fetch_curated_points RPC 행 →
// GeoJSON Feature 형상 변환.
//
// curated_buildings 는 buildings 와 LEFT JOIN 되어 폴리곤 geom 을 함께 반환.
// curated_roads / curated_points 는 자체 location(Point) 보유.

/**
 * fetch_curated_buildings() 행 → GeoJSON Feature.
 *
 * geom 이 null 인 경우(연결된 buildings row 없음) Feature 가 아닌 null 반환.
 * 호출 측은 .filter(Boolean) 으로 거름.
 */
export function dbRowToCuratedBuildingFeature(row) {
  if (!row.geom) return null
  const geometry = typeof row.geom === 'string' ? JSON.parse(row.geom) : row.geom
  return {
    type: 'Feature',
    geometry,
    properties: {
      curatedId:      row.curated_id,
      buildingId:     row.building_id,
      buildingPnu:    row.building_pnu,
      bldNm:          row.bld_nm,
      mainPurps:      row.main_purps,
      firstFloorUse:  row.first_floor_use,
      isVacant:       row.is_vacant === true,
      photoPaths:     row.photo_paths || [],
      adminMemo:      row.admin_memo,
      approvedAt:     row.approved_at,
      sourceCount:    Number(row.source_count) || 0,
    },
  }
}

export function dbRowsToCuratedBuildingFeatureCollection(rows) {
  return {
    type: 'FeatureCollection',
    features: (rows || [])
      .map(dbRowToCuratedBuildingFeature)
      .filter(Boolean),
  }
}

/**
 * fetch_curated_roads() 행 → GeoJSON Feature (Point).
 */
export function dbRowToCuratedRoadFeature(row) {
  const geometry = typeof row.location === 'string'
    ? JSON.parse(row.location)
    : row.location
  return {
    type: 'Feature',
    geometry,
    properties: {
      id:               row.id,
      nightBrightness:  row.night_brightness,
      roadWidth:        row.road_width,
      photoPaths:       row.photo_paths || [],
      adminMemo:        row.admin_memo,
      approvedAt:       row.approved_at,
      sourceCount:      Number(row.source_count) || 0,
    },
  }
}

export function dbRowsToCuratedRoadFeatureCollection(rows) {
  return {
    type: 'FeatureCollection',
    features: (rows || []).map(dbRowToCuratedRoadFeature),
  }
}

/**
 * fetch_curated_points() 행 → GeoJSON Feature (Point).
 */
export function dbRowToCuratedPointFeature(row) {
  const geometry = typeof row.location === 'string'
    ? JSON.parse(row.location)
    : row.location
  return {
    type: 'Feature',
    geometry,
    properties: {
      id:           row.id,
      category:     row.category,
      photoPaths:   row.photo_paths || [],
      adminMemo:    row.admin_memo,
      approvedAt:   row.approved_at,
      sourceCount:  Number(row.source_count) || 0,
    },
  }
}

export function dbRowsToCuratedPointFeatureCollection(rows) {
  return {
    type: 'FeatureCollection',
    features: (rows || []).map(dbRowToCuratedPointFeature),
  }
}
