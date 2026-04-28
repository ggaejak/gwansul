// GIS 사이드바 안에서 동작하는 아티클 목록 + 상세 패널.
//
// controlled component:
//   - selectedArticleId: 현재 선택된 아티클 id (null 이면 목록 표시)
//   - onSelectArticle:  선택 변경 콜백 (id 또는 null)
//
// 데이터:
//   - fetchArticles() — module-level 캐시 (src/data/articles.js)
//   - getArticleVisuals(id) — 1차 미사용. 등록 시 PanelExtra 자동 렌더
//
// PDF 표시: 사이드바 안 iframe (사용자 결정 Q2). 패널 너비는
// GisPage 측의 너비 토글(Step 4)이 결정.
//
// CSS 는 Step 5 에서 추가. 클래스 prefix `ga-` (gis-articles).

import { useEffect, useState } from 'react'
import { fetchArticles } from '../../data/articles'
import { getArticleVisuals } from '../../data/articleVisuals'

export default function ArticlePanel({ selectedArticleId, onSelectArticle, panelWide }) {
  const [articles, setArticles] = useState(null)  // null = 로딩 중

  useEffect(() => {
    let cancelled = false
    fetchArticles().then(list => {
      if (!cancelled) setArticles(list)
    })
    return () => { cancelled = true }
  }, [])

  if (articles === null) {
    return <div className="ga-loading">아티클 불러오는 중...</div>
  }

  const selected = selectedArticleId != null
    ? articles.find(a => a.id === selectedArticleId)
    : null

  // selectedArticleId 가 잘못된 값이면(목록에 없음) 자동으로 목록으로
  if (selectedArticleId != null && !selected) {
    return (
      <ArticleList
        articles={articles}
        onSelect={onSelectArticle}
        notice="요청한 아티클을 찾을 수 없습니다"
      />
    )
  }

  if (!selected) {
    return <ArticleList articles={articles} onSelect={onSelectArticle} />
  }

  return (
    <ArticleDetail
      article={selected}
      onBack={() => onSelectArticle(null)}
      panelWide={panelWide}
    />
  )
}

// ─── 목록 ─────────────────────────────────────────────────────

function ArticleList({ articles, onSelect, notice }) {
  if (articles.length === 0) {
    return (
      <div className="ga-empty">
        <p>아직 등록된 아티클이 없습니다</p>
      </div>
    )
  }

  return (
    <div className="ga-list">
      {notice && <div className="ga-notice">{notice}</div>}
      <ul className="ga-list-items">
        {articles.map((article, idx) => (
          <li
            key={article.id}
            className="ga-card"
            onClick={() => onSelect(article.id)}
          >
            <span className="ga-card-index">
              {String(idx + 1).padStart(2, '0')}
            </span>
            <div className="ga-card-body">
              <span className="ga-card-date">{article.date}</span>
              <h3 className="ga-card-title">{article.title}</h3>
            </div>
            {!article.pdfUrl && (
              <span className="ga-card-badge">준비중</span>
            )}
            <span className="ga-card-arrow">→</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── 상세 ─────────────────────────────────────────────────────

function ArticleDetail({ article, onBack, panelWide }) {
  const visuals = getArticleVisuals(article.id)

  return (
    <div className="ga-detail">
      <button type="button" className="ga-back" onClick={onBack}>
        ← 목록으로
      </button>

      <div className="ga-detail-meta">
        <span className="ga-detail-date">{article.date}</span>
        <h2 className="ga-detail-title">{article.title}</h2>
      </div>

      {article.pdfUrl ? (
        <div className="ga-pdf-frame">
          <iframe
            // 패널 너비가 바뀌면 iframe 을 재마운트해 PDF 뷰어가
            // 새 컨테이너 너비에 맞춰 다시 fit 하도록 함.
            key={`${article.id}-${panelWide ? 'wide' : 'narrow'}`}
            src={`${article.pdfUrl}#view=FitH`}
            title={article.title}
          />
        </div>
      ) : (
        <div className="ga-pdf-placeholder">
          <p className="ga-pdf-preparing">준비 중입니다</p>
          <p className="ga-pdf-preparing-sub">곧 업로드될 예정입니다</p>
        </div>
      )}

      {/* articleVisuals.js 에 등록된 추가 컴포넌트 (1차 미사용) */}
      {visuals?.PanelExtra && (
        <div className="ga-detail-extra">
          <visuals.PanelExtra article={article} />
        </div>
      )}
    </div>
  )
}
