// 아티클 데이터 (Cloudflare Worker R2) 의 fetch 추상.
//
// ArticlesPage 와 GisPage 의 ArticlePanel 이 같은 데이터를 쓰므로
// module-level promise 캐시로 중복 요청을 방지한다.
// 페이지 간 이동 시 재fetch 되지 않음 — SPA 내 첫 호출에서 1회만.
//
// 현재 아티클 모델 (Worker meta):
//   { id: number, title: string, date: string, pdfUrl: string|null }
// 위치/카테고리/본문 텍스트 등은 없음. 시각 자료 확장은
// src/data/articleVisuals.js 의 매핑으로 처리.

export const ARTICLES_API_URL = 'https://orange-cherry-8597.gwansul743.workers.dev'

let articlesPromise = null

/**
 * 아티클 목록을 가져온다. module-level 캐시.
 * 실패 시 빈 배열 반환 + 캐시 무효화 (다음 호출에 재시도 가능).
 *
 * @returns {Promise<Array<{id:number, title:string, date:string, pdfUrl:string|null}>>}
 */
export function fetchArticles() {
  if (!articlesPromise) {
    articlesPromise = fetch(`${ARTICLES_API_URL}/api/articles`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .catch(err => {
        console.warn('[articles] fetch 실패:', err?.message || err)
        articlesPromise = null
        return []
      })
  }
  return articlesPromise
}

/**
 * 캐시 무효화. AdminPage 에서 아티클 작성/삭제 후 호출하면
 * 다음 fetchArticles() 호출이 서버에 재요청한다.
 */
export function invalidateArticles() {
  articlesPromise = null
}
