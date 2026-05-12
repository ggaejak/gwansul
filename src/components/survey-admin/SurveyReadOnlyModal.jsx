// 검토 완료(또는 다른 페이지) 조사의 read-only 보기 모달.
//
// "같은 건물의 다른 조사" 클릭 시 현재 페이지 목록 밖에 있으면 이 모달이 뜸.
// fetchSurveyById 로 단건을 가져와서 SurveyDetailPanel(readOnly) 재사용.
//
// 관리자 컨텍스트라 [삭제] 버튼은 readOnly 여부와 무관하게 표시 (위험 영역 섹션).
// 삭제 성공 시 모달 자동 닫힘 + 부모(SurveyAdminPage) 가 목록 갱신.
//
// props:
//   surveyId  : string  — fetch 대상
//   onClose   : () => void
//   onDeleted : ({ id, curatedCleaned }) => void  — 삭제 성공 시 호출

import { useEffect, useState } from 'react'
import { fetchSurveyById } from '../../data/surveys'
import SurveyDetailPanel from './SurveyDetailPanel'

// fetch_survey_by_id 결과(GeoJSON Feature, camelCase properties)를
// SurveyDetailPanel 이 기대하는 flat 객체(PendingList row 형상) 로 변환.
function featureToPanelSurvey(feat) {
  if (!feat) return null
  const p = feat.properties || {}
  const coords = feat.geometry?.coordinates
  return {
    id:           p.id,
    surveyType:   p.surveyType,
    status:       p.status,
    location:     Array.isArray(coords) && coords.length >= 2
                    ? { lng: coords[0], lat: coords[1] }
                    : null,
    buildingId:   p.buildingId,
    buildingPnu:  p.buildingPnu,
    payload:      p.payload || {},
    memo:         p.memo,
    photoPaths:   p.photoPaths || [],
    createdAt:    p.createdAt,
    updatedAt:    p.updatedAt,
    rejectReason: p.rejectReason,
  }
}

export default function SurveyReadOnlyModal({ surveyId, onClose, onDeleted }) {
  const [survey, setSurvey] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetchSurveyById(surveyId)
      .then(feat => {
        if (!alive) return
        const s = featureToPanelSurvey(feat)
        if (!s) {
          setError('조사 데이터를 찾을 수 없습니다')
        } else {
          setSurvey(s)
        }
      })
      .catch(e => { if (alive) setError(e?.message || '불러오기 실패') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [surveyId])

  // ESC 로 닫기
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sa-modal-backdrop" onClick={onClose}>
      <div
        className="sa-modal"
        role="dialog"
        aria-modal="true"
        aria-label="조사 상세 (열람 전용)"
        onClick={e => e.stopPropagation()}
      >
        <header className="sa-modal-header">
          <div>
            <small>READ ONLY</small>
            <h2>조사 상세 (열람)</h2>
          </div>
          <button
            type="button"
            className="sa-modal-close"
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </header>
        <div className="sa-modal-body">
          {loading && <div className="sa-modal-state">불러오는 중…</div>}
          {!loading && error && <div className="sa-modal-state">에러: {error}</div>}
          {!loading && !error && survey && (
            <SurveyDetailPanel
              survey={survey}
              readOnly
              onDeleted={(info) => {
                onDeleted && onDeleted(info)
                onClose()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
