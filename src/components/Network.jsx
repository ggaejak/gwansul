const orgCards = [
  {
    featured: true,
    photo: '/images/img-022.jpg',
    role: 'Founder & Lead',
    name: '정승민',
    title: 'Urban Operations',
    desc: '관측 설계, 거점 기획·시공, 상인회 조정, 소유구조 설계 총괄',
  },
  {
    role: 'Academic Partner',
    name: '성균관대학교 건축학과',
    title: '김우영 교수 연구실',
    desc: '신당 현장조사 공동 수행, 5학년 수업 연계 프로젝트',
  },
  {
    role: 'Advisory',
    name: '윤혁경',
    title: 'ANU 상임고문',
    desc: '도시운영 전략 자문',
  },
  {
    role: 'Field Partner — Wonju',
    name: '원주혁신도시 상인회',
    title: '공실 의제 공동 운영',
    desc: '홍보차장 직책 수행, 공실 의제 공동 협업',
  },
  {
    role: 'Operational Partner',
    name: '아란 PD 파트너',
    title: '독립 운영 크루',
    desc: '관설로부터 분리된 독립 운영 체제, 매출연동 임대모델 실증',
  },
]

export default function Network() {
  return (
    <section id="network">
      <div className="section-number fade-in">06</div>
      <div className="section-title fade-in">조직 구조</div>
      <div className="section-subtitle fade-in">
        관설은 현장 운영 조직과 학술·자문 네트워크의 결합으로 작동합니다.
      </div>

      <div className="network-grid">
        <div className="network-left fade-in">
          <p className="network-desc">
            관설은 직접 운영을 수행한 현장 경험을 기반으로, 대학 연구실·지역 상인회·공공기관과의
            협업 네트워크를 통해 관측의 정밀도와 개입의 실효성을 확보합니다.
            1인 창업에서 출발했지만, 현재는 PD 파트너·연구 협력·자문 체계를 갖춘 조직으로 확장 중입니다.
          </p>
        </div>
        <div className="org-chart fade-in fade-in-delay-1">
          {orgCards.map((card, i) => (
            <div key={i} className={`org-card${card.featured ? ' featured' : ''}`}>
              {card.featured && (
                <img className="org-photo" src={card.photo} alt={card.name} />
              )}
              <div>
                <div className="org-role">{card.role}</div>
                <div className="org-name">{card.name}</div>
                <div className="org-title">{card.title}</div>
                <div className="org-desc">{card.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
