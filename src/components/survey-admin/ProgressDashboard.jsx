// 진행률 대시보드 (C4).
//
// 표시 항목:
//   - 메인 진행률 카드: 정제 완료 건물 / 답사 영역 내 전체 건물 (%)
//   - 보조 진행률: 조사 입력률, 정제 진행률(입력된 것 중 정제 완료된 비율)
//   - 도로/점 누적: 분모 없음 (단순 누적 + 미검토 잔량)
//   - 처리 현황: 미검토 / 승인 / 반려 카운트
//   - 30일 일자별 추이: TrendChart
//
// 데이터: fetchSurveyProgress() 한 번 호출 → 모든 카드가 같은 응답 사용.
// reloadKey prop 으로 외부에서 강제 재조회 가능 (예: 검토 직후).

import { useEffect, useState } from 'react'
import { fetchSurveyProgress } from '../../data/surveys'
import TrendChart from './TrendChart'

function pct(num, denom) {
  if (!denom || denom <= 0) return 0
  return (num / denom) * 100
}

function fmtPct(num, denom, digits = 1) {
  const p = pct(num, denom)
  if (denom <= 0) return '—'
  return `${p.toFixed(digits)}%`
}

function fmtNum(n) {
  const v = Number(n) || 0
  return v.toLocaleString('ko-KR')
}

export default function ProgressDashboard({ reloadKey = 0 }) {
  const [progress, setProgress] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    fetchSurveyProgress()
      .then(d => { if (alive) setProgress(d) })
      .catch(e => { if (alive) setError(e?.message || '통계 불러오기 실패') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [reloadKey])

  if (loading && !progress) {
    return <div className="sa-dash-state">통계 불러오는 중…</div>
  }
  if (error) {
    return <div className="sa-dash-state sa-dash-error">에러: {error}</div>
  }
  if (!progress) {
    return <div className="sa-dash-state">데이터 없음</div>
  }

  const {
    in_area_total, surveyed_buildings, approved_buildings,
    pending_total, approved_total, rejected_total,
    curated_roads_total, curated_points_total,
    pending_by_type = {}, by_day = [],
  } = progress

  const inputRate    = pct(surveyed_buildings, in_area_total)
  const curationRate = pct(approved_buildings, in_area_total)
  const refineRate   = pct(approved_buildings, surveyed_buildings)

  return (
    <div className="sa-dash">
      {/* 메인 진행률 */}
      <section className="sa-dash-hero">
        <div className="sa-dash-hero-left">
          <div className="sa-dash-hero-tag">건물 정제 완료율</div>
          <div className="sa-dash-hero-pct">{curationRate.toFixed(1)}%</div>
          <div className="sa-dash-hero-sub">
            {fmtNum(approved_buildings)} / {fmtNum(in_area_total)} 건물
            <br />
            <small>답사 영역 내 전체 건물 대비</small>
          </div>
        </div>
        <div className="sa-dash-hero-right">
          <ProgressBar value={curationRate} />
        </div>
      </section>

      {/* 보조 진행률 */}
      <section className="sa-dash-secondary">
        <SubProgress
          label="조사 입력률"
          desc="한 번이라도 조사 row 가 들어온 건물 비율"
          numerator={surveyed_buildings}
          denominator={in_area_total}
          rate={inputRate}
        />
        <SubProgress
          label="정제 진행률"
          desc="입력된 건물 중 정제까지 완료된 비율"
          numerator={approved_buildings}
          denominator={surveyed_buildings}
          rate={refineRate}
        />
      </section>

      {/* 도로/점 누적 */}
      <section className="sa-dash-cards">
        <h3 className="sa-dash-title">도로 / 점 조사 (분모 없음)</h3>
        <div className="sa-dash-grid sa-dash-grid-2">
          <StatCard
            label="도로 조사 정제 누적"
            value={fmtNum(curated_roads_total)}
            sub={`미검토 ${fmtNum(pending_by_type.road)}건`}
          />
          <StatCard
            label="점 조사 정제 누적"
            value={fmtNum(curated_points_total)}
            sub={`미검토 ${fmtNum(pending_by_type.point)}건`}
          />
        </div>
      </section>

      {/* 처리 현황 */}
      <section className="sa-dash-cards">
        <h3 className="sa-dash-title">처리 현황 (전체 조사 row)</h3>
        <div className="sa-dash-grid sa-dash-grid-3">
          <StatCard
            label="미검토"
            value={fmtNum(pending_total)}
            sub={`건물 ${fmtNum(pending_by_type.building)} · 도로 ${fmtNum(pending_by_type.road)} · 점 ${fmtNum(pending_by_type.point)}`}
            accent="pending"
          />
          <StatCard
            label="승인"
            value={fmtNum(approved_total)}
            accent="approved"
          />
          <StatCard
            label="반려"
            value={fmtNum(rejected_total)}
            accent="rejected"
          />
        </div>
      </section>

      {/* 30일 추이 */}
      <section className="sa-dash-cards">
        <h3 className="sa-dash-title">최근 30일 일자별 추이</h3>
        <TrendChart days={by_day} />
      </section>
    </div>
  )
}

// ─── 보조 컴포넌트 ──────────────────────────────────────────────

function ProgressBar({ value }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className="sa-progress-bar">
      <div className="sa-progress-fill" style={{ width: `${v}%` }} />
    </div>
  )
}

function SubProgress({ label, desc, numerator, denominator, rate }) {
  return (
    <div className="sa-subprog">
      <div className="sa-subprog-head">
        <span className="sa-subprog-label">{label}</span>
        <span className="sa-subprog-pct">
          {denominator > 0 ? `${rate.toFixed(1)}%` : '—'}
        </span>
      </div>
      <ProgressBar value={rate} />
      <div className="sa-subprog-meta">
        {fmtNum(numerator)} / {fmtNum(denominator)} · {desc}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className={`sa-stat-card ${accent ? `sa-stat-${accent}` : ''}`}>
      <div className="sa-stat-label">{label}</div>
      <div className="sa-stat-value">{value}</div>
      {sub && <div className="sa-stat-sub">{sub}</div>}
    </div>
  )
}
