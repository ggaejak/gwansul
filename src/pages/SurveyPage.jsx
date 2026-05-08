// 현장 조사 페이지 (모바일 우선).
//
// Step B1 범위: 비밀번호 게이트 + 인증 후 placeholder.
// Step B2 ~ B5 에서 지도 / 마커 / 입력 폼이 채워짐.
//
// 인증 모델 (단일 비밀번호 공유 — AdminPage 와 동일 패턴):
//   - 'Gwansul8&' 비밀번호 입력 → localStorage 에 인증 캐싱
//   - 모바일 조사원이 매번 입력하지 않도록 localStorage 사용 (sessionStorage X)
//   - 분실 시 비밀번호 변경으로 회수 (1 차 MVP 범위)
//   - VITE_SURVEY_PASSWORD 환경변수로 덮어쓰기 가능

import { useState, useEffect } from 'react'
import 'leaflet/dist/leaflet.css'
import '../styles/survey.css'
import SurveyMap from '../components/survey/SurveyMap'

const SURVEY_PASSWORD = import.meta.env.VITE_SURVEY_PASSWORD || 'Gwansul8&'
const AUTH_STORAGE_KEY = 'gwansul_survey_auth_v1'

export default function SurveyPage() {
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  // 페이지 진입 시 캐시된 인증 복원.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(AUTH_STORAGE_KEY) === '1') {
      setAuthenticated(true)
    }
  }, [])

  const handleLogin = (e) => {
    e.preventDefault()
    if (password === SURVEY_PASSWORD) {
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
          <div className="sv-section-tag">SURVEY</div>
          <h1 className="sv-login-title">현장 조사 접속</h1>
          <form onSubmit={handleLogin} className="sv-form">
            <input
              type="password"
              inputMode="text"
              autoComplete="current-password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              placeholder="조사원 비밀번호"
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
    <div className="sv-page">
      <header className="sv-header">
        <h1 className="sv-header-title">
          <small>SURVEY</small>
          현장 조사 — 신당동
        </h1>
        <button type="button" className="sv-logout" onClick={handleLogout}>
          로그아웃
        </button>
      </header>

      <SurveyMap />
    </div>
  )
}
