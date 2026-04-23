// Supabase 클라이언트 초기화.
// 환경변수 누락 시 앱을 크래시시키지 않고 null 을 유지한다.
// 호출 측(예: src/data/buildings.js)은 isSupabaseReady() 로 확인 후
// 사용하며, 준비되지 않았을 경우 정적 geojson 폴백 경로로 동작한다.

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

let supabase = null

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    '[supabase] VITE_SUPABASE_URL 또는 VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다. ' +
    'Supabase 클라이언트가 초기화되지 않습니다. ' +
    '백엔드 이관 기능은 비활성화되며 기존 정적 geojson 로딩으로 폴백합니다.',
  )
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // 공개 읽기만 사용. 세션을 localStorage 에 저장하지 않음.
      persistSession: false,
      autoRefreshToken: false,
    },
    db: { schema: 'public' },
  })
}

export { supabase }

export function isSupabaseReady() {
  return supabase !== null
}
