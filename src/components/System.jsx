const steps = [
  {
    num: '01',
    title: '관측',
    desc: '도시가 실제로 어떻게\n작동하는지 읽는 과정',
    detail: '생활패턴·공실률·이동밀도 등\n정량 데이터 축적',
  },
  {
    num: '02',
    title: '기획',
    desc: '지역 특성에 맞춘 프로그램으로\n거점을 설계·제작',
    detail: '디자인·시공·운영을\n직접 수행하여 현장 검증',
  },
  {
    num: '03',
    title: '조정',
    desc: '다양한 단체의 관점과 입장을\n종합하여 방향을 정립',
    detail: '공청회·상인회 등\n공식 채널을 통한 합의 구축',
  },
  {
    num: '04',
    title: '운영',
    desc: '소유구조 재편을 통해\n지속성을 확보하는 장치',
    detail: '독립 운영 전환 및\n매출연동 임대모델 적용',
  },
]

export default function System() {
  return (
    <section id="system">
      <div className="section-number fade-in">02</div>
      <div className="section-title fade-in" style={{ color: '#fff' }}>관설이 구축하는 시스템</div>
      <div className="section-subtitle fade-in">
        네 단계의 연속 구조로 작동하며, 도시를 운영 가능한 상태로 전환합니다.
      </div>

      <div className="system-flow">
        {steps.map((s, i) => (
          <div key={s.num} className={`flow-step fade-in${i > 0 ? ` fade-in-delay-${i}` : ''}`}>
            <div className="step-num">{s.num}</div>
            <h3>{s.title}</h3>
            <p>{s.desc.split('\n').map((line, j) => <span key={j}>{line}{j === 0 && <br />}</span>)}</p>
            <div className="step-detail">
              {s.detail.split('\n').map((line, j) => <span key={j}>{line}{j === 0 && <br />}</span>)}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
