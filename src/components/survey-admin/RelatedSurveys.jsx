// 같은 건물(building_id 또는 building_pnu 일치) 에 들어온 다른 조사 기록.
//
// 좌표만 있는 조사(building_id/pnu 둘 다 NULL) 는 매칭 불가 → 안내 문구.
// 항목 클릭 시 부모로 id 전달 (선택 전환 가능).

import { useEffect, useState } from 'react'
import { fetchRelatedSurveys } from '../../data/surveys'
import { STATUS_LABELS, TYPE_LABELS, describePayload } from '../../lib/surveyLabels'

function formatShort(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${d.getFullYear()}-${mm}-${dd} ${hh}:${mi}`
  } catch {
    return iso
  }
}

function summarizePayload(surveyType, payload) {
  const fields = describePayload(surveyType, payload || {})
  if (fields.length === 0) return null
  return fields.map(f => `${f.label}: ${f.value}`).join(' · ')
}

export default function RelatedSurveys({ buildingId, buildingPnu, excludeId, onSelect }) {
  const [items, setItems] = useState(null)   // null = loading
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    if (buildingId == null && !buildingPnu) {
      setItems([])
      return
    }
    setItems(null)
    setError('')
    fetchRelatedSurveys({ buildingId, buildingPnu, excludeId })
      .then(rs => { if (alive) setItems(rs) })
      .catch(e => { if (alive) setError(e?.message || '불러오기 실패') })
    return () => { alive = false }
  }, [buildingId, buildingPnu, excludeId])

  if (buildingId == null && !buildingPnu) {
    return (
      <div className="sa-related-empty">
        건물 식별자(PNU/ID) 가 없는 조사라 다른 기록을 매칭할 수 없습니다.
      </div>
    )
  }

  if (error) return <div className="sa-related-empty">에러: {error}</div>
  if (items === null) return <div className="sa-related-empty">불러오는 중…</div>
  if (items.length === 0) return <div className="sa-related-empty">같은 건물에 다른 조사 기록이 없습니다.</div>

  return (
    <ul className="sa-related">
      {items.map(it => {
        const summary = summarizePayload(it.surveyType, it.payload)
        const photoCount = (it.photoPaths || []).length
        return (
          <li key={it.id}>
            <button
              type="button"
              className="sa-related-item"
              onClick={() => onSelect && onSelect(it.id)}
            >
              <div className="sa-related-top">
                <span className={`sa-type-badge sa-type-${it.surveyType}`}>
                  {TYPE_LABELS[it.surveyType] || it.surveyType}
                </span>
                <span className={`sa-status-badge sa-status-${it.status}`}>
                  {STATUS_LABELS[it.status] || it.status}
                </span>
                <span className="sa-related-time">{formatShort(it.createdAt)}</span>
              </div>
              {summary && <div className="sa-related-summary">{summary}</div>}
              {(it.memo || photoCount > 0) && (
                <div className="sa-related-meta">
                  {photoCount > 0 && <span>사진 {photoCount}</span>}
                  {it.memo && <span className="sa-related-memo">메모 있음</span>}
                </div>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
