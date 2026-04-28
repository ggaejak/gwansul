// 선택된 아티클이 등록한 지도 시각 자료를 렌더하는 컴포넌트.
//
// 동작:
//   - articleId 로 articles 배열을 조회 (fetchArticles 캐시 활용)
//   - articleVisuals 등록 항목 조회
//   - flyTo 가 있으면 지도 이동
//   - MapLayer 가 있으면 그대로 렌더 (react-leaflet 컨텍스트 안)
//
// 1차 구현 시점에는 articleVisuals.js 가 비어 있어 사실상 no-op.
// 향후 아티클별 시각 자료를 등록하면 자동으로 활성화된다.
//
// props:
//   - articleId: number | null
//
// 호출 위치: GisPage 의 <MapContainer> 내부에서 article 모드 +
// 선택된 아티클이 있을 때만 마운트.

import { useEffect, useState } from 'react'
import { useMap } from 'react-leaflet'
import { fetchArticles } from '../../data/articles'
import { getArticleVisuals } from '../../data/articleVisuals'

export default function ArticleMapOverlay({ articleId }) {
  const map = useMap()
  const [article, setArticle] = useState(null)

  useEffect(() => {
    if (articleId == null) {
      setArticle(null)
      return
    }
    let cancelled = false
    fetchArticles().then(list => {
      if (!cancelled) {
        setArticle(list.find(a => a.id === articleId) || null)
      }
    })
    return () => { cancelled = true }
  }, [articleId])

  const visuals = article ? getArticleVisuals(article.id) : null

  // flyTo: 아티클 변경 시 한 번만 실행
  useEffect(() => {
    if (!visuals?.flyTo) return
    const [lat, lng, zoom] = visuals.flyTo
    map.flyTo([lat, lng], zoom ?? map.getZoom(), { duration: 0.8 })
  }, [article?.id, visuals, map])

  if (!visuals?.MapLayer) return null
  return <visuals.MapLayer article={article} />
}
