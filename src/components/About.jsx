const pillars = [
  {
    num: '01',
    title: '데이터',
    desc: '도시 운영에서 발생하는 사실을 기록하고 누적합니다. 단기적 감각 대신 축적된 근거에 기반한 운영 결정을 가능하게 하는 학습 장치입니다.',
  },
  {
    num: '02',
    title: 'PPP',
    desc: '공공의 목적을 유지한 상태에서 민간의 자본·시간·관리 능력을 결합합니다. 운영의 지속성과 책임을 제도적 구조로 확보하기 위한 장치입니다.',
  },
  {
    num: '03',
    title: '지역경제',
    desc: '해당 지역 내부에서 수익이 순환되는 구조를 마련합니다. 지역 내 이익이 운영에 재투입될 때, 도시는 자생적 유지 상태에 도달합니다.',
  },
  {
    num: '04',
    title: '소유구조',
    desc: '도시 자산이 단기 이익이나 개인 의사에 의해 흔들리지 않도록 편성합니다. 주체가 변경되어도 운영의 목적과 규칙이 유지되는 근간입니다.',
  },
]

export default function About() {
  return (
    <section id="about">
      <div className="section-number fade-in">01</div>
      <div className="section-title fade-in">도시운영의 네 개의 축</div>
      <div className="section-subtitle fade-in">
        이 네 개의 축이 동시에 작동할 때, 도시는 개입 없이도 유지되는 상태에 도달합니다.
      </div>

      <div className="pillars">
        {pillars.map((p, i) => (
          <div key={p.num} className={`pillar fade-in${i > 0 ? ` fade-in-delay-${i}` : ''}`}>
            <div className="pillar-num">{p.num}</div>
            <h3>{p.title}</h3>
            <p>{p.desc}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
