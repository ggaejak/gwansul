import { useEffect } from 'react'

const metrics = [
  { target: 3, suffix: '+', label: '현장 관측 연차' },
  { target: 64, suffix: '+', label: '현장조사 수행 개소' },
  { target: 27, suffix: '+', label: '심층 인터뷰 (업장·주민)' },
  { target: 2, suffix: '', label: '운영 거점 (원주·신당)' },
]

export default function Metrics() {
  useEffect(() => {
    const counterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target
            const target = parseInt(el.getAttribute('data-target'))
            const suffix = el.getAttribute('data-suffix') || ''
            const duration = 1500
            const start = performance.now()

            function animate(now) {
              const elapsed = now - start
              const progress = Math.min(elapsed / duration, 1)
              const eased = 1 - Math.pow(1 - progress, 3)
              const current = Math.floor(eased * target)
              el.textContent = current + suffix
              if (progress < 1) requestAnimationFrame(animate)
            }
            requestAnimationFrame(animate)
            counterObserver.unobserve(el)
          }
        })
      },
      { threshold: 0.5 }
    )
    document.querySelectorAll('.metric-number').forEach((el) => counterObserver.observe(el))
    return () => counterObserver.disconnect()
  }, [])

  return (
    <div className="metrics">
      {metrics.map((m, i) => (
        <div key={i} className={`metric fade-in${i > 0 ? ` fade-in-delay-${i}` : ''}`}>
          <div className="metric-number" data-target={m.target} data-suffix={m.suffix}>0</div>
          <div className="metric-label">{m.label}</div>
        </div>
      ))}
    </div>
  )
}
