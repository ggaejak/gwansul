// 전체 보기 모드의 "표시 레이어" 토글.
//
// 반경 분석 모드와 달리 통계가 의미 없으므로 시각화만 선택.
// pedshed/demo/commerce/transit 은 반경 의존이라 제외.
//
// controlled component: value(visibleSection), onChange.

import '../../styles/gis-layer-selector.css'

const LAYERS = [
  { code: 'intensity', label: '개발 강도', desc: '용적률 색상' },
  { code: 'figground', label: '도시 형태', desc: 'Figure-Ground' },
  { code: 'landuse',   label: '용도지역', desc: '주거 · 상업 · 녹지' },
  { code: 'history',   label: '건물 연령', desc: '준공년도' },
  { code: 'heritage',  label: '랜드마크', desc: '역사 건축' },
]

export default function LayerSelector({ value, onChange }) {
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
          </li>
        ))}
      </ul>
    </div>
  )
}
