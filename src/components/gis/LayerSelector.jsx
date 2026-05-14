// 전체 보기 모드의 "표시 레이어" 토글.
//
// 반경 분석 모드와 달리 통계가 의미 없으므로 시각화만 선택.
// pedshed/demo/commerce/transit 은 반경 의존이라 제외.
//
// controlled component:
//   - value(visibleSection), onChange : 레이어 단일 선택 (상호 배타)
//   - surveyTypes, onSurveyTypesChange : '현장조사' 활성 시 3 종 sub-toggle
//
// 현장조사 레이어는 다른 색 레이어들과 상호 배타. 활성 시 sub-toggle 펼침.

import '../../styles/gis-layer-selector.css'

const LAYERS = [
  { code: 'intensity', label: '개발 강도', desc: '용적률 색상' },
  { code: 'figground', label: '도시 형태', desc: 'Figure-Ground' },
  { code: 'landuse',   label: '용도지역', desc: '주거 · 상업 · 녹지' },
  { code: 'history',   label: '건물 연령', desc: '준공년도' },
  { code: 'heritage',  label: '랜드마크', desc: '역사 건축' },
  { code: 'survey',    label: '현장조사', desc: '건물 · 점 · 도로' },
]

const SURVEY_SUB_TOGGLES = [
  { code: 'building', label: '건물조사', color: '#1e88e5' },
  { code: 'point',    label: '점조사',   color: '#8e24aa' },
  { code: 'road',     label: '도로조사', color: '#fb8c00' },
]

export default function LayerSelector({
  value,
  onChange,
  surveyTypes = { building: true, point: true, road: true },
  onSurveyTypesChange,
}) {
  return (
    <div className="g-layer-selector">
      <div className="g-layer-title">표시 레이어</div>
      <ul className="g-layer-list">
        {LAYERS.map(l => (
          <li key={l.code}>
            <button
              type="button"
              className={`g-layer-btn ${value === l.code ? 'active' : ''}`}
              // active 한 항목을 다시 누르면 'none' 으로 토글 (모든 시각화 끔)
              onClick={() => onChange(value === l.code ? 'none' : l.code)}
              aria-pressed={value === l.code}
            >
              <span className="g-layer-label">{l.label}</span>
              <span className="g-layer-desc">{l.desc}</span>
            </button>

            {/* 현장조사 활성 시 sub-toggle 펼침 */}
            {l.code === 'survey' && value === 'survey' && (
              <div className="g-survey-subtoggles" role="group" aria-label="현장조사 유형">
                {SURVEY_SUB_TOGGLES.map(st => {
                  const on = !!surveyTypes[st.code]
                  return (
                    <button
                      key={st.code}
                      type="button"
                      className={`g-survey-chip ${on ? 'on' : ''}`}
                      onClick={() => onSurveyTypesChange?.({
                        ...surveyTypes,
                        [st.code]: !on,
                      })}
                      aria-pressed={on}
                      style={on ? { '--chip-color': st.color } : undefined}
                    >
                      <span className="g-survey-dot" />
                      {st.label}
                    </button>
                  )
                })}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
