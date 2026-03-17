import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'

export default function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const closeMenu = () => setMenuOpen(false)

  const sectionHref = (hash) => location.pathname === '/' ? hash : `/${hash}`

  return (
    <nav id="nav" className={scrolled ? 'scrolled' : ''}>
      <Link to="/" className="logo">관설<span>觀雪</span></Link>
      <ul id="navMenu" className={menuOpen ? 'open' : ''}>
        <li><a href={sectionHref('#problem')} onClick={closeMenu}>문제 인식</a></li>
        <li><a href={sectionHref('#about')} onClick={closeMenu}>접근 방식</a></li>
        <li><a href={sectionHref('#system')} onClick={closeMenu}>시스템</a></li>
        <li><a href={sectionHref('#projects')} onClick={closeMenu}>프로젝트</a></li>
        <li><a href={sectionHref('#network')} onClick={closeMenu}>조직</a></li>
        <li className="nav-divider"></li>
        <li><Link to="/gis" onClick={closeMenu}>GIS</Link></li>
        <li className="nav-divider"></li>
        <li><Link to="/articles" onClick={closeMenu}>아티클</Link></li>
        <li className="nav-divider"></li>
        <li><a href={sectionHref('#contact')} onClick={closeMenu} className="nav-cta">협업 문의</a></li>
      </ul>
      <div className="hamburger" onClick={() => setMenuOpen(!menuOpen)}>
        <span></span><span></span><span></span>
      </div>
    </nav>
  )
}
