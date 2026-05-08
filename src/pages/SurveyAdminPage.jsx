// 현장 조사 관리자 페이지 (/survey-admin).
//
// Step C1 범위: 비밀번호 게이트 + 인증 후 placeholder.
// Step C2 ~ C4 에서:
//   C2 — 미검토 목록 + 상세 검토
//   C3 — 정제(curated_*) + 승인/반려
//   C4 — 진행률 대시보드
//
// 인증 모델 (1차 MVP):
//   - SurveyPage 와 같은 방식 (단일 비밀번호 공유)
//   - VITE_SURVEY_ADMIN_PASSWORD 환경변수, 미설정 시 'Gwansul8&'
//   - admin 의 write 작업(status 변경, curated INSERT) 은 Phase C2/C3 에서
//     별도 매커니즘 (RPC + password-protected) 으로 처리 — 현재는 인증 게이트만.
//
// 라우트는 공개 메뉴에 노출되지 않음 (직접 URL 접근 전용).

import { useState, useEffect } from 'react'
import '../styles/survey.css'
import '../styles/survey-admin.css'

const ADMIN_PASSWORD = import.meta.env.VITE_SURVEY_ADMIN_PASSWORD || 'Gwansul8&'
const AUTH_STORAGE_KEY = 'gwansul_survey_admin_auth_v1'

export default function SurveyAdminPage() {
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(AUTH_STORAGE_KEY) === '1') {
      setAuthenticated(true)
    }
  }, [])

  const handleLogin = (e) => {
    e.preventDefault()
    if (password === ADMIN_PASSWORD) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, '1')
      setAuthenticated(true)
      setPassword('')
      setError('')
    } else {
      setError('비밀번호가 올바르지 않습니다')
      setPassword('')
    }
  }

  const handleLogout = () => {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    setAuthenticated(false)
  }

  if (!authenticated) {
    return (
      <div className="sv-login-page">
        <div className="sv-login-box">
          <div className="sv-section-tag">SURVEY ADMIN</div>
          <h1 className="sv-login-title">조사 관리자 접속</h1>
          <form onSubmit={handleLogin} className="sv-form">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              placeholder="관리자 비밀번호"
              className="sv-input"
              autoFocus
            />
            {error && <p className="sv-error">{error}</p>}
            <button type="submit" className="sv-btn" disabled={!password}>
              확인
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="sa-page">
      <header className="sa-header">
        <div>
          <small>SURVEY ADMIN</small>
          <h1 className="sa-header-title">현장 조사 관리</h1>
        </div>
        <button type="button" className="sv-logout" onClick={handleLogout}>
          로그아웃
        </button>
      </header>

      <main className="sa-body">
        <div className="sa-placeholder">
          <div className="sa-placeholder-tag">C1 / 4</div>
          <h2 className="sa-placeholder-title">관리자 인증 통과</h2>
          <p className="sa-placeholder-desc">
            미검토 목록·정제·승인 UI 와 진행률 대시보드는 다음 단계(C2~C4)에서 추가됩니다.
          </p>
        </div>
      </main>
    </div>
  )
}
