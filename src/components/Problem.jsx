const problems = [
  { label: 'Issue 01', text: '단기 보조금·용역 중심의 개입은 사업 종료와 함께 효과가 소멸됩니다.' },
  { label: 'Issue 02', text: '운영 규칙 없이 선언된 계획은 주체가 바뀌면 지속되지 않습니다.' },
  { label: 'Issue 03', text: '민간·행정·상인 등 서로 다른 시간축을 가진 주체들 간의 조정 구조가 부재합니다.' },
  { label: 'Issue 04', text: '소유구조가 정비되지 않으면 장기 운영은 개인 의사에 좌우됩니다.' },
]

const solutions = [
  { label: 'Response 01', text: '지역 내부에서 수익이 순환되는 구조를 먼저 설계합니다. 외부 지원 종료 후에도 자생할 수 있어야 합니다.' },
  { label: 'Response 02', text: '운영 규칙과 축적 구조를 제도적으로 편성합니다. 주체가 변경되어도 규칙이 유지됩니다.' },
  { label: 'Response 03', text: 'PPP 구조로 공공의 목적과 민간의 실행력을 결합합니다. 갈등 조정이 아닌 지속성 확보가 핵심입니다.' },
  { label: 'Response 04', text: '소유구조 재편을 통해 장기 운영이 가능한 형태로 전환합니다. \'아란\' 독립 운영 전환이 실증 사례입니다.' },
]

export default function Problem() {
  return (
    <section id="problem">
      <div className="section-number fade-in">PROBLEM & APPROACH</div>
      <div className="section-title fade-in">왜 도시는 개입이 끝나면<br />다시 침체되는가</div>
      <div className="section-subtitle fade-in">관설은 이 질문에서 출발합니다.</div>

      <div className="problem-grid">
        <div className="problem-side fade-in">
          <h3>기존 방식의 한계</h3>
          {problems.map((p) => (
            <div key={p.label} className="problem-item">
              <div className="label">{p.label}</div>
              <p>{p.text}</p>
            </div>
          ))}
        </div>
        <div className="solution-side fade-in fade-in-delay-1">
          <h3>관설의 접근</h3>
          {solutions.map((s) => (
            <div key={s.label} className="solution-item">
              <div className="label">{s.label}</div>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
