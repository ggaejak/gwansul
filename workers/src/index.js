// ═══════════════════════════════════════════════════════════════
//  관설 API Worker — 아티클 CRUD + AI 챗봇
// ═══════════════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// ─── 라우터 ─────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }

    // 아티클 API
    if (url.pathname === '/api/articles' && request.method === 'GET') {
      return handleGetArticles(env)
    }
    if (url.pathname === '/api/articles' && request.method === 'POST') {
      return handleCreateArticle(request, env)
    }
    if (url.pathname.startsWith('/api/articles/') && request.method === 'DELETE') {
      return handleDeleteArticle(request, url, env)
    }

    // 챗봇 API
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      return handleChat(request, env)
    }

    return json({ error: 'Not found' }, 404)
  },
}

// ═══════════════════════════════════════════════════════════════
//  아티클 CRUD (기존 기능)
// ═══════════════════════════════════════════════════════════════

async function handleGetArticles(env) {
  const list = await env.BUCKET.list({ prefix: 'meta/' })
  const articles = []

  for (const obj of list.objects) {
    const meta = await env.BUCKET.get(obj.key)
    if (meta) {
      try {
        articles.push(JSON.parse(await meta.text()))
      } catch {}
    }
  }

  articles.sort((a, b) => b.id - a.id)
  return json(articles)
}

async function handleCreateArticle(request, env) {
  const auth = request.headers.get('Authorization')
  if (auth !== env.ADMIN_PASSWORD) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const formData = await request.formData()
  const title = formData.get('title')
  const pdf = formData.get('pdf')

  if (!title || !pdf) {
    return json({ error: 'title과 pdf가 필요합니다.' }, 400)
  }

  const id = Date.now()
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '.')

  // PDF를 R2에 저장
  const pdfKey = `pdfs/${id}.pdf`
  await env.BUCKET.put(pdfKey, pdf.stream(), {
    httpMetadata: { contentType: 'application/pdf' },
  })

  const pdfUrl = `https://orange-cherry-8597.gwansul743.workers.dev/pdf/${id}.pdf`

  // 메타데이터 저장
  const article = { id, title, date, pdfUrl }
  await env.BUCKET.put(`meta/${id}.json`, JSON.stringify(article))

  return json(article, 201)
}

async function handleDeleteArticle(request, url, env) {
  const auth = request.headers.get('Authorization')
  if (auth !== env.ADMIN_PASSWORD) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const id = url.pathname.split('/').pop()
  await env.BUCKET.delete(`meta/${id}.json`)
  await env.BUCKET.delete(`pdfs/${id}.pdf`)

  return json({ ok: true })
}

// ═══════════════════════════════════════════════════════════════
//  AI 챗봇
// ═══════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `당신은 서울 중구(Jung-gu) 도시분석 어시스턴트입니다. 관설(Gwansul) 플랫폼의 GIS 대시보드에서 사용자가 선택한 위치의 분석 데이터를 기반으로 답변합니다.

아래에 현재 선택된 위치의 분석 데이터가 제공됩니다. 이 데이터만을 근거로 답변하세요.

가이드라인:
- 한국어로 답변하되, 사용자가 영어로 질문하면 영어로 답변
- 데이터에 기반한 간결하고 구체적인 답변 (숫자 인용)
- 실제 용적률과 허용 용적률(용도지역 기준)을 비교하여 개발 잠재력 분석
- 주목할 만한 패턴 강조: 건물 노후도 집중, 용도 다양성/단조로움, 교통 접근성
- 제공된 데이터에 없는 정보는 솔직히 "현재 데이터에 포함되지 않은 정보입니다"라고 답변
- 숫자는 읽기 쉽게 표시 (예: 45.2억원, 2,340명)
- 도시계획 전문 용어를 사용하되 필요시 쉬운 설명 추가
- 응답은 간결하게. 불필요한 인사말이나 서론 생략`

async function handleChat(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return new Response('ANTHROPIC_API_KEY가 설정되지 않았습니다.', {
      status: 500,
      headers: CORS,
    })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: '잘못된 요청 형식입니다.' }, 400)
  }

  const { messages, context } = body

  if (!messages || !Array.isArray(messages) || !context) {
    return json({ error: 'messages와 context가 필요합니다.' }, 400)
  }

  // 메시지 정리: 마지막 10개, 내용 2000자 제한
  const trimmed = messages.slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: String(m.content).slice(0, 2000),
  }))

  const systemContent = `${SYSTEM_PROMPT}\n\n--- 분석 데이터 ---\n${context}`

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemContent,
      messages: trimmed,
      stream: true,
    }),
  })

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text().catch(() => '')
    console.error('Anthropic API error:', anthropicRes.status, errText)
    return new Response(`AI 응답 오류 (${anthropicRes.status})`, {
      status: 502,
      headers: CORS,
    })
  }

  // Anthropic SSE → 텍스트 청크 스트리밍 변환
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  const pipe = async () => {
    const reader = anthropicRes.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              await writer.write(encoder.encode(parsed.delta.text))
            }
          } catch {
            // JSON 파싱 실패 무시 (event: 라인 등)
          }
        }
      }
    } catch (e) {
      console.error('Stream pipe error:', e)
    } finally {
      await writer.close()
    }
  }

  pipe()

  return new Response(readable, {
    headers: {
      ...CORS,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
}
