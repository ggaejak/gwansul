import { useState } from 'react'
import Nav from '../components/Nav'
import ARTICLES_DATA from '../data/articles.json'

// TODO: 서버 연결 후 API 인증으로 교체
const ADMIN_PASSWORD = 'gwansul2024'

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const [title, setTitle] = useState('')
  const [pdfFile, setPdfFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadDone, setUploadDone] = useState(false)

  const [articles, setArticles] = useState(ARTICLES_DATA)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const handleLogin = (e) => {
    e.preventDefault()
    if (password === ADMIN_PASSWORD) {
      setAuthenticated(true)
    } else {
      setError('비밀번호가 올바르지 않습니다')
      setPassword('')
    }
  }

  const handleUpload = async (e) => {
    e.preventDefault()
    if (!title || !pdfFile) return
    setUploading(true)
    // TODO: R2 연동 후 실제 업로드 로직으로 교체
    setTimeout(() => {
      setUploading(false)
      setUploadDone(true)
      setTitle('')
      setPdfFile(null)
    }, 800)
  }

  const handleDelete = (article) => {
    setDeleteTarget(article)
  }

  const confirmDelete = () => {
    // TODO: R2 연동 후 실제 삭제 API 호출로 교체
    setArticles(prev => prev.filter(a => a.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  if (!authenticated) {
    return (
      <>
        <Nav />
        <div className="admin-login-page">
          <div className="admin-login-box">
            <div className="section-number">ADMIN</div>
            <h1 className="admin-login-title">관리자 접속</h1>
            <form onSubmit={handleLogin} className="admin-form">
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                placeholder="비밀번호"
                className="admin-input"
                autoFocus
              />
              {error && <p className="form-error">{error}</p>}
              <button type="submit" className="admin-btn">확인</button>
            </form>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Nav />
      <div className="admin-page">

        {/* 업로드 섹션 */}
        <div className="admin-upload-box">
          <div className="section-number">ADMIN</div>
          <h1 className="section-title">아티클 업로드</h1>

          <form onSubmit={handleUpload} className="upload-form">
            <div className="form-group">
              <label className="form-label">제목</label>
              <input
                type="text"
                value={title}
                onChange={e => { setTitle(e.target.value); setUploadDone(false) }}
                placeholder="아티클 제목을 입력하세요"
                className="admin-input"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">PDF 파일</label>
              <div
                className={`file-upload-area ${pdfFile ? 'has-file' : ''}`}
                onClick={() => document.getElementById('pdfInput').click()}
              >
                {pdfFile
                  ? <><span className="file-icon">⬚</span><span className="file-name">{pdfFile.name}</span></>
                  : <span className="file-placeholder">클릭하여 PDF 파일 선택</span>
                }
              </div>
              <input
                id="pdfInput"
                type="file"
                accept=".pdf"
                onChange={e => { setPdfFile(e.target.files[0]); setUploadDone(false) }}
                style={{ display: 'none' }}
              />
            </div>

            {uploadDone && (
              <p className="form-success">업로드가 완료됐습니다 — R2 연동 후 실제 저장됩니다</p>
            )}

            <button
              type="submit"
              className="admin-btn"
              disabled={uploading || !title || !pdfFile}
            >
              {uploading ? '업로드 중...' : '업로드'}
            </button>
          </form>
        </div>

        {/* 아티클 목록 섹션 */}
        <div className="admin-upload-box">
          <h2 className="section-title" style={{ fontSize: '1.4rem' }}>아티클 관리</h2>
          <div className="admin-article-list">
            {articles.map((article, idx) => (
              <div key={article.id} className="admin-article-row">
                <span className="article-index">{String(idx + 1).padStart(2, '0')}</span>
                <div className="admin-article-info">
                  <span className="article-title">{article.title}</span>
                  <span className="article-date">{article.date}</span>
                </div>
                <span className={`admin-pdf-status ${article.pdfUrl ? 'has-pdf' : 'no-pdf'}`}>
                  {article.pdfUrl ? 'PDF 있음' : 'PDF 없음'}
                </span>
                <button
                  className="admin-delete-btn"
                  onClick={() => handleDelete(article)}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 삭제 확인 모달 */}
      {deleteTarget && (
        <div className="pdf-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="admin-confirm-modal" onClick={e => e.stopPropagation()}>
            <p className="admin-confirm-text">아래 아티클을 삭제하시겠습니까?</p>
            <p className="admin-confirm-title">"{deleteTarget.title}"</p>
            <div className="admin-confirm-buttons">
              <button className="admin-btn-cancel" onClick={() => setDeleteTarget(null)}>취소</button>
              <button className="admin-btn-danger" onClick={confirmDelete}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
