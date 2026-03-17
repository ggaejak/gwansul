import { useEffect } from 'react'

export default function Hero() {
  useEffect(() => {
    const onScroll = () => {
      const hero = document.querySelector('.hero')
      const scrolled = window.scrollY
      if (scrolled < window.innerHeight) {
        hero.style.opacity = 1 - (scrolled / window.innerHeight) * 0.5
      }
    }
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <section className="hero" id="hero">
      <div className="hero-kicker">Urban Operations Company</div>
      <h1 className="hero-title">
        도시를 운영 시스템으로<br />전환합니다<span className="hanja">觀雪</span>
      </h1>
      <p className="hero-desc">
        관설은 도시를 개발의 결과물이 아니라 장기적으로 운영되어야 하는 시스템으로 다룹니다.
        현장 관측에서 소유구조 전환까지, 변화가 유지되는 구조를 설계합니다.
      </p>
      <div className="hero-actions">
        <a href="#contact" className="btn-primary">협업 문의하기 <span className="arrow">&rarr;</span></a>
        <a href="#projects" className="btn-secondary">프로젝트 보기</a>
      </div>
      <div className="hero-meta">
        주식회사 관설<br />
        Est. 2022 — 원주 · 신당
      </div>
      <div className="scroll-indicator"><div className="line"></div></div>
    </section>
  )
}
