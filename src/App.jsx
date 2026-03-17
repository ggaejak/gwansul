import { useEffect } from 'react'
import Nav from './components/Nav'
import Hero from './components/Hero'
import Metrics from './components/Metrics'
import Problem from './components/Problem'
import About from './components/About'
import System from './components/System'
import Partners from './components/Partners'
import History from './components/History'
import Projects from './components/Projects'
import Network from './components/Network'
import Gis from './components/Gis'
import Articles from './components/Articles'
import Contact from './components/Contact'
import Footer from './components/Footer'

export default function App() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('visible')
        })
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    )
    document.querySelectorAll('.fade-in').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <Nav />
      <Hero />
      <Metrics />
      <Problem />
      <About />
      <System />
      <Partners />
      <History />
      <Projects />
      <Network />
      <Gis />
      <Articles />
      <Contact />
      <Footer />
    </>
  )
}
