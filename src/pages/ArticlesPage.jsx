import { useState, useEffect } from 'react'
import Nav from '../components/Nav'
import Footer from '../components/Footer'
import ARTICLES_DATA from '../data/articles.json'

const PER_PAGE = 10

export default function ArticlesPage() {
  const [page, setPage] = useState(1)
  const [selectedArticle, setSelectedArticle] = useState(null)

  const totalPages = Math.ceil(ARTICLES_DATA.length / PER_PAGE)
  const currentArticles = ARTICLES_DATA.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible') }),
      { threshold: 0.1 }
    )
    document.querySelectorAll('.fade-in').forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [page])

  useEffect(() => {
    if (selectedArticle) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [selectedArticle])

  return (
    <>
      <Nav />
      <section className="articles-page">
          <div className="articles-header">
            <div className="section-number fade-in">아티클</div>
            <h1 className="section-title fade-in">관설의 현장 기록과<br />도시운영 인사이트</h1>
            <p className="section-subtitle fade-in">
              현장에서 발견한 문제와 도시운영에 관한 관설의 기록입니다
            </p>
          </div>

          <div className="articles-list fade-in">
            {currentArticles.map((article, idx) => (
              <div
                key={article.id}
                className="article-row"
                onClick={() => setSelectedArticle(article)}
              >
                <span className="article-index">
                  {String((page - 1) * PER_PAGE + idx + 1).padStart(2, '0')}
                </span>
                <span className="article-title">{article.title}</span>
                <span className="article-date">{article.date}</span>
                <span className="article-arrow">→</span>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="articles-pagination">
              <button
                className="page-btn"
                onClick={() => { setPage(p => p - 1); window.scrollTo(0, 0) }}
                disabled={page === 1}
              >←</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  className={`page-btn ${p === page ? 'active' : ''}`}
                  onClick={() => { setPage(p); window.scrollTo(0, 0) }}
                >{p}</button>
              ))}
              <button
                className="page-btn"
                onClick={() => { setPage(p => p + 1); window.scrollTo(0, 0) }}
                disabled={page === totalPages}
              >→</button>
            </div>
          )}
      </section>

      {selectedArticle && (
        <div className="pdf-overlay" onClick={() => setSelectedArticle(null)}>
          <div className="pdf-modal" onClick={e => e.stopPropagation()}>
            <div className="pdf-modal-header">
              <div>
                <p className="pdf-modal-date">{selectedArticle.date}</p>
                <h2 className="pdf-modal-title">{selectedArticle.title}</h2>
              </div>
              <button className="pdf-close" onClick={() => setSelectedArticle(null)}>✕</button>
            </div>
            <div className="pdf-viewer">
              {selectedArticle.pdfUrl ? (
                <iframe src={selectedArticle.pdfUrl} title={selectedArticle.title} />
              ) : (
                <div className="pdf-placeholder">
                  <p className="pdf-preparing">준비 중입니다</p>
                  <p className="pdf-preparing-sub">곧 업로드될 예정입니다</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <Footer />
    </>
  )
}
