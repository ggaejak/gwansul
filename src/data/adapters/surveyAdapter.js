// field_surveys / survey_buildings_in_area / pending_surveys RPC 행 ↔ 클라이언트 객체 변환.
//
// - DB 컬럼은 snake_case, 클라이언트는 camelCase.
// - geometry 컬럼은 RPC 가 ST_AsGeoJSON(...)::jsonb 로 변환해서 내려줌.
//   여기서는 Point 의 경우 {lng, lat} 로 정규화해 사용 편의를 높임.
// - photo_paths 는 그대로 string[]. URL 변환은 src/data/surveys.js 의 getPhotoUrl 사용.

/**
 * GeoJSON Point jsonb → {lng, lat} 추출.
 * 입력이 null/이상하면 null 반환.
 */
function pointToLngLat(geo) {
  if (!geo) return null
  const g = typeof geo === 'string' ? JSON.parse(geo) : geo
  if (g?.type !== 'Point' || !Array.isArray(g.coordinates) || g.coordinates.length < 2) {
    return null
  }
  return { lng: g.coordinates[0], lat: g.coordinates[1] }
}

/**
 * survey_buildings_in_area() JSONB FeatureCollection → camelCase 정규화.
 *
 * 00016 마이그레이션 이후 RPC 는 단일 JSONB FeatureCollection 을 반환한다
 * (PostgREST max_rows 1,000 cap 회피). 이 함수가 properties 를 camelCase 로
 * 통일해 다른 어댑터(surveysFeatureCollectionFromRpc) 와 일관성을 맞춘다.
 *
 * SurveyMap 의 styling 에서 `feature.properties.surveyCount > 0` 등으로 사용.
 */
function normalizeBuildingFeature(feat) {
  if (!feat) return null
  const p = feat.properties || {}
  return {
    type: 'Feature',
    geometry: feat.geometry,
    properties: {
      id:            p.id,
      pnu:           p.pnu,
      bldNm:         p.bld_nm,
      mainPurps:     p.main_purps,
      vlRat:         p.vl_rat,
      surveyCount:   Number(p.survey_count) || 0,
      approvedCount: Number(p.approved_count) || 0,
      hasCurated:    p.has_curated === true,
    },
  }
}

export function buildingsFeatureCollectionFromRpc(fc) {
  if (!fc?.features) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: fc.features.map(normalizeBuildingFeature).filter(Boolean),
  }
}

/**
 * pending_surveys() RPC 행 → 클라이언트 친화 형상.
 *
 * - location 은 {lng, lat} 로 정규화
 * - createdAt 은 ISO 문자열 그대로
 * - totalCount 는 페이지네이션용 (모든 row 에 동일 값 — 첫 row 만 보면 됨)
 */
export function dbRowToPendingSurvey(row) {
  return {
    id:           row.id,
    surveyType:   row.survey_type,
    location:     pointToLngLat(row.location),
    buildingId:   row.building_id,
    buildingPnu:  row.building_pnu,
    payload:      row.payload || {},
    memo:         row.memo,
    photoPaths:   row.photo_paths || [],
    status:       row.status,
    createdAt:    row.created_at,
    totalCount:   row.total_count != null ? Number(row.total_count) : 0,
  }
}

/**
 * fetch_surveys_in_area / fetch_survey_by_id 의 단일 Feature →
 * camelCase 정규화된 클라이언트 Feature.
 *
 * RPC 가 만든 jsonb 의 properties 는 snake_case (DB 컬럼 직매핑) 이라
 * 기존 GisPage / SurveyPage 의 camelCase 컨벤션과 다름. 여기서 통일.
 *
 * geometry 는 그대로 통과 (Point GeoJSON jsonb).
 */
function normalizeSurveyFeature(feat) {
  if (!feat) return null
  const p = feat.properties || {}
  return {
    type: 'Feature',
    geometry: feat.geometry,
    properties: {
      id:           p.id,
      surveyType:   p.survey_type,
      buildingId:   p.building_id,
      buildingPnu:  p.building_pnu,
      payload:      p.payload || {},
      memo:         p.memo,
      photoPaths:   p.photo_paths || [],
      status:       p.status,
      rejectReason: p.reject_reason,
      createdAt:    p.created_at,
      updatedAt:    p.updated_at,
    },
  }
}

export function surveyFeatureFromRpc(feat) {
  return normalizeSurveyFeature(feat)
}

export function surveysFeatureCollectionFromRpc(fc) {
  if (!fc?.features) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: fc.features.map(normalizeSurveyFeature).filter(Boolean),
  }
}

/**
 * 클라이언트 객체 → field_surveys INSERT row.
 *
 * id 는 클라가 미리 생성(crypto.randomUUID) 한 UUID 권장.
 * 사진 업로드는 INSERT 와 분리 (사진 먼저 → 경로 배열 후 INSERT).
 *
 * geom 은 PostgreSQL/PostGIS 가 'SRID=4326;POINT(lng lat)' EWKT 를 자동 파싱.
 */
export function surveyToInsertRow({
  id,
  surveyType,
  lng,
  lat,
  buildingId = null,
  buildingPnu = null,
  payload = {},
  memo = null,
  photoPaths = [],
}) {
  if (!id) throw new Error('surveyToInsertRow: id 필수 (crypto.randomUUID 사용)')
  if (!surveyType) throw new Error('surveyToInsertRow: surveyType 필수')
  if (typeof lng !== 'number' || typeof lat !== 'number') {
    throw new Error('surveyToInsertRow: lng/lat 숫자 필수')
  }
  // building 타입의 buildingPnu/buildingId 는 NULL 허용 (좌표 우선 모드, 00013 마이그레이션 이후).

  return {
    id,
    survey_type:   surveyType,
    location:      `SRID=4326;POINT(${lng} ${lat})`,
    building_id:   buildingId,
    building_pnu:  buildingPnu,
    payload,
    memo,
    photo_paths:   photoPaths,
    // status 기본값 'pending' — RLS WITH CHECK 통과
  }
}
