import { useState, useEffect } from 'react'
import Nav from '../components/Nav'
import Footer from '../components/Footer'

// TODO: 서버 연결 후 API로 교체
const MOCK_ARTICLES = [
  { id: 1,  title: '도시를 운영 시스템으로 — 관설의 접근 방식', date: '2025.01.14' },
  { id: 2,  title: '충남 태안군 빈집 실태조사 현장 기록', date: '2024.12.30' },
  { id: 3,  title: '공공 공간의 소유 구조 전환 사례 연구', date: '2024.12.10' },
  { id: 4,  title: '도시 열섬 현상과 녹지 배치 전략', date: '2024.11.22' },
  { id: 5,  title: 'GIS 기반 현장 데이터 수집 방법론', date: '2024.11.05' },
  { id: 6,  title: '장기 방치 공간의 재활용 가능성 분석', date: '2024.10.18' },
  { id: 7,  title: '도시 운영 지표 설계 — 무엇을 측정할 것인가', date: '2024.10.01' },
  { id: 8,  title: '지방 소도시 인구 감소와 공간 재편 전략', date: '2024.09.15' },
  { id: 9,  title: '관설 프로젝트 회고 — 2024년 상반기', date: '2024.08.28' },
  { id: 10, title: '현장 관측에서 정책 제안까지 — 관설의 프로세스', date: '2024.08.10' },
  { id: 11, title: '도시 데이터 시각화의 원칙', date: '2024.07.24' },
  { id: 12, title: '빈집 활용 커뮤니티 공간 전환 사례', date: '2024.07.06' },
]

const PER_PAGE = 10

export default function ArticlesPage() {
  const [page, setPage] = useState(1)
  const [selectedArticle, setSelectedArticle] = useState(null)

  const totalPages = Math.ceil(MOCK_ARTICLES.length / PER_PAGE)
  const currentArticles = MOCK_ARTICLES.slice((page - 1) * PER_PAGE, page * PER_PAGE)

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
                  <span className="pdf-placeholder-icon">⬚</span>
                  <p>서버 연결 후 PDF가 표시됩니다</p>
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
