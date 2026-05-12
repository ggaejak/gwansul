// 검토 액션: 승인 / 반려 버튼 + 반려 사유 입력 모드.
//
// 폼은 항상 CurationForm 으로 prefill 되어 있으므로
// "원본 그대로 승인" 과 "수정 후 승인" 은 폼 값이 바뀌었는지 여부일 뿐이라
// 별도 버튼으로 분리하지 않음. 폼 값을 그대로 부모(SurveyDetailPanel)가 전달.
//
// props:
//   busy        : boolean — 처리 중 (버튼 disable + 라벨 변경)
//   canApprove  : boolean — 폼 유효성 결과 (예: point 의 category 누락 시 false)
//   onApprove   : () => Promise<void>
//   onReject    : (reason: string) => Promise<void>

import { useState } from 'react'

export default function ReviewActions({ busy, canApprove, onApprove, onReject }) {
  const [rejectMode, setRejectMode] = useState(false)
  const [reason, setReason] = useState('')

  const submitReject = async () => {
    if (!reason.trim()) return
    await onReject(reason.trim())
    setReason('')
    setRejectMode(false)
  }

  if (rejectMode) {
    return (
      <div className="sa-reject-mode">
        <label className="sa-form-label" htmlFor="reject-reason">반려 사유 *</label>
        <textarea
          id="reject-reason"
          className="sa-form-textarea"
          rows={3}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="예: 사진 식별 불가, 위치 부정확, 중복 데이터…"
          autoFocus
        />
        <div className="sa-action-buttons">
          <button
            type="button"
            className="sa-btn-secondary"
            onClick={() => { setRejectMode(false); setReason('') }}
            disabled={busy}
          >
            취소
          </button>
          <button
            type="button"
            className="sa-btn-danger"
            onClick={submitReject}
            disabled={busy || !reason.trim()}
          >
            {busy ? '처리 중…' : '반려 확정'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="sa-action-buttons">
      <button
        type="button"
        className="sa-btn-secondary"
        onClick={() => setRejectMode(true)}
        disabled={busy}
      >
        반려
      </button>
      <button
        type="button"
        className="sa-btn-primary"
        onClick={onApprove}
        disabled={busy || !canApprove}
        title={!canApprove ? '필수 정제값을 채워주세요' : ''}
      >
        {busy ? '처리 중…' : '승인'}
      </button>
    </div>
  )
}
