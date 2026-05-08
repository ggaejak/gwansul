// 현장 조사(field survey) 데이터 추상화.
//
// SurveyPage / SurveyAdminPage 는 이 파일만 import 한다. Supabase 직접 의존 X.
//
// 현장 조사는 정적 폴백이 의미 없는 write-mandatory 시스템이라
// buildings.js / zoning.js 의 정적 폴백 패턴을 따르지 않는다.
// Supabase 미초기화 시 read 함수는 빈 결과 + 경고, write 함수는 에러를 throw.
//
// 함수 분류:
//   [Read]   fetchBuildingsInSurveyArea, fetchSurveysInArea, fetchSurveyById,
//            fetchPendingSurveys, fetchSurveyProgress
//   [Write]  generateSurveyId, makePhotoPath, uploadSurveyPhoto,
//            saveSurvey (INSERT), updateSurvey (UPDATE — pending only)
//   [Helper] getPhotoUrl, isSurveyBackendReady

import { supabase, isSupabaseReady } from '../lib/supabase'
import {
  dbRowsToBuildingFeatureCollection,
  dbRowToPendingSurvey,
  surveyToInsertRow,
  surveysFeatureCollectionFromRpc,
  surveyFeatureFromRpc,
} from './adapters/surveyAdapter'

const PHOTO_BUCKET = 'survey-photos'
const EMPTY_FC = { type: 'FeatureCollection', features: [] }
const EMPTY_PROGRESS = {
  in_area_total:      0,
  surveyed_buildings: 0,
  approved_buildings: 0,
  pending_total:      0,
  approved_total:     0,
  rejected_total:     0,
  by_day:             [],
}

// ─────────────────────────────────────────────────────────────
// 가용성
// ─────────────────────────────────────────────────────────────

export function isSurveyBackendReady() {
  return isSupabaseReady()
}

function ensureReady(fnName) {
  if (!isSupabaseReady()) {
    throw new Error(
      `[surveys.${fnName}] Supabase 미초기화 — VITE_SUPABASE_URL/ANON_KEY 확인`,
    )
  }
}

// ─────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────

/**
 * 신당동 영역 내 건물 + 각 건물의 조사 통계.
 * SurveyPage 지도 렌더링용. 빈 상태에서도 정상 호출돼야 함 (빈 features).
 *
 * Supabase 미초기화 시 빈 FeatureCollection + 콘솔 경고.
 */
export async function fetchBuildingsInSurveyArea() {
  if (!isSupabaseReady()) {
    console.warn('[surveys.fetchBuildingsInSurveyArea] Supabase 미초기화 — 빈 결과 반환')
    return EMPTY_FC
  }
  const { data, error } = await supabase.rpc('survey_buildings_in_area')
  if (error) {
    console.warn('[surveys.fetchBuildingsInSurveyArea] RPC 실패:', error.message)
    return EMPTY_FC
  }
  return dbRowsToBuildingFeatureCollection(data)
}

/**
 * 미검토(pending) 조사 목록.
 *
 * @param {object} opts
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @param {('building'|'road'|'point'|null)} [opts.type=null]
 * @returns {Promise<{items: object[], totalCount: number}>}
 */
export async function fetchPendingSurveys({ limit = 50, offset = 0, type = null } = {}) {
  if (!isSupabaseReady()) {
    console.warn('[surveys.fetchPendingSurveys] Supabase 미초기화 — 빈 결과 반환')
    return { items: [], totalCount: 0 }
  }
  const { data, error } = await supabase.rpc('pending_surveys', {
    p_limit:  limit,
    p_offset: offset,
    p_type:   type,
  })
  if (error) {
    console.warn('[surveys.fetchPendingSurveys] RPC 실패:', error.message)
    return { items: [], totalCount: 0 }
  }
  const items = (data || []).map(dbRowToPendingSurvey)
  const totalCount = items[0]?.totalCount ?? 0
  return { items, totalCount }
}

/**
 * 신당동 영역 내 모든 조사 데이터 (지도 마커용 GeoJSON FeatureCollection).
 *
 * 마커 색상/모양은 properties.status / properties.surveyType 으로 분기.
 * 수정 가능 여부는 properties.status === 'pending' 으로 판정.
 *
 * @param {object} [opts]
 * @param {('pending'|'approved'|'rejected'|null)} [opts.status=null]
 * @param {('building'|'road'|'point'|null)}       [opts.type=null]
 * @returns {Promise<{type:'FeatureCollection', features:Array}>}
 */
export async function fetchSurveysInArea({ status = null, type = null } = {}) {
  if (!isSupabaseReady()) {
    console.warn('[surveys.fetchSurveysInArea] Supabase 미초기화 — 빈 결과 반환')
    return EMPTY_FC
  }
  const { data, error } = await supabase.rpc('fetch_surveys_in_area', {
    p_status: status,
    p_type:   type,
  })
  if (error) {
    console.warn('[surveys.fetchSurveysInArea] RPC 실패:', error.message)
    return EMPTY_FC
  }
  return surveysFeatureCollectionFromRpc(data)
}

/**
 * 조사 단건 조회 — 마커 클릭 / 수정 폼 prefill.
 * 없으면 null.
 *
 * @param {string} surveyId
 * @returns {Promise<object|null>} GeoJSON Feature (camelCase properties)
 */
export async function fetchSurveyById(surveyId) {
  if (!isSupabaseReady()) {
    console.warn('[surveys.fetchSurveyById] Supabase 미초기화')
    return null
  }
  if (!surveyId) return null
  const { data, error } = await supabase.rpc('fetch_survey_by_id', {
    p_id: surveyId,
  })
  if (error) {
    console.warn('[surveys.fetchSurveyById] RPC 실패:', error.message)
    return null
  }
  return surveyFeatureFromRpc(data)
}

