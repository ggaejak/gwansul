/**
 * 중구 전체 건축물대장(총괄표제부) 수집 스크립트
 * 실행: node scripts/etl/fetchBuildingsRecap.js
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const envPath = resolve(__dirname, '../../.env.local')
const envContent = readFileSync(envPath, 'utf-8')
const API_KEY = envContent.match(/VITE_DATA_GO_KR_API_KEY=(.*)/)?.[1]?.trim()

if (!API_KEY) {
  console.error('.env.local에서 VITE_DATA_GO_KR_API_KEY를 찾을 수 없습니다')
  process.exit(1)
}

const SIGUNGU_CD = '11140'

const BJDONG_CODES = [
  '10000', '10100', '10200', '10300', '10400', '10500',
  '10600', '10700', '10800', '10900', '11000', '11100',
  '11200', '11300', '11400', '11500', '11600', '11700',
  '11800', '11900', '12000', '12100', '12200', '12300',
  '12400', '12500', '12600', '12700', '12800', '12900',
  '13000', '13100', '13200', '13300', '13400', '13500',
  '13600', '13700', '13800', '13900', '14000', '14100',
  '14200', '14300', '14400', '14500', '14600', '14700',
  '14800', '14900', '15000', '15100', '15200', '15300',
  '15400', '15500',
]

const BASE_URL = 'http://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo'
const NUM_OF_ROWS = 100

async function fetchPage(bjdongCd, pageNo) {
  const params = new URLSearchParams({
    serviceKey: API_KEY,
    sigunguCd: SIGUNGU_CD,
    bjdongCd,
    numOfRows: String(NUM_OF_ROWS),
    pageNo: String(pageNo),
    _type: 'json',
  })
  const res = await fetch(`${BASE_URL}?${params}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function fetchAllForDong(bjdongCd) {
  const items = []
  let pageNo = 1
  let totalCount = 0

  while (true) {
    try {
      const data = await fetchPage(bjdongCd, pageNo)
      const body = data?.response?.body
      if (!body || !body.items?.item) break

      totalCount = parseInt(body.totalCount) || 0
      const pageItems = Array.isArray(body.items.item) ? body.items.item : [body.items.item]
      items.push(...pageItems)

      if (items.length >= totalCount) break
      pageNo++
      await new Promise(r => setTimeout(r, 200))
    } catch (err) {
      console.error(`  에러 (동 ${bjdongCd}, 페이지 ${pageNo}): ${err.message}`)
      break
    }
  }

  return { items, totalCount }
}

async function main() {
  console.log('=== 서울 중구 건축물대장(총괄표제부) 수집 시작 ===\n')

  const allBuildings = []
  let processedDongs = 0

  for (const code of BJDONG_CODES) {
    processedDongs++
    process.stdout.write(`[${processedDongs}/${BJDONG_CODES.length}] 동 ${code} 수집 중... `)

    const { items, totalCount } = await fetchAllForDong(code)
    console.log(`${items.length}건 (총 ${totalCount}건)`)

    allBuildings.push(...items)
    await new Promise(r => setTimeout(r, 500))
  }

  console.log(`\n=== 수집 완료: 총 ${allBuildings.length}건 ===`)

  const outPath = resolve(__dirname, '../../src/gis/data/junggu-buildings-recap.json')
  writeFileSync(outPath, JSON.stringify(allBuildings, null, 2), 'utf-8')
  console.log(`저장: ${outPath}`)
}

main().catch(console.error)
