const wonju = {
  tags: [
    { label: 'WONJU' },
    { label: '2022 — PRESENT' },
    { label: 'FULL CYCLE', style: { background: '#e8f5e9', color: '#4a7', fontWeight: 500 } },
  ],
  title: '강원원주혁신도시',
  desc: '분양 후 8년간 공실이 지속된 상가에서 출발하여 관측 → 기획 → 조정 → 운영 전환까지. 관설 시스템의 전체 프로세스가 최초로 적용·완결된 현장입니다.',
  bannerImg: '/images/img-002.jpg',
  bannerImgAlt: '아란 위스키 바',
  bannerLabel: 'FLAGSHIP',
  bannerTitle: '아란 — 취향 기반 위스키 바',
  metrics: [
    { num: '2년', label: '현장 관측 및 협력 기간' },
    { num: '20년', label: '장기 전략 설정 기간' },
    { num: '독립 전환', label: '아란 PD 파트너 체제' },
  ],
  photos: [
    { src: '/images/img-000.jpg', alt: '현장 관측 및 조사', caption: '현장 관측 및 조사 (2022–2023)' },
    { src: '/images/img-003.jpg', alt: '333축제', caption: '333축제 — 지역 커뮤니티 활성화 (2023)' },
    { src: '/images/img-007.jpg', alt: '공실 체험공간', caption: '공실 팝업 — 공실에서 공간으로 (2025)' },
  ],
  process: [
    { step: '01', tag: '관측', title: '현장 관측 수행', desc: '약 1년간 생활패턴·공실·이동밀도 등 현장관측을 수행. 높은 분양가와 과잉공급에 의한 공실 장기화 구조를 진단했습니다.' },
    { step: '02', tag: '기획', title: "거점 '아란' 기획·조성", desc: "취향 기반 위스키 바 '아란'을 기획. 연세대 디자인학과 협업으로 기획을 보완하고, 디자인·시공·운영을 직접 수행했습니다." },
    { step: '03', tag: '조정', title: '상인회 의제 격상', desc: '상인회와의 지속적 협의를 통해 공실을 향후 20년 존속을 위한 핵심 의제로 격상. 공청회와 지역행사를 통해 공식화했습니다.' },
    { step: '04', tag: '운영', title: '소유구조 전환', desc: "'아란'을 PD 파트너 체제로 독립 전환. 매출연동 임대모델 실증사례로서 공실 해결 구조로 확장 적용을 추진합니다." },
  ],
  outcome: "관설이 기획·조성한 '아란'은 2025년 5월 <strong>PD 파트너 체제로 독립 운영 전환</strong>에 성공. 단기 개입이 아닌 자생적 운영 모델의 실증 사례로, <strong>매출연동 임대모델</strong>을 상인회 전체로 확장 적용 중입니다.",
}

