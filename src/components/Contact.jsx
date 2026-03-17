const details = [
  { label: '상호', value: '주식회사 관설' },
  { label: '본점', value: '강원특별자치도 원주시\n양지로 80, 108호(반곡동)' },
  { label: '지점', value: '서울특별시 중구\n퇴계로88길 17-6, 3층(신당동)' },
  { label: 'E-mail', value: 'gwansul743@gmail.com' },
  { label: 'Phone', value: '010-2708-0667' },
]

export default function Contact() {
  return (
    <section id="contact">
      <div className="contact-eyebrow fade-in">Let's Collaborate</div>
      <h2 className="contact-headline fade-in">
        도시를 <em>'개발 결과물'</em>이 아닌<br />
        <em>'운영 시스템'</em>으로 전환하는 일,<br />
        함께 시작하겠습니다
      </h2>
      <p className="contact-sub fade-in">
        공실 문제, 상권 활성화, 지역 운영 체계 구축 등<br />
        도시운영에 관한 협업을 기다립니다.
      </p>
      <div className="contact-actions fade-in">
        <a href="mailto:gwansul743@gmail.com" className="btn-white">이메일로 문의하기 &rarr;</a>
        <a href="tel:010-2708-0667" className="btn-outline-white">전화 상담</a>
      </div>
      <div className="contact-details fade-in">
        {details.map((d) => (
          <div key={d.label} className="contact-col">
            <div className="col-label">{d.label}</div>
            <div className="col-value">
              {d.value.split('\n').map((line, i) => (
                <span key={i}>{line}{i === 0 && d.value.includes('\n') && <br />}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
