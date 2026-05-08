import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import GisPage from './pages/GisPage'
import ArticlesPage from './pages/ArticlesPage'
import AdminPage from './pages/AdminPage'
import SurveyPage from './pages/SurveyPage'
import SurveyAdminPage from './pages/SurveyAdminPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/gis" element={<GisPage />} />
        <Route path="/articles" element={<ArticlesPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/survey" element={<SurveyPage />} />
        <Route path="/survey-admin" element={<SurveyAdminPage />} />
      </Routes>
    </BrowserRouter>
  )
}
