/**
 * 건축물대장 주소를 카카오 지오코딩으로 좌표 변환
 * 실행: node scripts/etl/geocodeBuildings.js
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const envPath = resolve(__dirname, '../../.env.local')
const envContent = readFileSync(envPath, 'utf-8')
const KAKAO_KEY = envContent.match(/VITE_KAKAO_REST_API_KEY=(.*)/)?.[1]?.trim()

if (!KAKAO_KEY) {
  console.error('.env.local에서 VITE_KAKAO_REST_API_KEY를 찾을 수 없습니다')
  process.exit(1)
}

const rawPath = resolve(__dirname, '../../src/gis/data/junggu-buildings-raw.json')
const recapPath = resolve(__dirname, '../../src/gis/data/junggu-buildings-recap.json')
const outPath = resolve(__dirname, '../../src/gis/data/junggu-buildings.json')

// 주소 중복 제거 (같은 필지에 여러 동이 있을 수 있음)
function getUniqueAddresses(buildings) {
  const map = new Map()
  for (const b of buildings) {
    const addr = b.newPlatPlc?.trim() || b.platPlc?.trim()
    if (!addr || addr === ' ') continue
    const key = `${b.sigunguCd}-${b.bjdongCd}-${b.bun}-${b.ji}`
    if (!map.has(key)) {
      map.set(key, { ...b, address: addr })
    } else {
      // 이미 있으면 층수 더 높은 걸로 (주건축물 우선)
      const existing = map.get(key)
      if ((b.grndFlrCnt || 0) > (existing.grndFlrCnt || 0)) {
        map.set(key, { ...b, address: addr })
      }
    }
  }
  return [...map.values()]
}

async function geocode(address) {
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`
  const res = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
  })
  if (!res.ok) return null
  const data = await res.json()
  const doc = data.documents?.[0]
  if (!doc) return null
  return { lat: parseFloat(doc.y), lng: parseFloat(doc.x) }
}

async function main() {
  const raw = JSON.parse(readFileSync(rawPath, 'utf-8'))
  const recap = JSON.parse(readFileSync(recapPath, 'utf-8'))

  // 총괄표제부 데이터를 키로 매핑 (용적률/건폐율 보충용)
  const recapMap = new Map()
  for (const r of recap) {
    const key = `${r.sigunguCd}-${r.bjdongCd}-${r.bun}-${r.ji}`
    recapMap.set(key, r)
  }

  const unique = getUniqueAddresses(raw)
  console.log(`=== 지오코딩 시작: ${unique.length}건 (중복 제거 후) ===\n`)

  const results = []
  let success = 0
  let fail = 0

  for (let i = 0; i < unique.length; i++) {
    const b = unique[i]
    const key = `${b.sigunguCd}-${b.bjdongCd}-${b.bun}-${b.ji}`
    const recapData = recapMap.get(key)

    if ((i + 1) % 50 === 0 || i === 0) {
      process.stdout.write(`[${i + 1}/${unique.length}] 변환 중... (성공: ${success}, 실패: ${fail})\r`)
    }

    const coords = await geocode(b.address)

    if (coords) {
      success++
      results.push({
        id: key,
        address: b.address,
        bldNm: b.bldNm?.trim() || '',
        lat: coords.lat,
        lng: coords.lng,
        // 표제부 데이터
        grndFlrCnt: b.grndFlrCnt || 0,
        ugrndFlrCnt: b.ugrndFlrCnt || 0,
        totArea: b.totArea || 0,
        mainPurpsCdNm: b.mainPurpsCdNm || '',
        etcPurps: b.etcPurps?.trim() || '',
        strctCdNm: b.strctCdNm || '',
        useAprDay: b.useAprDay?.trim() || '',
        heit: b.heit || 0,
        // 용적률: 표제부 → 총괄표제부 순서로 사용
        vlRat: b.vlRat || recapData?.vlRat || 0,
        bcRat: b.bcRat || recapData?.bcRat || 0,
        platArea: b.platArea || recapData?.platArea || 0,
        // 법정동 코드
        bjdongCd: b.bjdongCd,
      })
    } else {
      fail++
    }

    // 카카오 API 부하 방지 (100ms)
    await new Promise(r => setTimeout(r, 100))
  }

  console.log(`\n\n=== 완료: 성공 ${success}건, 실패 ${fail}건 ===`)
  console.log(`용적률 있는 건수: ${results.filter(r => r.vlRat > 0).length}건`)

  writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8')
  console.log(`저장: ${outPath}`)
}

main().catch(console.error)
