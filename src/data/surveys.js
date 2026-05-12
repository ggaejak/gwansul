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
//            fetchPendingSurveys, fetchSurveyProgress, fetchRelatedSurveys
//   [Write]  generateSurveyId, makePhotoPath, uploadSurveyPhoto,
//            saveSurvey (INSERT), updateSurvey (UPDATE — pending only)
//   [Review] approveSurvey (type 분기 wrapper), rejectSurvey
//            — admin_* SECURITY DEFINER RPC 호출, 비밀번호 평문 전달.
//   [Delete] deleteSurvey (조사원 — pending only, RLS 가 차단),
//            adminDeleteSurvey (관리자 — 모든 상태, RPC + 비밀번호)
//            — 두 함수 모두 Storage 의 사진 파일을 best-effort 로 함께 삭제.
//   [Helper] getPhotoUrl, isSurveyBackendReady

import { supabase, isSupabaseReady } from '../lib/supabase'
import {
  buildingsFeatureCollectionFromRpc,
  dbRowToPendingSurvey,
  surveyToInsertRow,
  surveysFeatureCollectionFromRpc,
  surveyFeatureFromRpc,
} from './adapters/surveyAdapter'

const PHOTO_BUCKET = 'survey-photos'
const EMPTY_FC = { type: 'FeatureCollection', features: [] }
const EMPTY_PROGRESS = {
  in_area_total:        0,
  surveyed_buildings:   0,
  approved_buildings:   0,
  pending_total:        0,
  approved_total:       0,
  rejected_total:       0,
  curated_roads_total:  0,
  curated_points_total: 0,
  pending_by_type:      { building: 0, road: 0, point: 0 },
  by_day:               [],
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
 * 00016 마이그레이션 이후 RPC 는 JSONB FeatureCollection 을 반환한다
 * (PostgREST max_rows 1,000 cap 회피).
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
  return buildingsFeatureCollectionFromRpc(data)
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
 * 같은 건물에 들어온 다른 조사 기록.
 * SurveyAdminPage 의 상세 패널에서 "같은 건물의 다른 조사" 섹션용.
 *
 * building_id 또는 building_pnu 둘 중 하나라도 일치하면 매칭.
 * 좌표만 있는 조사는 매칭 불가 (key 가 없음) → 빈 배열.
 *
 * 00011 마이그레이션 이후 anon 도 SELECT 가능 → RPC 없이 직접 쿼리.
 * location 컬럼은 PostgREST 가 EWKB hex 로 직렬화하므로 SELECT 에서 제외
 * (이 함수는 메타데이터/payload/photoPaths 만 필요).
 *
 * @param {object} opts
 * @param {number|null} [opts.buildingId]
 * @param {string|null} [opts.buildingPnu]
 * @param {string|null} [opts.excludeId]   현재 선택된 survey 제외
 * @param {number}      [opts.limit=20]
 * @returns {Promise<object[]>}
 */
export async function fetchRelatedSurveys({
  buildingId = null,
  buildingPnu = null,
  excludeId = null,
  limit = 20,
} = {}) {
  if (!isSupabaseReady()) {
    console.warn('[surveys.fetchRelatedSurveys] Supabase 미초기화 — 빈 결과 반환')
    return []
  }
  if (buildingId == null && !buildingPnu) return []

  const orFilters = []
  if (buildingId != null) orFilters.push(`building_id.eq.${buildingId}`)
  if (buildingPnu)        orFilters.push(`building_pnu.eq.${buildingPnu}`)

  let q = supabase
    .from('field_surveys')
    .select('id, survey_type, status, created_at, updated_at, payload, memo, photo_paths, building_id, building_pnu, reject_reason')
    .or(orFilters.join(','))
    .order('created_at', { ascending: false })
    .limit(limit)

  if (excludeId) q = q.neq('id', excludeId)

  const { data, error } = await q
  if (error) {
    console.warn('[surveys.fetchRelatedSurveys] 실패:', error.message)
    return []
  }
  return (data || []).map(r => ({
    id:           r.id,
    surveyType:   r.survey_type,
    status:       r.status,
    createdAt:    r.created_at,
    updatedAt:    r.updated_at,
    payload:      r.payload || {},
    memo:         r.memo,
    photoPaths:   r.photo_paths || [],
    buildingId:   r.building_id,
    buildingPnu:  r.building_pnu,
    rejectReason: r.reject_reason,
  }))
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
// ─────────────────────────────────────────────────────────────
// REVIEW — Admin 승인/반려 (SECURITY DEFINER RPC + 비밀번호 게이트)
// ─────────────────────────────────────────────────────────────

/**
 * 조사 승인 + curated_* 저장.
 *
 * survey_type 별로 다른 RPC 를 호출. 호출자는 type 에 맞는 curated 필드만 채워서 전달.
 *
 * @param {object} args
 * @param {string} args.surveyId
 * @param {('building'|'road'|'point')} args.surveyType
 * @param {string} args.password                 ADMIN_PASSWORD (src/lib/adminAuth)
 * @param {object} args.curated                  type 별 정제 필드
 *   - building: { firstFloorUse: string|null, isVacant: boolean|null, adminMemo: string|null }
 *   - road    : { nightBrightness: string|null, roadWidth: string|null, adminMemo: string|null }
 *   - point   : { category: string (required), adminMemo: string|null }
 * @returns {Promise<{curatedId: number}>}
 */
export async function approveSurvey({ surveyId, surveyType, password, curated = {} }) {
  ensureReady('approveSurvey')
  if (!surveyId)   throw new Error('approveSurvey: surveyId 필수')
  if (!surveyType) throw new Error('approveSurvey: surveyType 필수')
  if (!password)   throw new Error('approveSurvey: password 필수')

  let rpcName, params
  if (surveyType === 'building') {
    rpcName = 'admin_approve_survey_building'
    params = {
      p_password:        password,
      p_id:              surveyId,
      p_first_floor_use: curated.firstFloorUse ?? null,
      p_is_vacant:       curated.isVacant ?? null,
      p_admin_memo:      curated.adminMemo ?? null,
    }
  } else if (surveyType === 'road') {
    rpcName = 'admin_approve_survey_road'
    params = {
      p_password:         password,
      p_id:               surveyId,
      p_night_brightness: curated.nightBrightness ?? null,
      p_road_width:       curated.roadWidth ?? null,
      p_admin_memo:       curated.adminMemo ?? null,
    }
  } else if (surveyType === 'point') {
    rpcName = 'admin_approve_survey_point'
    if (!curated.category) {
      throw new Error('approveSurvey(point): category 필수')
    }
    params = {
      p_password:   password,
      p_id:         surveyId,
      p_category:   curated.category,
      p_admin_memo: curated.adminMemo ?? null,
    }
  } else {
    throw new Error(`approveSurvey: 알 수 없는 surveyType ${surveyType}`)
  }

  const { data, error } = await supabase.rpc(rpcName, params)
  if (error) {
    // Supabase 는 RPC 의 RAISE EXCEPTION 메시지를 error.message 에 그대로 담아 줌.
    throw new Error(error.message || '승인 처리 실패')
  }
  return { curatedId: data }
}

/**
 * 조사 반려.
 *
 * @param {object} args
 * @param {string} args.surveyId
 * @param {string} args.reason     필수 (공백 trim 후 비면 RPC 가 에러).
 * @param {string} args.password   ADMIN_PASSWORD
 */
export async function rejectSurvey({ surveyId, reason, password }) {
  ensureReady('rejectSurvey')
  if (!surveyId) throw new Error('rejectSurvey: surveyId 필수')
  if (!reason || !reason.trim()) throw new Error('rejectSurvey: reason 필수')
  if (!password) throw new Error('rejectSurvey: password 필수')

  const { error } = await supabase.rpc('admin_reject_survey', {
    p_password: password,
    p_id:       surveyId,
    p_reason:   reason.trim(),
  })
  if (error) {
    throw new Error(error.message || '반려 처리 실패')
  }
}

// ─────────────────────────────────────────────────────────────
// DELETE — 조사원/관리자 (Storage 사진 best-effort 동반 삭제)
// ─────────────────────────────────────────────────────────────

/**
 * Storage 의 사진 파일을 묶어서 best-effort 로 삭제.
 * 실패해도 DB 삭제 흐름은 진행 (콘솔 경고만).
 */
async function removePhotosBestEffort(photoPaths) {
  if (!photoPaths || photoPaths.length === 0) return
  try {
    const { error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .remove(photoPaths)
    if (error) {
      console.warn('[surveys.removePhotosBestEffort] Storage 삭제 실패 (DB 삭제는 진행):', error.message)
    }
  } catch (e) {
    console.warn('[surveys.removePhotosBestEffort] Storage 삭제 예외:', e?.message)
  }
}

/**
 * 조사원 셀프 삭제 — status='pending' row 만 가능.
 *
 * RLS(00019) 가 status='pending' 일 때만 anon DELETE 를 허용.
 * 다른 상태는 RLS 가 0 row 영향으로 차단 → 에러 throw.
 *
 * curated_* 정리는 AFTER DELETE 트리거가 자동 처리하지만,
 * pending row 는 보통 curated 에 포함되지 않음 (curated 는 승인 시 생성).
 *
 * Storage 사진은 호출 측이 photoPaths 를 알고 있으므로 함께 전달.
 *
 * @param {object} args
 * @param {string} args.surveyId
 * @param {string[]} [args.photoPaths]
 */
export async function deleteSurvey({ surveyId, photoPaths = [] } = {}) {
  ensureReady('deleteSurvey')
  if (!surveyId) throw new Error('deleteSurvey: surveyId 필수')

  // 1) Storage 사진 먼저 (best-effort)
  await removePhotosBestEffort(photoPaths)

  // 2) DB row 삭제 (RLS 가 pending 만 통과)
  const { data, error } = await supabase
    .from('field_surveys')
    .delete()
    .eq('id', surveyId)
    .select('id')

  if (error) {
    throw new Error(`조사 삭제 실패: ${error.message}`)
  }
  if (!data || data.length === 0) {
    // RLS 차단 또는 id 오류 — 어느 쪽이든 사용자에게 명확히 알림
    throw new Error('삭제 대상 없음 — 이미 검토 완료된 조사이거나 id 가 잘못되었습니다')
  }
  return { id: surveyId }
}

/**
 * 관리자 삭제 — 모든 상태 가능. SECURITY DEFINER RPC + 비밀번호.
 *
 * RPC 가 photo_paths 를 반환 → 그 경로로 Storage 정리.
 * curated_* 정리는 트리거가 자동 처리.
 *
 * @param {object} args
 * @param {string} args.surveyId
 * @param {string} args.password    ADMIN_PASSWORD
 * @returns {Promise<{deletedSurveyId: string, photoPaths: string[], curatedCleaned: boolean}>}
 */
export async function adminDeleteSurvey({ surveyId, password }) {
  ensureReady('adminDeleteSurvey')
  if (!surveyId) throw new Error('adminDeleteSurvey: surveyId 필수')
  if (!password) throw new Error('adminDeleteSurvey: password 필수')

  const { data, error } = await supabase.rpc('admin_delete_survey', {
    p_password: password,
    p_id:       surveyId,
  })
  if (error) {
    throw new Error(error.message || '관리자 삭제 실패')
  }
  const result = data || {}
  const photoPaths = Array.isArray(result.photo_paths) ? result.photo_paths : []

  // Storage 정리 (best-effort)
  await removePhotosBestEffort(photoPaths)

  return {
    deletedSurveyId: result.deleted_survey_id,
    photoPaths,
    curatedCleaned:  result.curated_cleaned === true,
  }
}

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
