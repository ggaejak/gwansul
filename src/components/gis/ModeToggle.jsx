// 사이드바 상단의 "분석 ↔ 아티클" 모드 전환 토글.
// 기존 g-view-toggle-fixed (반경 분석 / 전체 보기) 위에 위치.
//
// controlled component: mode, onChange 만 받음.
// CSS 는 Step 5 에서 추가.

export default function ModeToggle({ mode, onChange }) {
  return (
    <div className="ga-mode-toggle">
      <button
        type="button"
        className={`ga-mode-btn ${mode === 'analysis' ? 'active' : ''}`}
        onClick={() => onChange('analysis')}
        aria-pressed={mode === 'analysis'}
      >
        📊 분석
      </button>
      <button
        type="button"
        className={`ga-mode-btn ${mode === 'articles' ? 'active' : ''}`}
        onClick={() => onChange('articles')}
        aria-pressed={mode === 'articles'}
      >
        📰 아티클
      </button>
    </div>
  )
}
