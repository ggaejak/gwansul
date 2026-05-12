// 현장 조사 관리자 페이지 (/survey-admin).
//
// C1: 비밀번호 게이트
// C2: 미검토 목록 + 상세 검토 (split 레이아웃)
// C3: 정제(curated_*) + 승인/반려 (admin_* SECURITY DEFINER RPC + 비밀번호 게이트)
//     + 검토 완료/다른 페이지 조사 read-only 모달
// C4: 진행률 대시보드             ← 다음 단계
//
// 인증 모델:
//   - SurveyPage 와 같은 단일 비밀번호 공유 (src/lib/adminAuth)
//   - write 액션(승인/반려/curated INSERT) 은 admin_* RPC + 비밀번호 평문 전달.
//
// 라우트는 공개 메뉴에 노출되지 않음 (직접 URL 접근 전용).

import { useState, useEffect, useCallback } from 'react'
import { fetchPendingSurveys } from '../data/surveys'
import { ADMIN_PASSWORD } from '../lib/adminAuth'
import PendingList from '../components/survey-admin/PendingList'
import SurveyDetailPanel from '../components/survey-admin/SurveyDetailPanel'
import SurveyReadOnlyModal from '../components/survey-admin/SurveyReadOnlyModal'
import ProgressDashboard from '../components/survey-admin/ProgressDashboard'
import '../styles/survey.css'
import '../styles/survey-admin.css'

const AUTH_STORAGE_KEY = 'gwansul_survey_admin_auth_v1'
const PAGE_SIZE = 10

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

  return <AdminBody onLogout={handleLogout} />
}

// ─────────────────────────────────────────────────────────────
// 인증 후 본문: 좌측 미검토 목록 + 우측 상세
// ─────────────────────────────────────────────────────────────

function AdminBody({ onLogout }) {
  const [activeTab, setActiveTab] = useState('list')  // 'list' | 'summary'

  const [items, setItems] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [typeFilter, setTypeFilter] = useState(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [readOnlyId, setReadOnlyId] = useState(null)

  // 미검토 목록 fetch
  useEffect(() => {
    let alive = true
    setLoading(true)
    setFetchError('')
    fetchPendingSurveys({
      limit:  PAGE_SIZE,
      offset: page * PAGE_SIZE,
      type:   typeFilter,
    })
      .then(({ items: rows, totalCount: tc }) => {
        if (!alive) return
        setItems(rows)
        setTotalCount(tc)
        // 자동 선택: 기존 선택이 새 페이지에 없으면 첫 항목.
        // (검토 직후 reloadKey 가 바뀐 경우에도 적용됨 → 다음 미검토로 자동 이동)
        if (rows.length > 0) {
          const stillThere = rows.find(r => r.id === selectedId)
          if (!stillThere) setSelectedId(rows[0].id)
        } else {
          setSelectedId(null)
        }
      })
      .catch(e => { if (alive) setFetchError(e?.message || '목록 불러오기 실패') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // selectedId 는 의도적 제외 — 페이지/필터/reloadKey 변경에만 재조회.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, typeFilter, reloadKey])

  const selected = items.find(i => i.id === selectedId) || null

  const handleTypeChange = useCallback((code) => {
    setTypeFilter(code)
    setPage(0)
  }, [])

  const handlePageChange = useCallback((p) => {
    if (p < 0) return
    setPage(p)
  }, [])

  // 같은 건물의 다른 조사 클릭:
  //   - 현재 페이지 내에 있는 미검토 → 선택만 바꿈
  //   - 그 외(검토 완료 / 다른 페이지) → read-only 모달
  const handleSelectRelated = useCallback((id) => {
    const inPage = items.find(i => i.id === id)
    if (inPage) {
      setSelectedId(id)
    } else {
      setReadOnlyId(id)
    }
  }, [items])

  // 검토(승인/반려) 완료 시: 목록 reload → useEffect 가 다음 첫 항목 자동 선택.
  // 검토한 항목이 현재 페이지의 마지막이고 미검토가 남아있지 않다면
  // 그대로 빈 페이지가 되므로 page 를 0 으로 리셋해 다음 페이지의 미검토를 끌어올림.
  const handleReviewed = useCallback(() => {
    // selectedId 는 즉시 비워서 stale 항목 표시를 막음.
    setSelectedId(null)
    // 빈 페이지 회피: 현재 페이지가 마지막 페이지였고 항목이 1개였다면 0 으로.
    const isLastItemOnLastPage =
      items.length === 1 && (page + 1) * PAGE_SIZE >= totalCount
    if (isLastItemOnLastPage && page > 0) {
      setPage(page - 1)
    } else {
      setReloadKey(k => k + 1)
    }
  }, [items.length, page, totalCount])

  // 삭제 완료 — 검토와 동일한 후처리.
  // 단, 삭제된 항목은 어떤 페이지에도 없을 수 있으므로 selectedId 만 비우고 reload.
  const handleDeleted = useCallback(({ id }) => {
    // selectedId 가 삭제 대상이면 비움 (현재 페이지에 있던 경우)
    setSelectedId(prev => (prev === id ? null : prev))
    const isLastItemOnLastPage =
      items.find(i => i.id === id)
      && items.length === 1
      && (page + 1) * PAGE_SIZE >= totalCount
    if (isLastItemOnLastPage && page > 0) {
      setPage(page - 1)
    } else {
      setReloadKey(k => k + 1)
    }
  }, [items, page, totalCount])

  return (
    <div className="sa-page">
      <header className="sa-header">
        <div>
          <small>SURVEY ADMIN</small>
          <h1 className="sa-header-title">현장 조사 관리</h1>
        </div>
        <div className="sa-header-meta">
          <span className="sa-pending-badge">미검토 {totalCount}건</span>
          <button type="button" className="sv-logout" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </header>

      <nav className="sa-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'list'}
          className={`sa-tab ${activeTab === 'list' ? 'active' : ''}`}
          onClick={() => setActiveTab('list')}
        >
          미검토 검토
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'summary'}
          className={`sa-tab ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          요약 대시보드
        </button>
      </nav>

      {activeTab === 'list' ? (
        <main className="sa-body sa-split">
          <aside className="sa-list-pane">
            {fetchError && <div className="sa-fetch-error">{fetchError}</div>}
            <PendingList
              items={items}
              loading={loading}
              totalCount={totalCount}
              page={page}
              pageSize={PAGE_SIZE}
              typeFilter={typeFilter}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onPageChange={handlePageChange}
              onTypeChange={handleTypeChange}
            />
          </aside>

          <section className="sa-detail-pane">
            <SurveyDetailPanel
              survey={selected}
              onSelectRelated={handleSelectRelated}
              onReviewed={handleReviewed}
              onDeleted={handleDeleted}
            />
          </section>
        </main>
      ) : (
        <main className="sa-body sa-dash-body">
          {/* reloadKey 를 그대로 넘기면 검토 직후 통계도 자동 갱신 */}
          <ProgressDashboard reloadKey={reloadKey} />
        </main>
      )}

      {readOnlyId && (
        <SurveyReadOnlyModal
          surveyId={readOnlyId}
          onClose={() => setReadOnlyId(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}
