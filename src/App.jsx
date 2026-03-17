import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import GisPage from './pages/GisPage'
import ArticlesPage from './pages/ArticlesPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/gis" element={<GisPage />} />
        <Route path="/articles" element={<ArticlesPage />} />
      </Routes>
    </BrowserRouter>
  )
}
