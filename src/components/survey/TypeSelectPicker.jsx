// 어느 점이든 탭 시 표시되는 조사 유형 선택 시트.
//
// 건물 / 도로 / 일반 점 셋 중 하나를 고르면 SurveyForm 으로 진입.
// 위치(lng/lat) 는 호출 측이 전달 — 변경 불가 (탭한 좌표 그대로 INSERT).
// 좌표 우선 모드: 건물 조사도 building_id/pnu 없이 좌표 단독으로 INSERT.

const BUILDING_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
    <path d="M4 21V9l8-6 8 6v12H4z" />
    <path d="M9 21v-7h6v7" />
  </svg>
)

const ROAD_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" width="24" height="24">
    <path d="M5 4v16M19 4v16" />
    <path d="M12 5v3M12 11v3M12 17v3" />
  </svg>
)

const POINT_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
    <circle cx="12" cy="12" r="6" />
  </svg>
)

export default function TypeSelectPicker({ location, onPick, onCancel }) {
  return (
    <>
      <div className="sv-pick-backdrop" onClick={onCancel} />
      <div className="sv-pick-sheet" role="dialog" aria-modal="true" aria-label="조사 유형 선택">
        <div className="sv-sheet-handle" />

        <header className="sv-pick-header">
          <h2 className="sv-pick-title">조사 유형 선택</h2>
          <div className="sv-pick-coords">
            {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
          </div>
        </header>

        <div className="sv-pick-options">
          <button type="button" className="sv-pick-btn" onClick={() => onPick('building')}>
            <span className="sv-pick-icon sv-pick-icon-building">{BUILDING_ICON}</span>
            <div className="sv-pick-text">
              <strong>건물 조사</strong>
              <small>1층 업종 / 층 수 / 공실 / 사진</small>
            </div>
          </button>
          <button type="button" className="sv-pick-btn" onClick={() => onPick('road')}>
            <span className="sv-pick-icon sv-pick-icon-road">{ROAD_ICON}</span>
            <div className="sv-pick-text">
              <strong>도로 조사</strong>
              <small>야간 밝기 / 도로 폭</small>
            </div>
          </button>
          <button type="button" className="sv-pick-btn" onClick={() => onPick('point')}>
            <span className="sv-pick-icon sv-pick-icon-point">{POINT_ICON}</span>
            <div className="sv-pick-text">
              <strong>일반 점 조사</strong>
              <small>화장실 / 흡연구역 / 소음 / 냄새 / 기타</small>
            </div>
          </button>
        </div>

        <footer className="sv-pick-footer">
          <button type="button" className="sv-btn-secondary" onClick={onCancel}>
            취소
          </button>
        </footer>
      </div>
    </>
  )
}
