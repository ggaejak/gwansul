// 현장 조사 enum 코드 ↔ 한국어 라벨.
// SurveyDetailSheet (B3) 와 입력 폼 (B4) 양쪽에서 공유.
//
// 코드는 모두 영문 snake_case — DB payload jsonb 에 그대로 저장.
// 새 enum 추가 시 이 파일 한 곳만 수정.

// ─── 메타 ────────────────────────────────────────────────────
export const STATUS_LABELS = {
  pending:  '미검토',
  approved: '승인됨',
  rejected: '반려됨',
}

export const TYPE_LABELS = {
  building: '건물 조사',
  road:     '도로 조사',
  point:    '일반 점 조사',
}

// ─── building.first_floor_use ────────────────────────────────
export const FIRST_FLOOR_USE_OPTIONS = [
  { code: 'restaurant',  label: '음식점' },
  { code: 'cafe',        label: '카페' },
  { code: 'convenience', label: '편의점' },
  { code: 'beauty',      label: '미용' },
  { code: 'medical',     label: '의료' },
  { code: 'academy',     label: '학원' },
  { code: 'office',      label: '사무실' },
  { code: 'residential', label: '주거' },
  { code: 'vacant',      label: '공실' },
  { code: 'etc',         label: '기타' },
]
export const FIRST_FLOOR_USE_LABEL = Object.fromEntries(
  FIRST_FLOOR_USE_OPTIONS.map(o => [o.code, o.label]),
)

// ─── road.night_brightness ───────────────────────────────────
export const NIGHT_BRIGHTNESS_OPTIONS = [
  { code: 'dark',   label: '어둡다' },
  { code: 'normal', label: '보통' },
  { code: 'bright', label: '밝다' },
]
export const NIGHT_BRIGHTNESS_LABEL = Object.fromEntries(
  NIGHT_BRIGHTNESS_OPTIONS.map(o => [o.code, o.label]),
)

// ─── road.road_width ─────────────────────────────────────────
export const ROAD_WIDTH_OPTIONS = [
  { code: 'no_vehicle',  label: '차량 통행 불가' },
  { code: 'lane_1',      label: '1차선' },
  { code: 'lane_2_plus', label: '2차선 이상' },
  { code: 'main_road',   label: '대로' },
]
export const ROAD_WIDTH_LABEL = Object.fromEntries(
  ROAD_WIDTH_OPTIONS.map(o => [o.code, o.label]),
)

// ─── point.category ──────────────────────────────────────────
export const POINT_CATEGORY_OPTIONS = [
  { code: 'public_toilet', label: '공공화장실' },
  { code: 'smoking_area',  label: '흡연구역(꽁초밀집)' },
  { code: 'noise_spot',    label: '소음 특이지점' },
  { code: 'odor_spot',     label: '냄새 특이지점' },
  { code: 'other',         label: '기타' },
]
export const POINT_CATEGORY_LABEL = Object.fromEntries(
  POINT_CATEGORY_OPTIONS.map(o => [o.code, o.label]),
)

// ─── 통합 헬퍼 ───────────────────────────────────────────────
/**
 * 조사 1 건의 payload 를 사람이 읽을 수 있는 [{label, value}] 로 변환.
 * survey_type 마다 다른 키 → 같은 표시 형식.
 */
export function describePayload(surveyType, payload = {}) {
  const out = []
  if (surveyType === 'building') {
    if (payload.first_floor_use != null) {
      // 다중 선택 지원 — 배열이면 각 코드 라벨화 후 ", " join.
      // 레거시 단일 문자열 row 도 호환 (Step B4 시점 데이터).
      const arr = Array.isArray(payload.first_floor_use)
        ? payload.first_floor_use
        : [payload.first_floor_use]
      const labels = arr
        .filter(v => v != null && v !== '')
        .map(v => FIRST_FLOOR_USE_LABEL[v] || v)
      if (labels.length > 0) {
        out.push({ label: '1층 업종', value: labels.join(', ') })
      }
    }
    if (payload.floor_count != null && payload.floor_count !== '') {
      out.push({
        label: '층 수',
        value: `${payload.floor_count}층`,
      })
    }
    if (payload.is_vacant != null) {
      out.push({
        label: '공실 여부',
        value: payload.is_vacant ? '공실' : '운영 중',
      })
    }
  } else if (surveyType === 'road') {
    if (payload.night_brightness != null) {
      out.push({
        label: '야간 밝기',
        value: NIGHT_BRIGHTNESS_LABEL[payload.night_brightness] || payload.night_brightness,
      })
    }
    if (payload.road_width != null) {
      out.push({
        label: '도로 폭',
        value: ROAD_WIDTH_LABEL[payload.road_width] || payload.road_width,
      })
    }
  } else if (surveyType === 'point') {
    if (payload.category != null) {
      out.push({
        label: '카테고리',
        value: POINT_CATEGORY_LABEL[payload.category] || payload.category,
      })
    }
  }
  return out
}
