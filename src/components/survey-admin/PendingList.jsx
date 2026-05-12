// 미검토 조사 목록 (좌측 패널).
//
// - 상단: 유형 필터 (전체 / 건물 / 도로 / 점)
// - 본문: 항목 카드 (유형, 주소/좌표, 입력 시각, 사진 개수)
// - 하단: 페이지네이션 (10건씩)
//
// 데이터 fetch / 상태 관리는 부모(SurveyAdminPage) 가 담당.
// 이 컴포넌트는 표시 + 이벤트 위임만.

import { TYPE_LABELS } from '../../lib/surveyLabels'

const TYPE_FILTERS = [
  { code: null,       label: '전체' },
  { code: 'building', label: '건물' },
  { code: 'road',     label: '도로' },
  { code: 'point',    label: '점' },
]

function formatDateTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const yyyy = d.getFullYear()
    const mm   = String(d.getMonth() + 1).padStart(2, '0')
    const dd   = String(d.getDate()).padStart(2, '0')
    const hh   = String(d.getHours()).padStart(2, '0')
    const mi   = String(d.getMinutes()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
  } catch {
    return iso
  }
}

function describeLocation(item) {
  if (item.buildingPnu) return `PNU ${item.buildingPnu}`
  const l = item.location
  if (l && typeof l.lng === 'number' && typeof l.lat === 'number') {
    return `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`
  }
  return '위치 미상'
}

export default function PendingList({
  items,
  loading,
  totalCount,
  page,
  pageSize,
  typeFilter,
  selectedId,
  onSelect,
  onPageChange,
  onTypeChange,
}) {
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 1
  const startIdx   = totalCount === 0 ? 0 : page * pageSize + 1
  const endIdx     = Math.min((page + 1) * pageSize, totalCount)

  return (
    <div className="sa-list">
      <div className="sa-list-filters">
        {TYPE_FILTERS.map(f => (
          <button
            key={String(f.code)}
            type="button"
            className={`sa-chip ${typeFilter === f.code ? 'active' : ''}`}
            onClick={() => onTypeChange(f.code)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="sa-list-meta">
        {loading
          ? '불러오는 중…'
          : totalCount === 0
            ? '미검토 항목 없음'
            : `${startIdx}–${endIdx} / ${totalCount}건`}
      </div>

      <ul className="sa-list-items">
        {items.map(item => {
          const active = item.id === selectedId
          const photoCount = (item.photoPaths || []).length
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`sa-list-item ${active ? 'active' : ''}`}
                onClick={() => onSelect(item.id)}
              >
                <div className="sa-list-item-top">
                  <span className={`sa-type-badge sa-type-${item.surveyType}`}>
                    {TYPE_LABELS[item.surveyType] || item.surveyType}
                  </span>
                  {photoCount > 0 && (
                    <span className="sa-photo-count">사진 {photoCount}</span>
                  )}
                </div>
                <div className="sa-list-item-loc">{describeLocation(item)}</div>
                <div className="sa-list-item-time">{formatDateTime(item.createdAt)}</div>
              </button>
            </li>
          )
        })}
      </ul>

      {totalPages > 1 && (
        <div className="sa-pagination">
          <button
            type="button"
            className="sa-page-btn"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 0 || loading}
          >
            이전
          </button>
          <span className="sa-page-indicator">{page + 1} / {totalPages}</span>
          <button
            type="button"
            className="sa-page-btn"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages - 1 || loading}
          >
            다음
          </button>
        </div>
      )}
    </div>
  )
}
