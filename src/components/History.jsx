const timeline = [
  {
    year: '2022',
    events: [
      { location: '원주', text: '— 혁신도시 관측 착수' },
      { location: null, text: '생활패턴·공실·이동밀도 조사 축적' },
    ],
  },
  {
    year: '2023',
    events: [
      { location: '원주', text: "— '아란' 운영 개시 (거점 기획·제작·운영)" },
      { location: '원주', text: "— '원주혁신도시 서포터즈 1기' 기획 및 운영" },
      { location: '원주', text: "— '333축제', '디스토피아 크리스마스' 기획 및 실행" },
      { location: '신당', text: '— 상권 관측 및 상인 인터뷰 착수' },
    ],
  },
  {
    year: '2024',
    events: [
      { location: '신당', text: '— 성균관대 건축학과 현장 공동조사 실행' },
      { location: '신당', text: "— '엉금상가' 기획·운영 (공유거점·실험 플랫폼)" },
      { location: '원주', text: "— '아란' 소유구조 개편을 통한 지역 환원" },
    ],
  },
  {
    year: '2025',
    events: [
      { location: '원주', text: '— 상인회 홍보차장 직책 수행·공실 의제 상향' },
      { location: '원주', text: "— '상생마켓' 기획·홍보 용역, 공실 팝업 운영" },
      { location: '신당', text: '— 신당오길 상점가 리플렛·현판 제작 용역' },
      { location: '신당', text: '— 신당오길 상인 기록 출판물 제작 진행 중' },
    ],
  },
]

export default function History() {
  return (
    <section id="history">
      <div className="section-number fade-in">03</div>
      <div className="section-title fade-in">연혁</div>
      <div className="section-subtitle fade-in">2022년부터 현장에서 축적해 온 기록</div>

      <div className="timeline">
        {timeline.map((t) => (
          <div key={t.year} className="timeline-year fade-in">
            <div className="year-label">{t.year}</div>
            <div className="events">
              {t.events.map((e, i) => (
                <span key={i}>
                  {e.location && <span className="location">{e.location}</span>}
                  {e.text}
                  <br />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
