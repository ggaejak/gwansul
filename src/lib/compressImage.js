// Canvas 기반 이미지 압축.
//
// 외부 라이브러리(browser-image-compression 등) 없이 동작하도록 Canvas API 사용.
// EXIF 회전 보정은 createImageBitmap 의 { imageOrientation: 'from-image' } 옵션으로 처리.
//   - iOS Safari 14+, Chrome 79+, Firefox 90+ 지원
//   - 미지원 환경에서는 회전이 어긋날 수 있음 (1 차 MVP 허용 범위)
//
// 정책 (docs/phase-a-storage-setup.md §4):
//   - 최대 너비 1600px (긴 변)
//   - JPEG quality 0.7
//   - 결과 200~500KB 목표 (보장 X — 원본 따라 변동)

const DEFAULTS = {
  maxWidth:    1600,
  quality:     0.7,
  contentType: 'image/jpeg',
}

/**
 * @param {File|Blob} file
 * @param {object}    [opts]
 * @param {number}    [opts.maxWidth=1600]   긴 변 픽셀 한계
 * @param {number}    [opts.quality=0.7]     JPEG 품질 (0~1)
 * @param {string}    [opts.contentType='image/jpeg']
 * @returns {Promise<Blob>}
 */
export async function compressImage(file, opts = {}) {
  const { maxWidth, quality, contentType } = { ...DEFAULTS, ...opts }

  // EXIF 회전 보정. createImageBitmap 미지원 환경(드뭄)은 fallback 으로 Image.decode().
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    bitmap = await loadImageFallback(file)
  }

  const srcW = bitmap.width
  const srcH = bitmap.height
  const longSide = Math.max(srcW, srcH)
  const scale = longSide > maxWidth ? maxWidth / longSide : 1
  const dstW = Math.round(srcW * scale)
  const dstH = Math.round(srcH * scale)

  const canvas = document.createElement('canvas')
  canvas.width  = dstW
  canvas.height = dstH
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, dstW, dstH)

  // ImageBitmap 메모리 해제 (지원 환경)
  if (typeof bitmap.close === 'function') bitmap.close()

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('이미지 압축 실패 (toBlob 반환 없음)'))
        resolve(blob)
      },
      contentType,
      quality,
    )
  })
}

// createImageBitmap 미지원 fallback — 회전 보정 없이 그대로 그림.
async function loadImageFallback(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}
