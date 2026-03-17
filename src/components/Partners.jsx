const partners = [
  { name: '성균관대학교 건축학과 김우영 교수', type: '공동 현장조사' },
  { name: '연세대학교 디자인학과', type: '기획 협업' },
  { name: '건강보험심사평가원', type: '축제 협업' },
  { name: '원주혁신도시 상인회', type: '상권 운영 협력' },
  { name: '원주 영상미디어센터', type: '콘텐츠 협업' },
  { name: 'ANU (윤혁경 상임고문)', type: '자문' },
  { name: '신당오길 골목형 상점가', type: '상권 CI 용역' },
]

export default function Partners() {
  return (
    <section id="partners">
      <div className="partners-label fade-in">Collaboration Partners</div>
      <div className="partners-grid fade-in">
        {partners.map((p) => (
          <div key={p.name} className="partner-item">
            {p.name}
            <span className="partner-type">{p.type}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
