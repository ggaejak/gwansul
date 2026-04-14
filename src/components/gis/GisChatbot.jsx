import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { buildLocationContext } from './chatContext'
import '../../styles/gis-chatbot.css'

const API_URL = 'https://gwansul-api.gwansul743.workers.dev'
const MAX_MESSAGES = 20

export default function GisChatbot({
  clickedPoint, radius, filtered, filteredTransit,
  filteredDots, filteredCommerce, filteredZoning, amenities,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState(null)

  const messagesEndRef = useRef(null)
  const abortRef = useRef(null)
  const prevPointRef = useRef(null)

  // 위치 컨텍스트 요약 생성
  const locationContext = useMemo(() => buildLocationContext({
    clickedPoint, radius, filtered, filteredTransit,
    filteredDots, filteredCommerce, filteredZoning, amenities,
  }), [clickedPoint, radius, filtered, filteredTransit,
       filteredDots, filteredCommerce, filteredZoning, amenities])

  // 위치 변경 시 대화 초기화
  useEffect(() => {
    if (!clickedPoint) return
    const key = `${clickedPoint[0].toFixed(4)},${clickedPoint[1].toFixed(4)}`
    const prevKey = prevPointRef.current
    prevPointRef.current = key
    if (key === prevKey) return

    // 진행중 요청 취소
    if (abortRef.current) abortRef.current.abort()
    setMessages([])
    setError(null)
    setInput('')

    // 채팅이 열려 있으면 자동 요약 요청
    if (isOpen && locationContext) {
      requestAutoSummary(locationContext)
    }
  }, [clickedPoint]) // eslint-disable-line react-hooks/exhaustive-deps

  // 채팅 열 때 위치가 선택되어 있고 메시지가 없으면 자동 요약
  useEffect(() => {
    if (isOpen && clickedPoint && messages.length === 0 && locationContext) {
      requestAutoSummary(locationContext)
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const requestAutoSummary = useCallback(async (context) => {
    const userMsg = { role: 'user', content: '이 위치의 도시 분석 요약을 해주세요.' }
    setMessages([userMsg, { role: 'assistant', content: '' }])
    await streamChat([userMsg], context)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const streamChat = async (conversationMessages, context) => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setIsStreaming(true)
    setError(null)

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: conversationMessages.slice(-10),
          context,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(errText || `서버 오류 (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += decoder.decode(value, { stream: true })
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: accumulated }
          return next
        })
      }
    } catch (e) {
      if (e.name === 'AbortError') return
      setError(e.message || '응답을 받을 수 없습니다.')
      // 빈 어시스턴트 메시지 제거
      setMessages(prev => {
        if (prev.length > 0 && prev[prev.length - 1].role === 'assistant' && !prev[prev.length - 1].content) {
          return prev.slice(0, -1)
        }
        return prev
      })
    } finally {
      setIsStreaming(false)
    }
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    setInput('')
    setError(null)

    const userMsg = { role: 'user', content: text }
    const newMessages = [...messages, userMsg, { role: 'assistant', content: '' }]
    setMessages(newMessages)

    await streamChat(
      newMessages.filter(m => m.content).slice(0, -1), // 빈 어시스턴트 메시지 제외
      locationContext,
    )
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const handleReset = () => {
    if (abortRef.current) abortRef.current.abort()
    setMessages([])
    setError(null)
    if (locationContext) {
      requestAutoSummary(locationContext)
    }
  }

  const userMsgCount = messages.filter(m => m.role === 'user').length
  const limitReached = userMsgCount >= MAX_MESSAGES / 2

  // 접힌 상태: 토글 버튼만
  if (!isOpen) {
    return (
      <button
        className="gc-toggle"
        onClick={() => setIsOpen(true)}
        title="AI 도시분석 챗봇"
        aria-label="AI 챗봇 열기"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    )
  }

  // 펼친 상태
  return (
    <div className="gc-panel">
      <div className="gc-header">
        <div>
          <span className="gc-header-title">AI 도시분석</span>
          <span className="gc-header-sub">중구 데이터 기반</span>
        </div>
        <button className="gc-close" onClick={() => setIsOpen(false)} aria-label="챗봇 닫기">&times;</button>
      </div>

      {!clickedPoint ? (
        <div className="gc-empty">
          <div className="gc-empty-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="10" r="3" />
              <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 7 8 11.7z" />
            </svg>
          </div>
          <div className="gc-empty-text">
            지도에서 위치를 클릭하면<br />AI가 해당 지역을 분석합니다
          </div>
        </div>
      ) : (
        <>
          <div className="gc-messages">
            {messages.map((msg, i) => (
              msg.content ? (
                <div key={i} className={`gc-msg ${msg.role}`}>
                  {msg.content}
                </div>
              ) : (
                msg.role === 'assistant' && isStreaming && (
                  <div key={i} className="gc-typing">
                    <span className="gc-typing-dot" />
                    <span className="gc-typing-dot" />
                    <span className="gc-typing-dot" />
                  </div>
                )
              )
            ))}
            {error && <div className="gc-error">{error}</div>}
            <div ref={messagesEndRef} />
          </div>

          {limitReached ? (
            <div className="gc-limit">
              대화 한도에 도달했습니다.
              <button onClick={handleReset}>새 대화 시작</button>
            </div>
          ) : (
            <div className="gc-input-area">
              <input
                className="gc-input"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="이 지역에 대해 질문하세요..."
                disabled={isStreaming}
              />
              <button
                className="gc-send"
                onClick={handleSend}
                disabled={isStreaming || !input.trim()}
                aria-label="전송"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
