import { useState } from 'react'
import Nav from '../components/Nav'

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
    // TODO: 서버 연결 후 아래 로직을 API 호출로 교체
    // const formData = new FormData()
    // formData.append('title', title)
    // formData.append('pdf', pdfFile)
    // await fetch('/api/articles', { method: 'POST', headers: { Authorization: token }, body: formData })
    setTimeout(() => {
      setUploading(false)
      setUploadDone(true)
      setTitle('')
      setPdfFile(null)
    }, 800)
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
              <p className="form-success">업로드가 완료됐습니다 — 서버 연결 후 실제 저장됩니다</p>
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
      </div>
    </>
  )
}
