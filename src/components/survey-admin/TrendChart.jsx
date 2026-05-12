// 최근 30일 일자별 추이 — SVG 스택 막대 차트 (의존성 제로).
//
// props:
//   days : Array<{ day:'YYYY-MM-DD', pending, approved, rejected, total }>
//          (RPC 가 day DESC 로 정렬 → 표시 시 오름차순으로 뒤집어 사용)
//
// 디자인 가이드:
//   - 30 일 빈자리는 회색 빈 막대(0건) 로 채워서 시각 연속성 확보.
//   - status 별 색상: pending=amber, approved=green, rejected=slate.
//   - 호버 시 툴팁(title attribute) 로 일자/건수.

const STATUS_COLORS = {
  pending:  '#fbbf24',
  approved: '#22c55e',
  rejected: '#94a3b8',
}

function buildLast30Days(rows) {
  // RPC 결과를 day → row map 으로.
  const byDay = new Map(rows.map(r => [r.day, r]))

  // 오늘부터 거꾸로 30일을 만든다 (Asia/Seoul 기준 — 브라우저 로컬 사용).
  const out = []
  const now = new Date()
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const key = `${y}-${m}-${dd}`
    const r = byDay.get(key)
    out.push({
      day: key,
      mmdd: `${m}-${dd}`,
      pending:  r ? Number(r.pending)  || 0 : 0,
      approved: r ? Number(r.approved) || 0 : 0,
      rejected: r ? Number(r.rejected) || 0 : 0,
      total:    r ? Number(r.total)    || 0 : 0,
    })
  }
  return out
}

export default function TrendChart({ days }) {
  const data = buildLast30Days(days || [])
  const maxTotal = Math.max(1, ...data.map(d => d.total))

  // 차트 크기 — 부모 폭에 맞춰 자동.
  // viewBox 좌표계: 30 일 * 16 단위 폭 + 좌우 여백.
  const W_PER_DAY = 16
  const BAR_W     = 10
  const H_PLOT    = 140
  const PADDING   = { top: 14, right: 12, bottom: 26, left: 32 }
  const innerW    = data.length * W_PER_DAY
  const totalW    = innerW + PADDING.left + PADDING.right
  const totalH    = H_PLOT + PADDING.top + PADDING.bottom

  // y 축 grid (4 단계).
  const yTicks = 4
  const yLines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = Math.ceil((maxTotal / yTicks) * i)
    return { v, y: PADDING.top + H_PLOT - (v / maxTotal) * H_PLOT }
  })

  if (data.every(d => d.total === 0)) {
    return (
      <div className="sa-chart-empty">
        최근 30일 입력 기록이 없습니다.
      </div>
    )
  }

  return (
    <div className="sa-chart">
      <svg
        viewBox={`0 0 ${totalW} ${totalH}`}
        preserveAspectRatio="xMidYMid meet"
        className="sa-chart-svg"
      >
        {/* y 축 grid + 라벨 */}
        {yLines.map((line, i) => (
          <g key={i}>
            <line
              x1={PADDING.left} x2={totalW - PADDING.right}
              y1={line.y} y2={line.y}
              stroke="#eee" strokeWidth="1"
            />
            <text
              x={PADDING.left - 6} y={line.y + 3}
              textAnchor="end"
              fontSize="9"
              fill="#999"
            >
              {line.v}
            </text>
          </g>
        ))}

        {/* 막대 (status 스택) */}
        {data.map((d, i) => {
          const x = PADDING.left + i * W_PER_DAY + (W_PER_DAY - BAR_W) / 2
          const scale = H_PLOT / maxTotal

          // 아래에서 위로: rejected → approved → pending
          const hRej = d.rejected * scale
          const hApp = d.approved * scale
          const hPen = d.pending  * scale

          let y = PADDING.top + H_PLOT
          y -= hRej
          const yRej = y
          y -= hApp
          const yApp = y
          y -= hPen
          const yPen = y

          const showLabel = i % 5 === 0 || i === data.length - 1
          return (
            <g key={d.day}>
              <title>{`${d.day} · 총 ${d.total}건 (미검토 ${d.pending} / 승인 ${d.approved} / 반려 ${d.rejected})`}</title>
              {hRej > 0 && (
                <rect x={x} y={yRej} width={BAR_W} height={hRej}
                  fill={STATUS_COLORS.rejected} />
              )}
              {hApp > 0 && (
                <rect x={x} y={yApp} width={BAR_W} height={hApp}
                  fill={STATUS_COLORS.approved} />
              )}
              {hPen > 0 && (
                <rect x={x} y={yPen} width={BAR_W} height={hPen}
                  fill={STATUS_COLORS.pending} />
              )}
              {showLabel && (
                <text
                  x={x + BAR_W / 2}
                  y={PADDING.top + H_PLOT + 14}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#888"
                >
                  {d.mmdd}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      <div className="sa-chart-legend">
        <span><i style={{ background: STATUS_COLORS.pending }} />미검토</span>
        <span><i style={{ background: STATUS_COLORS.approved }} />승인</span>
        <span><i style={{ background: STATUS_COLORS.rejected }} />반려</span>
      </div>
    </div>
  )
}
