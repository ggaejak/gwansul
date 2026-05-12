// 조사 payload 를 사람이 읽을 수 있는 표 + (선택) 원시 JSON 으로 표시.
//
// describePayload (src/lib/surveyLabels.js) 로 한글 라벨 변환,
// 라벨화되지 않은 키도 빠뜨리지 않도록 "그 외 필드" 섹션에 dump.

import { describePayload } from '../../lib/surveyLabels'

// describePayload 가 다루는 알려진 키 (매핑된 키는 표에서 제외).
const KNOWN_KEYS = {
  building: ['first_floor_use', 'floor_count', 'is_vacant'],
  road:     ['night_brightness', 'road_width'],
  point:    ['category'],
}

function formatRawValue(v) {
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function PayloadView({ surveyType, payload, memo }) {
  const fields = describePayload(surveyType, payload || {})
  const known = new Set(KNOWN_KEYS[surveyType] || [])
  const extras = Object.entries(payload || {}).filter(
    ([k, v]) => !known.has(k) && v != null && v !== '',
  )

  return (
    <div className="sa-payload">
      {fields.length > 0 && (
        <dl className="sa-fields">
          {fields.map(({ label, value }) => (
            <div key={label} className="sa-field-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {memo && (
        <div className="sa-memo">
          <div className="sa-memo-label">메모</div>
          <p>{memo}</p>
        </div>
      )}

      {extras.length > 0 && (
        <dl className="sa-fields sa-fields-extra">
          {extras.map(([k, v]) => (
            <div key={k} className="sa-field-row">
              <dt>{k}</dt>
              <dd>{formatRawValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {fields.length === 0 && extras.length === 0 && !memo && (
        <div className="sa-payload-empty">입력값 없음</div>
      )}
    </div>
  )
}
