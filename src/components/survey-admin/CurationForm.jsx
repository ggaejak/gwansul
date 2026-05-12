// 정제(curated_*) 입력 폼.
//
// survey_type 별로 다른 필드를 렌더링하지만, 외부 인터페이스는 동일:
//   props: { surveyType, payload, value, onChange }
//   value 는 controlled state — 부모(SurveyDetailPanel) 가 보유.
//
// payload 에서 초기값을 추출하는 책임은 부모에 있음 (selectedSurvey 변경 시
// useEffect 로 value 를 prefill). 이 컴포넌트는 순수 표시 + 이벤트.

import {
  FIRST_FLOOR_USE_OPTIONS,
  NIGHT_BRIGHTNESS_OPTIONS,
  ROAD_WIDTH_OPTIONS,
  POINT_CATEGORY_OPTIONS,
} from '../../lib/surveyLabels'

export default function CurationForm({ surveyType, value, onChange, disabled }) {
  const v = value || {}
  const set = (patch) => onChange({ ...v, ...patch })

  if (surveyType === 'building') {
    return (
      <div className="sa-form">
        <div className="sa-form-row">
          <label className="sa-form-label" htmlFor="cf-first-floor-use">1층 업종</label>
          <select
            id="cf-first-floor-use"
            className="sa-form-select"
            value={v.firstFloorUse ?? ''}
            onChange={e => set({ firstFloorUse: e.target.value || null })}
            disabled={disabled}
          >
            <option value="">— 선택 —</option>
            {FIRST_FLOOR_USE_OPTIONS.map(opt => (
              <option key={opt.code} value={opt.code}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="sa-form-row">
          <label className="sa-form-label" htmlFor="cf-is-vacant">공실 여부</label>
          <div className="sa-form-radios">
            <label className="sa-radio">
              <input
                type="radio"
                name="cf-is-vacant"
                checked={v.isVacant === false}
                onChange={() => set({ isVacant: false })}
                disabled={disabled}
              />
              운영 중
            </label>
            <label className="sa-radio">
              <input
                type="radio"
                name="cf-is-vacant"
                checked={v.isVacant === true}
                onChange={() => set({ isVacant: true })}
                disabled={disabled}
              />
              공실
            </label>
            <label className="sa-radio">
              <input
                type="radio"
                name="cf-is-vacant"
                checked={v.isVacant == null}
                onChange={() => set({ isVacant: null })}
                disabled={disabled}
              />
              미상
            </label>
          </div>
        </div>

        <AdminMemoField v={v} set={set} disabled={disabled} />
      </div>
    )
  }

  if (surveyType === 'road') {
    return (
      <div className="sa-form">
        <RadioGroup
          id="cf-night"
          label="야간 밝기"
          options={NIGHT_BRIGHTNESS_OPTIONS}
          value={v.nightBrightness}
          onChange={code => set({ nightBrightness: code })}
          disabled={disabled}
          allowNull
        />
        <RadioGroup
          id="cf-road-width"
          label="도로 폭"
          options={ROAD_WIDTH_OPTIONS}
          value={v.roadWidth}
          onChange={code => set({ roadWidth: code })}
          disabled={disabled}
          allowNull
        />
        <AdminMemoField v={v} set={set} disabled={disabled} />
      </div>
    )
  }

  if (surveyType === 'point') {
    return (
      <div className="sa-form">
        <RadioGroup
          id="cf-category"
          label="카테고리 *"
          options={POINT_CATEGORY_OPTIONS}
          value={v.category}
          onChange={code => set({ category: code })}
          disabled={disabled}
        />
        <AdminMemoField v={v} set={set} disabled={disabled} />
        {!v.category && (
          <p className="sa-form-warning">
            점 조사는 카테고리가 필수입니다 (NOT NULL).
          </p>
        )}
      </div>
    )
  }

  return null
}

// ─── 보조 컴포넌트 ──────────────────────────────────────────────

function RadioGroup({ id, label, options, value, onChange, disabled, allowNull }) {
  return (
    <div className="sa-form-row">
      <label className="sa-form-label">{label}</label>
      <div className="sa-form-radios">
        {options.map(opt => (
          <label key={opt.code} className="sa-radio">
            <input
              type="radio"
              name={id}
              value={opt.code}
              checked={value === opt.code}
              onChange={() => onChange(opt.code)}
              disabled={disabled}
            />
            {opt.label}
          </label>
        ))}
        {allowNull && (
          <label className="sa-radio">
            <input
              type="radio"
              name={id}
              checked={value == null}
              onChange={() => onChange(null)}
              disabled={disabled}
            />
            미상
          </label>
        )}
      </div>
    </div>
  )
}

function AdminMemoField({ v, set, disabled }) {
  return (
    <div className="sa-form-row">
      <label className="sa-form-label" htmlFor="cf-admin-memo">관리자 메모</label>
      <textarea
        id="cf-admin-memo"
        className="sa-form-textarea"
        rows={3}
        value={v.adminMemo ?? ''}
        onChange={e => set({ adminMemo: e.target.value || null })}
        disabled={disabled}
        placeholder="정제 시 참고 메모 (선택)"
      />
    </div>
  )
}
