// 조사 마커 클릭 시 표시되는 하단 시트.
//
// props:
//   feature  : GeoJSON Feature (camelCase properties) | null
//   onClose  : () => void
//   onEdit   : (feature) => void   — pending 일 때만 호출 가능
//   onDelete : (feature) => Promise<void>  — pending 일 때만 호출. 부모가 confirm + delete + refresh.
//
// pending 상태가 아니면 [수정] / [삭제] 버튼 숨김 (열람만).
// 사진은 photoPaths → getPhotoUrl 로 public URL 변환 (Storage public bucket 가정).

import { getPhotoUrl } from '../../data/surveys'
import {
  STATUS_LABELS,
  TYPE_LABELS,
  describePayload,
  getEntranceLocations,
} from '../../lib/surveyLabels'

function formatDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString('ko-KR', {
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

function formatLatLng(geometry) {
  const c = geometry?.coordinates
  if (!c || c.length < 2) return '-'
  return `${c[1].toFixed(6)}, ${c[0].toFixed(6)}`
}

export default function SurveyDetailSheet({ feature, onClose, onEdit, onDelete }) {
  if (!feature) return null

  const p = feature.properties || {}
  const status     = p.status || 'pending'
  const surveyType = p.surveyType
  const isEditable = status === 'pending'

  const fields = describePayload(surveyType, p.payload)
  const photoUrls = (p.photoPaths || []).map(path => ({
    path,
    url: getPhotoUrl(path),
  })).filter(x => x.url)

  return (
    <>
      <div className="sv-sheet-backdrop" onClick={onClose} />
      <div className="sv-sheet" role="dialog" aria-modal="true" aria-label="조사 상세">
        <div className="sv-sheet-handle" />

        <header className="sv-sheet-header">
          <div className="sv-sheet-title-line">
            <span className="sv-sheet-type">{TYPE_LABELS[surveyType] || '조사'}</span>
            <span className={`sv-sheet-status sv-status-${status}`}>
              {STATUS_LABELS[status] || status}
            </span>
          </div>
          <div className="sv-sheet-meta">
            <span>입력: {formatDate(p.createdAt)}</span>
            {p.updatedAt && p.updatedAt !== p.createdAt && (
              <span> · 수정: {formatDate(p.updatedAt)}</span>
            )}
          </div>
        </header>

        <div className="sv-sheet-body">
          {photoUrls.length > 0 && (
            <div className="sv-sheet-photos">
              {photoUrls.map(({ path, url }) => (
                <a
                  key={path}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="sv-sheet-photo"
                >
                  <img src={url} alt="조사 사진" loading="lazy" />
                </a>
              ))}
            </div>
          )}

          {fields.length > 0 && (
            <dl className="sv-sheet-fields">
              {fields.map(({ label, value }) => (
                <div key={label} className="sv-sheet-row">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}

          {p.memo && (
            <div className="sv-sheet-memo">
              <div className="sv-sheet-memo-label">메모</div>
              <p>{p.memo}</p>
            </div>
          )}

          {p.buildingPnu && (
            <div className="sv-sheet-row sv-sheet-row-aux">
              <dt>건물 PNU</dt>
              <dd>{p.buildingPnu}</dd>
            </div>
          )}

          <div className="sv-sheet-row sv-sheet-row-aux">
            <dt>위치</dt>
            <dd className="sv-sheet-coords">{formatLatLng(feature.geometry)}</dd>
          </div>

          {surveyType === 'building' && (() => {
            const ents = getEntranceLocations(p.payload)
            return (
              <div className="sv-sheet-row sv-sheet-row-aux">
                <dt>건물 입구{ents.length > 1 && ` (${ents.length})`}</dt>
                <dd className="sv-sheet-coords">
                  {ents.length === 0
                    ? '미지정'
                    : ents.map((e, i) => (
                        <div key={i}>{e.lat.toFixed(6)}, {e.lng.toFixed(6)}</div>
                      ))}
                </dd>
              </div>
            )
          })()}

          {status === 'rejected' && p.rejectReason && (
            <div className="sv-sheet-reject">
              <div className="sv-sheet-memo-label">반려 사유</div>
              <p>{p.rejectReason}</p>
            </div>
          )}
        </div>

        <footer className="sv-sheet-footer">
          {isEditable && onDelete && (
            <button
              type="button"
              className="sv-btn-danger-ghost"
              onClick={() => onDelete(feature)}
            >
              삭제
            </button>
          )}
          <div className="sv-sheet-footer-right">
            <button type="button" className="sv-btn-secondary" onClick={onClose}>
              닫기
            </button>
            {isEditable && (
              <button type="button" className="sv-btn-primary" onClick={() => onEdit(feature)}>
                수정
              </button>
            )}
          </div>
        </footer>
      </div>
    </>
  )
}
