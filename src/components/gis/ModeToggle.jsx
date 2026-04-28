// 사이드바 상단의 "분석 ↔ 아티클" 모드 전환 토글.
// 토글 스위치 형태: 양옆 라벨 + 가운데 슬라이드 스위치.
//
// off(왼쪽 = 분석)  ●━━━━━
// on (오른쪽 = 아티클)  ━━━━●
//
// controlled component: mode, onChange 만 받음.

export default function ModeToggle({ mode, onChange }) {
  const isArticles = mode === 'articles'
  return (
    <div className="ga-mode-toggle">
      <span className={`ga-mode-label ${!isArticles ? 'active' : ''}`}>
        📊 분석
      </span>
      <button
        type="button"
        className={`ga-mode-switch ${isArticles ? 'on' : 'off'}`}
        onClick={() => onChange(isArticles ? 'analysis' : 'articles')}
        role="switch"
        aria-checked={isArticles}
        aria-label="모드 전환"
      >
        <span className="ga-mode-thumb" />
      </button>
      <span className={`ga-mode-label ${isArticles ? 'active' : ''}`}>
        📰 아티클
      </span>
    </div>
  )
}