/**
 * 조사 진행률 통계 (총합 + 30일 일자별 추이).
 * 반환 형상은 RPC 가 만든 jsonb 그대로 (snake_case 유지 — 관리자 대시보드 단순화).
 */
export async function fetchSurveyProgress() {
  if (!isSupabaseReady()) {
    console.warn('[surveys.fetchSurveyProgress] Supabase 미초기화 — 빈 통계 반환')
    return EMPTY_PROGRESS
  }
  const { data, error } = await supabase.rpc('survey_progress')
  if (error) {
    console.warn('[surveys.fetchSurveyProgress] RPC 실패:', error.message)
    return EMPTY_PROGRESS
  }
  return data || EMPTY_PROGRESS
}

// ─────────────────────────────────────────────────────────────
// WRITE — Storage
// ─────────────────────────────────────────────────────────────

/**
 * 새 조사 ID(UUID) 생성. INSERT 와 사진 업로드를 병렬화하기 위해 클라가 미리 생성.
 */
export function generateSurveyId() {
  // crypto.randomUUID 는 Safari 15.4+, Chrome 92+, Firefox 95+ 에서 지원.
  // SurveyPage 는 모바일 최신 브라우저 가정이므로 폴리필 불필요.
  return crypto.randomUUID()
}

/**
 * Storage 객체 경로 생성 — '{yyyy-mm}/{surveyId}_{idx}.{ext}'
 * docs/phase-a-storage-setup.md §3 의 컨벤션.
 */
export function makePhotoPath(surveyId, idx, ext = 'jpg', date = new Date()) {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}/${surveyId}_${idx}.${ext}`
}

/**
 * Storage 에 사진 업로드.
 *
 * @param {Blob|File} blob
 * @param {string}    path        — makePhotoPath() 결과
 * @param {string}    [contentType='image/jpeg']
 * @returns {Promise<string>}     업로드된 path (그대로)
 */
export async function uploadSurveyPhoto(blob, path, contentType = 'image/jpeg') {
  ensureReady('uploadSurveyPhoto')
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType, upsert: false })
  if (error) {
    throw new Error(`사진 업로드 실패 (${path}): ${error.message}`)
  }
  return path
}

/**
 * Storage 객체 경로 → 표시용 public URL.
 * 버킷이 public 으로 설정되어 있어야 함 (docs/phase-a-storage-setup.md §1).
 */
export function getPhotoUrl(path) {
  if (!path) return null
  if (!isSupabaseReady()) return null
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path)
  return data?.publicUrl ?? null
}

// ─────────────────────────────────────────────────────────────
// WRITE — DB
// ─────────────────────────────────────────────────────────────

/**
 * field_surveys 에 조사 1 건 INSERT.
 *
 * 사용 패턴 (Phase B SurveyPage):
 *   const id = generateSurveyId()
 *   const photoPaths = []
 *   for (const [i, blob] of compressedBlobs.entries()) {
 *     const p = makePhotoPath(id, i)
 *     await uploadSurveyPhoto(blob, p)
 *     photoPaths.push(p)
 *   }
 *   await saveSurvey({ id, surveyType: 'building', lng, lat, buildingPnu, payload, photoPaths })
 *
 * RLS: anon 은 status='pending' 만 INSERT 가능 → status 컬럼은 보내지 않음 (DB DEFAULT).
 *
 * @returns {Promise<{id: string}>}
 */
export async function saveSurvey(survey) {
  ensureReady('saveSurvey')
  const row = surveyToInsertRow(survey)
  const { error } = await supabase.from('field_surveys').insert(row)
  if (error) {
    throw new Error(`조사 저장 실패: ${error.message}`)
  }
  return { id: row.id }
}

/**
 * 기존 조사 수정 — pending 상태일 때만 가능.
 *
 * RLS USING (status='pending') 가 1차 안전망.
 * .eq('status','pending') 로 SQL 차원 명시적 조건 추가.
 * 수정 대상 0행이면 (이미 검토 완료 / id 오류) 에러.
 *
 * 사진 교체:
 *   1) 새 사진을 uploadSurveyPhoto 로 업로드
 *   2) photoPaths 배열을 새 경로 + 유지할 기존 경로로 재구성
 *   3) updateSurvey 호출
 *   ※ Storage 의 orphan 사진 정리는 1 차 MVP 범위 외 (관리자 수동 또는 추후 cleanup job)
 *
 * @param {string} surveyId
 * @param {object} patch
 * @param {object} [patch.payload]    새 payload (전체 교체)
 * @param {string[]} [patch.photoPaths] 새 photo 경로 배열 (전체 교체)
 * @param {string|null} [patch.memo]
 * @returns {Promise<{id: string}>}
 */
export async function updateSurvey(surveyId, { payload, photoPaths, memo } = {}) {
  ensureReady('updateSurvey')
  if (!surveyId) throw new Error('updateSurvey: surveyId 필수')

  const patch = {}
  if (payload !== undefined)    patch.payload     = payload
  if (photoPaths !== undefined) patch.photo_paths = photoPaths
  if (memo !== undefined)       patch.memo        = memo
  if (Object.keys(patch).length === 0) {
    throw new Error('updateSurvey: 변경할 필드가 없습니다')
  }

  const { data, error } = await supabase
    .from('field_surveys')
    .update(patch)
    .eq('id', surveyId)
    .eq('status', 'pending')
    .select('id')

  if (error) {
    throw new Error(`조사 수정 실패: ${error.message}`)
  }
  if (!data || data.length === 0) {
    throw new Error(
      '수정 대상 없음 — 이미 검토 완료(approved/rejected)되었거나 id 가 잘못되었습니다',
    )
  }
  return { id: surveyId }
}
