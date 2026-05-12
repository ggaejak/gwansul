// 미검토 조사 상세 패널 (우측).
//
// 구성:
//   - 헤더: 유형/상태 배지 + 입력 시각 + ID
//   - 사진 갤러리
//   - 정제 입력 값 (PayloadView) — 한글 라벨 + 메모
//   - 위치 미니맵
//   - 같은 건물의 다른 조사
//   - 원시 row (접힘) — 디버깅/검증용
//   - [readOnly=false] 정제 폼(CurationForm) + 액션(ReviewActions)
//   - [readOnly=true]  상단에 read-only 표시, 액션 영역 숨김
//
// readOnly:
//   SurveyReadOnlyModal 안에서 검토 완료/다른 페이지 항목을 보여줄 때 true.
//   액션 영역은 숨김. 헤더에 read-only 안내.

import { useEffect, useState } from 'react'
import { TYPE_LABELS, STATUS_LABELS } from '../../lib/surveyLabels'
import { approveSurvey, rejectSurvey, adminDeleteSurvey } from '../../data/surveys'
import { ADMIN_PASSWORD } from '../../lib/adminAuth'
import PayloadView from './PayloadView'
import PhotoGallery from './PhotoGallery'
import MiniMap from './MiniMap'
import RelatedSurveys from './RelatedSurveys'
import CurationForm from './CurationForm'
import ReviewActions from './ReviewActions'

function formatDateTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      year:   'numeric',
      month:  '2-digit',
      day:    '2-digit',
      hour:   '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}

function shortId(id) {
  if (!id) return ''
  return id.slice(0, 8)
}

// payload(raw) → CurationForm prefill 값 (curated 컬럼 형상).
//   first_floor_use 가 array 면 첫 원소를 단일로 픽업 (curated_buildings 는 단일 컬럼).
function payloadToCurated(surveyType, payload, memo) {
  const p = payload || {}
  const baseMemo = memo || null
  if (surveyType === 'building') {
    const ffu = Array.isArray(p.first_floor_use) ? p.first_floor_use[0] : p.first_floor_use
    return {
      firstFloorUse: ffu ?? null,
      isVacant:      p.is_vacant ?? null,
      adminMemo:     baseMemo,
    }
  }
  if (surveyType === 'road') {
    return {
      nightBrightness: p.night_brightness ?? null,
      roadWidth:       p.road_width ?? null,
      adminMemo:       baseMemo,
    }
  }
  if (surveyType === 'point') {
    return {
      category:  p.category ?? null,
      adminMemo: baseMemo,
    }
  }
  return {}
}

function canApproveForm(surveyType, curated) {
  if (surveyType === 'point') return !!curated?.category
  return true
}