const sindang = {
  tags: [
    { label: 'SINDANG' },
    { label: '2023 — PRESENT' },
    { label: '관측 · 기획 단계', style: { background: '#e3f2fd', color: '#478', fontWeight: 500 } },
  ],
  title: '신당',
  desc: '약 2년간 서울·도쿄·중국 등에서 비교 관측을 수행한 뒤 대표 대상지로 선정. 성균관대학교 건축학과와 공동으로 대규모 현장조사를 진행 중인 두 번째 현장입니다.',
  bannerImg: '/images/img-018.jpg',
  bannerImgAlt: '엉금상가 행사',
  bannerLabel: 'COMMUNITY HUB',
  bannerTitle: '엉금상가 — 길드형 공유거점',
  metrics: [
    { num: '64+', label: '현장조사 수행 개소' },
    { num: '12개', label: '업장 심층 인터뷰' },
    { num: '15인', label: '주민 인터뷰' },
    { num: '17인', label: '엉금상가 가입 인원' },
  ],
  photos: [
    { src: '/images/img-012.jpg', alt: 'ANU 미팅', caption: '윤혁경 ANU 상임고문 미팅 (2024)' },
    { src: '/images/img-014.jpg', alt: '현장 인터뷰', caption: '상인 심층 인터뷰 (2025)' },
    { src: '/images/img-016.jpg', alt: '신당어르신 효잔치', caption: '신당어르신 효잔치 — 지역 연계 프로그램 (2025)' },
  ],
  process: [
    { step: '01', tag: '관측', title: '대규모 현장조사', desc: '성균관대 건축학과 김우영 교수 지도 아래 64개소 이상 현장조사, 12개 업장 심층 인터뷰, 주민 15인 인터뷰를 수행했습니다.' },
    { step: '02', tag: '기획', title: '엉금상가 기획', desc: '청년층이 주도적으로 일을 생성하고 네트워킹이 가능한 길드형 거점공간. 현재 가입 인원 17인을 확보했습니다.' },
    { step: '02', tag: '기획', title: '지역 프로그램·출판', desc: '「신당어르신효잔치」, 상권 CI 리플렛 제작, 이용자·방문자·이방인 관점의 기록 출판물을 제작 진행 중입니다.' },
    {
      step: '→',
      tag: 'NEXT',
      title: '조정·운영 단계 진입',
      desc: '관측과 기획을 기반으로 지역 주체 간 조정 구조를 편성하고, 소유구조 설계를 통한 장기 운영 체계로 전환할 예정입니다.',
      style: { background: '#f8f8f8' },
      stepStyle: { background: '#e3f2fd', color: '#478' },
      tagStyle: { background: '#e3f2fd', color: '#478' },
    },
  ],
}

function ProjectGroup({ project }) {
  return (
    <div className="project-group">
      <div className="project-banner fade-in">
        <div className="project-banner-info">
          <div className="project-header">
            {project.tags.map((t, i) => (
              <div key={i} className="project-tag" style={t.style}>{t.label}</div>
            ))}
          </div>
          <div className="project-title">{project.title}</div>
          <p className="project-desc">{project.desc}</p>
        </div>
        <div className="project-banner-photo">
          <img src={project.bannerImg} alt={project.bannerImgAlt} />
          <div className="photo-overlay">
            <div className="overlay-label">{project.bannerLabel}</div>
            <div className="overlay-title">{project.bannerTitle}</div>
          </div>
        </div>
      </div>

      <div className="project-metrics fade-in">
        {project.metrics.map((m, i) => (
          <div key={i} className="p-metric">
            <div className="p-metric-num">{m.num}</div>
            <div className="p-metric-label">{m.label}</div>
          </div>
        ))}
      </div>

      <div className="photo-grid grid-3 fade-in">
        {project.photos.map((p) => (
          <div key={p.src} className="photo-card">
            <img src={p.src} alt={p.alt} loading="lazy" />
            <div className="caption">{p.caption}</div>
          </div>
        ))}
      </div>

      <div className="process-cards fade-in">
        {project.process.map((c, i) => (
          <div key={i} className="process-card" style={c.style}>
            <div className="card-step" style={c.stepStyle}>{c.step}</div>
            <div className="card-tag" style={c.tagStyle}>{c.tag}</div>
            <h4>{c.title}</h4>
            <p>{c.desc}</p>
          </div>
        ))}
      </div>

      {project.outcome && (
        <div className="outcome-bar fade-in">
          <div className="outcome-icon">&#8594;</div>
          <div className="outcome-text">
            <div className="outcome-label">OUTCOME</div>
            <div
              className="outcome-desc"
              dangerouslySetInnerHTML={{ __html: project.outcome }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default function Projects() {
  return (
    <section id="projects">
      <div className="section-number fade-in">04 — 05</div>
      <div className="section-title fade-in">프로젝트</div>
      <div className="section-subtitle fade-in">
        원주 혁신도시와 신당 — 관설 시스템이 적용된 두 개의 현장
      </div>
      <ProjectGroup project={wonju} />
      <ProjectGroup project={sindang} />
    </section>
  )
}
