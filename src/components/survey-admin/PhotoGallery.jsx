// 조사 사진 갤러리.
//
// - 썸네일 그리드 → 클릭 시 라이트박스(전체 화면 오버레이)
// - Storage public URL 변환은 src/data/surveys.js 의 getPhotoUrl 사용
// - 빈 배열이면 "사진 없음" 안내

import { useState } from 'react'
import { getPhotoUrl } from '../../data/surveys'

export default function PhotoGallery({ paths }) {
  const [lightboxIdx, setLightboxIdx] = useState(-1)

  const photos = (paths || [])
    .map(path => ({ path, url: getPhotoUrl(path) }))
    .filter(p => p.url)

  if (photos.length === 0) {
    return <div className="sa-photos-empty">사진 없음</div>
  }

  const lightbox = lightboxIdx >= 0 ? photos[lightboxIdx] : null

  const prev = () => setLightboxIdx(i => (i - 1 + photos.length) % photos.length)
  const next = () => setLightboxIdx(i => (i + 1) % photos.length)
  const close = () => setLightboxIdx(-1)

  return (
    <>
      <div className="sa-photos">
        {photos.map((p, i) => (
          <button
            key={p.path}
            type="button"
            className="sa-photo-thumb"
            onClick={() => setLightboxIdx(i)}
          >
            <img src={p.url} alt={`조사 사진 ${i + 1}`} loading="lazy" />
          </button>
        ))}
      </div>

      {lightbox && (
        <div className="sa-lightbox" role="dialog" aria-modal="true" onClick={close}>
          <img src={lightbox.url} alt="" onClick={e => e.stopPropagation()} />
          <button
            type="button"
            className="sa-lightbox-close"
            onClick={close}
            aria-label="닫기"
          >
            ×
          </button>
          {photos.length > 1 && (
            <>
              <button
                type="button"
                className="sa-lightbox-nav sa-lightbox-prev"
                onClick={e => { e.stopPropagation(); prev() }}
                aria-label="이전"
              >‹</button>
              <button
                type="button"
                className="sa-lightbox-nav sa-lightbox-next"
                onClick={e => { e.stopPropagation(); next() }}
                aria-label="다음"
              >›</button>
              <div className="sa-lightbox-counter">
                {lightboxIdx + 1} / {photos.length}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