export default function SurveyDetailPanel({
  survey,
  onSelectRelated,
  onReviewed,
  onDeleted,
  readOnly = false,
}) {
  // 폼 상태 — survey 가 바뀌면 prefill 재계산.
  const [curated, setCurated] = useState({})
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (!survey) {
      setCurated({})
    } else {
      setCurated(payloadToCurated(survey.surveyType, survey.payload, survey.memo))
    }
    setActionError('')
  }, [survey?.id, survey?.surveyType])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!survey) {
    return (
      <div className="sa-detail-empty">
        <div className="sa-empty-tag">DETAIL</div>
        <h2 className="sa-empty-title">목록에서 조사 항목을 선택하세요</h2>
        <p className="sa-empty-desc">
          좌측의 미검토 목록에서 항목을 클릭하면 여기에 상세가 표시됩니다.
        </p>
      </div>
    )
  }

  const {
    id, surveyType, status, location,
    buildingId, buildingPnu,
    payload, memo, photoPaths,
    createdAt, updatedAt, rejectReason,
  } = survey

  const showActions = !readOnly && status === 'pending'

  const handleApprove = async () => {
    setBusy(true)
    setActionError('')
    try {
      await approveSurvey({
        surveyId:   id,
        surveyType,
        password:   ADMIN_PASSWORD,
        curated,
      })
      onReviewed && onReviewed({ action: 'approved', id })
    } catch (e) {
      setActionError(e?.message || '승인 실패')
    } finally {
      setBusy(false)
    }
  }

  const handleReject = async (reason) => {
    setBusy(true)
    setActionError('')
    try {
      await rejectSurvey({ surveyId: id, reason, password: ADMIN_PASSWORD })
      onReviewed && onReviewed({ action: 'rejected', id })
    } catch (e) {
      setActionError(e?.message || '반려 실패')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    // 2 단계 확인 — 되돌릴 수 없음.
    const warn1 = '이 조사 데이터를 영구 삭제합니다.'
      + (status === 'approved' ? '\n승인된 데이터입니다. 정제(curated) 결과의 source 에서도 제거됩니다.' : '')
      + (status === 'approved' || status === 'rejected' ? '\n사진까지 모두 삭제됩니다.' : '')
      + '\n\n계속하시겠어요?'
    if (!window.confirm(warn1)) return
    if (!window.confirm('되돌릴 수 없습니다. 정말 진행하시겠어요?')) return

    setBusy(true)
    setActionError('')
    try {
      const r = await adminDeleteSurvey({ surveyId: id, password: ADMIN_PASSWORD })
      onDeleted && onDeleted({ id, curatedCleaned: r.curatedCleaned })
    } catch (e) {
      setActionError(e?.message || '삭제 실패')
      setBusy(false)
    }
    // 성공 시 부모가 이 패널을 언마운트 (selectedId 비움) → busy 리셋 불필요
  }

  return (
    <div className="sa-detail">
      <header className="sa-detail-header">
        <div className="sa-detail-badges">
          <span className={`sa-type-badge sa-type-${surveyType}`}>
            {TYPE_LABELS[surveyType] || surveyType}
          </span>
          <span className={`sa-status-badge sa-status-${status || 'pending'}`}>
            {STATUS_LABELS[status] || status || '미검토'}
          </span>
          {readOnly && <span className="sa-readonly-tag">READ ONLY</span>}
        </div>
        <div className="sa-detail-meta">
          <span>입력: {formatDateTime(createdAt)}</span>
          {updatedAt && updatedAt !== createdAt && (
            <span> · 수정: {formatDateTime(updatedAt)}</span>
          )}
          <span className="sa-detail-id">ID {shortId(id)}</span>
        </div>
      </header>

      <section className="sa-section">
        <h3 className="sa-section-title">입력 값</h3>
        <PayloadView surveyType={surveyType} payload={payload} memo={memo} />
      </section>

      <section className="sa-section">
        <h3 className="sa-section-title">
          사진 <span className="sa-section-count">{(photoPaths || []).length}</span>
        </h3>
        <PhotoGallery paths={photoPaths} />
      </section>

      <section className="sa-section">
        <h3 className="sa-section-title">위치</h3>
        <MiniMap lng={location?.lng} lat={location?.lat} />
        <div className="sa-loc-text">
          {location && typeof location.lng === 'number'
            ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`
            : '좌표 정보 없음'}
          {buildingPnu && <span> · PNU {buildingPnu}</span>}
          {buildingId != null && <span> · 건물 ID {buildingId}</span>}
        </div>
      </section>

      {status === 'rejected' && rejectReason && (
        <section className="sa-section">
          <h3 className="sa-section-title">반려 사유</h3>
          <div className="sa-reject-reason">{rejectReason}</div>
        </section>
      )}

      <section className="sa-section">
        <h3 className="sa-section-title">같은 건물의 다른 조사</h3>
        <RelatedSurveys
          buildingId={buildingId}
          buildingPnu={buildingPnu}
          excludeId={id}
          onSelect={onSelectRelated}
        />
      </section>

      {showActions && (
        <section className="sa-section sa-action-section">
          <h3 className="sa-section-title">정제 + 검토</h3>
          <p className="sa-action-hint">
            아래 값은 원시 입력으로 prefill 되어 있습니다.
            그대로 두면 원본 그대로 승인, 수정하면 수정값으로 curated 에 저장됩니다.
          </p>
          <CurationForm
            surveyType={surveyType}
            value={curated}
            onChange={setCurated}
            disabled={busy}
          />
          {actionError && !readOnly && <div className="sa-action-error">{actionError}</div>}
          <ReviewActions
            busy={busy}
            canApprove={canApproveForm(surveyType, curated)}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        </section>
      )}

      {/* 관리자 위험 영역 — 모든 상태에서 노출. readOnly 모달에서도 표시. */}
      {onDeleted && (
        <section className="sa-section sa-danger-section">
          <h3 className="sa-section-title sa-danger-title">위험 영역 — 영구 삭제</h3>
          <p className="sa-action-hint">
            조사 데이터와 사진을 완전히 삭제합니다. 되돌릴 수 없습니다.
            {status === 'approved' && ' 정제(curated) 결과의 source 에서도 자동 제거됩니다.'}
          </p>
          {actionError && showActions === false && (
            <div className="sa-action-error">{actionError}</div>
          )}
          <div className="sa-action-buttons sa-danger-buttons">
            <button
              type="button"
              className="sa-btn-danger-ghost"
              onClick={handleDelete}
              disabled={busy}
            >
              {busy ? '처리 중…' : '이 조사 데이터 삭제'}
            </button>
          </div>
        </section>
      )}

      <details className="sa-raw-details">
        <summary>원시 payload (JSON)</summary>
        <pre className="sa-raw-json">{JSON.stringify(payload || {}, null, 2)}</pre>
      </details>
    </div>
  )
}
