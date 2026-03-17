import { useState, useEffect } from 'react'

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const closeMenu = () => setMenuOpen(false)

  return (
    <nav id="nav" className={scrolled ? 'scrolled' : ''}>
      <a href="#" className="logo">관설<span>觀雪</span></a>
      <ul id="navMenu" className={menuOpen ? 'open' : ''}>
        <li><a href="#problem" onClick={closeMenu}>문제 인식</a></li>
        <li><a href="#about" onClick={closeMenu}>접근 방식</a></li>
        <li><a href="#system" onClick={closeMenu}>시스템</a></li>
        <li><a href="#projects" onClick={closeMenu}>프로젝트</a></li>
        <li><a href="#network" onClick={closeMenu}>조직</a></li>
        <li><a href="#contact" onClick={closeMenu} className="nav-cta">협업 문의</a></li>
      </ul>
      <div className="hamburger" onClick={() => setMenuOpen(!menuOpen)}>
        <span></span><span></span><span></span>
      </div>
    </nav>
  )
}
