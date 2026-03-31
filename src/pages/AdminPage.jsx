import { useState, useEffect } from 'react'
import Nav from '../components/Nav'

const API_URL = 'https://orange-cherry-8597.gwansul743.workers.dev'
const ADMIN_PASSWORD = 'Gwansul8&'

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const [title, setTitle] = useState('')
  const [pdfFile, setPdfFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadDone, setUploadDone] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const [articles, setArticles] = useState([])
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const fetchArticles = () => {
    fetch(`${API_URL}/api/articles`)
      .then(res => res.json())
      .then(data => setArticles(data))
      .catch(() => setArticles([]))
  }

  useEffect(() => {
    if (authenticated) fetchArticles()
  }, [authenticated])

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
    setUploadError('')
    try {
      const formData = new FormData()
      formData.append('title', title)
      formData.append('pdf', pdfFile)
      const res = await fetch(`${API_URL}/api/articles`, {
        method: 'POST',
        headers: { Authorization: ADMIN_PASSWORD },
        body: formData,
      })
      if (!res.ok) throw new Error()
      setUploadDone(true)
      setTitle('')
      setPdfFile(null)
      fetchArticles()
    } catch {
      setUploadError('업로드에 실패했습니다. 다시 시도해주세요.')
    } finally {
      setUploading(false)
    }
  }

  const confirmDelete = async () => {
    setDeleting(true)
    try {
      await fetch(`${API_URL}/api/articles/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: ADMIN_PASSWORD },
      })
      setDeleteTarget(null)
      fetchArticles()
    } catch {
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
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
                onChange={e => { setTitle(e.target.value); setUploadDone(false); setUploadError('') }}
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
                onChange={e => { setPdfFile(e.target.files[0]); setUploadDone(false); setUploadError('') }}
                style={{ display: 'none' }}
              />
            </div>

            {uploadDone && <p className="form-success">업로드가 완료됐습니다</p>}
            {uploadError && <p className="form-error">{uploadError}</p>}

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
            {articles.length === 0 ? (
              <p style={{ color: '#999', textAlign: 'center', padding: '2rem 0' }}>등록된 아티클이 없습니다</p>
            ) : articles.map((article, idx) => (
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
                  onClick={() => setDeleteTarget(article)}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {deleteTarget && (
        <div className="pdf-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="admin-confirm-modal" onClick={e => e.stopPropagation()}>
            <p className="admin-confirm-text">아래 아티클을 삭제하시겠습니까?</p>
            <p className="admin-confirm-title">"{deleteTarget.title}"</p>
            <div className="admin-confirm-buttons">
              <button className="admin-btn-cancel" onClick={() => setDeleteTarget(null)}>취소</button>
              <button className="admin-btn-danger" onClick={confirmDelete} disabled={deleting}>
                {deleting ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
