// 조사 입력 / 수정 폼 (모달 시트).
//
// 두 모드 공유:
//   mode='new'  : 신규 입력 (saveSurvey)
//   mode='edit' : 기존 row 수정 (updateSurvey, pending 만)
//
// 흐름:
//   1) Canvas 압축 (src/lib/compressImage.js) 으로 사진 200~500KB 로 줄임
//   2) 새 사진을 Storage 에 업로드 (uploadSurveyPhoto)
//   3) saveSurvey or updateSurvey 호출
//
// 사진 인덱스:
//   기존 photo_paths 의 _N.jpg 에서 가장 큰 N 을 찾아 N+1 부터 부여 →
//   삭제로 인한 hole 이 있어도 충돌 안 남.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  generateSurveyId,
  makePhotoPath,
  uploadSurveyPhoto,
  saveSurvey,
  updateSurvey,
  getPhotoUrl,
} from '../../data/surveys'
import { compressImage } from '../../lib/compressImage'
import {
  TYPE_LABELS,
  FIRST_FLOOR_USE_OPTIONS,
  FIRST_FLOOR_USE_LABEL,
  NIGHT_BRIGHTNESS_OPTIONS,
  ROAD_WIDTH_OPTIONS,
  POINT_CATEGORY_OPTIONS,
  getEntranceLocations,
} from '../../lib/surveyLabels'


function nextPhotoIndex(existingPaths) {
  let max = -1
  for (const p of existingPaths) {
    const m = p.match(/_(\d+)\.[a-z0-9]+$/i)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max + 1
}

function formatLatLng(loc) {
  if (!loc || typeof loc.lng !== 'number' || typeof loc.lat !== 'number') return '-'
  return `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`
}


export default function SurveyForm({
  mode,           // 'new' | 'edit'
  surveyType,     // 'building' | 'road' | 'point'
  location,       // { lng, lat }
  building,       // { id, pnu, bldNm } | null
  initialFeature, // edit 모드 prefill
  onClose,
  onSaved,
  onStartEntrancePick,   // (onPick) => void — 콜백 등록 + 픽 모드 진입
  onStopEntrancePick,    // () => void — 픽 모드 종료
  onEntrancesChange,     // (locations[]) => void — 입구 배열 변경 시 부모 broadcast (지도 미리보기용)
  pickingEntrance,       // boolean — 부모가 입구 지정 모드일 때 폼을 화면 밖으로
}) {
  // ─── 초기값 ─────────────────────────────────────────────
  const initialPayload = initialFeature?.properties?.payload || {}
  const initialMemo    = initialFeature?.properties?.memo || ''
  const initialPaths   = initialFeature?.properties?.photoPaths || []
  // 입구 좌표 — 신규는 entrance_locations 배열, 레거시는 entrance_location 단일 자동 흡수
  const initialEntrances = getEntranceLocations(initialPayload)

  const [payload, setPayload] = useState(initialPayload)
  const [memo,    setMemo]    = useState(initialMemo)
  const [entranceLocations, setEntranceLocations] = useState(initialEntrances)

  // 부모(SurveyMap) 에 현재 입구 배열을 broadcast — 지도 위 빨간 문 미리보기 마커용.
  // 폼이 마운트되는 순간(initialEntrances)과 이후 추가/삭제 모두 반영.
  useEffect(() => {
    onEntrancesChange?.(entranceLocations)
  }, [entranceLocations, onEntrancesChange])
  const [existingPhotos, setExistingPhotos] = useState(
    initialPaths.map(path => ({ path, url: getPhotoUrl(path) })),
  )
  const [newPhotos, setNewPhotos] = useState([])     // [{ key, file, blob, preview }]
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState('')
  const fileInputRef = useRef(null)

  // 1층 업종 — 다중 선택 (chip 토글) + 1 개의 자유 텍스트(직접입력) 슬롯.
  // 저장은 항상 string[] (코드 + 자유 텍스트 혼용 가능).
  // 레거시 단일 문자열도 wrap 해서 처리.
  const initialUseArr = Array.isArray(initialPayload.first_floor_use)
    ? initialPayload.first_floor_use
    : (initialPayload.first_floor_use ? [initialPayload.first_floor_use] : [])
  // 사전 코드와 자유 텍스트 분리 (직접입력 슬롯 prefill)
  const initialCodes  = initialUseArr.filter(v => FIRST_FLOOR_USE_LABEL[v])
  const initialCustom = initialUseArr.find(v => !FIRST_FLOOR_USE_LABEL[v]) || ''

  const [selectedUseCodes, setSelectedUseCodes] = useState(initialCodes)
  const [customUseText,    setCustomUseText]    = useState(initialCustom)
  const [useCustomOn,      setUseCustomOn]      = useState(!!initialCustom)

  // payload.first_floor_use 동기화 — selectedUseCodes / customUseText 변경 시 반영.
  function commitFirstFloorUse(codes, customOn, customVal) {
    const arr = [...codes]
    if (customOn && customVal.trim()) arr.push(customVal.trim())
    setPayload(prev => {
      const next = { ...prev }
      if (arr.length > 0) next.first_floor_use = arr
      else delete next.first_floor_use
      return next
    })
  }

  function toggleUseCode(code) {
    const next = selectedUseCodes.includes(code)
      ? selectedUseCodes.filter(c => c !== code)
      : [...selectedUseCodes, code]
    setSelectedUseCodes(next)
    commitFirstFloorUse(next, useCustomOn, customUseText)
  }

  function toggleCustomUse() {
    const next = !useCustomOn
    setUseCustomOn(next)
    commitFirstFloorUse(selectedUseCodes, next, customUseText)
  }

  function changeCustomUseText(t) {
    setCustomUseText(t)
    commitFirstFloorUse(selectedUseCodes, useCustomOn, t)
  }

  const totalPhotoCount = existingPhotos.length + newPhotos.length

  // ─── 검증 ─────────────────────────────────────────────────
  const validationErrors = useMemo(() => {
    const errs = []
    if (surveyType === 'building') {
      const uses = payload.first_floor_use
      const useCount = Array.isArray(uses)
        ? uses.length
        : (uses ? 1 : 0)
      if (useCount === 0)            errs.push('1층 업종을 1개 이상 선택하세요')
      if (totalPhotoCount < 1)       errs.push('외관 사진을 1장 이상 첨부하세요')
    } else if (surveyType === 'road') {
      if (!payload.night_brightness) errs.push('야간 밝기를 선택하세요')
      if (!payload.road_width)       errs.push('도로 폭을 선택하세요')
    } else if (surveyType === 'point') {
      if (!payload.category)         errs.push('카테고리를 선택하세요')
    }
    return errs
  }, [surveyType, payload, memo, totalPhotoCount])

  const isValid = validationErrors.length === 0

  // ─── 사진 핸들러 ─────────────────────────────────────────
  async function handleFileSelect(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''  // 같은 파일 재선택 가능하게 reset
    if (files.length === 0) return

    setError('')
    const added = []
    for (const file of files) {
      try {
        const blob = await compressImage(file)
        const preview = URL.createObjectURL(blob)
        added.push({
          key: crypto.randomUUID(),
          file,
          blob,
          preview,
        })
      } catch (err) {
        setError(`사진 압축 실패: ${err.message}`)
        return
      }
    }
    setNewPhotos(prev => [...prev, ...added])
  }

  function removeExistingPhoto(path) {
    setExistingPhotos(prev => prev.filter(p => p.path !== path))
  }

  function removeNewPhoto(key) {
    setNewPhotos(prev => {
      const target = prev.find(p => p.key === key)
      if (target?.preview) URL.revokeObjectURL(target.preview)
      return prev.filter(p => p.key !== key)
    })
  }

  // ─── 입구 위치 픽 (연속 모드) ─────────────────────────────
  // 모드 진입 후 사용자가 지도에서 점을 여러 개 찍을 수 있음.
  // 각 픽마다 onPick 콜백이 호출되어 배열에 추가.
  // 모드 종료는 부모(SurveyMap)의 "완료" 버튼 또는 onStopEntrancePick().
  function handleStartEntrancePick() {
    if (!onStartEntrancePick) return
    onStartEntrancePick(({ lng, lat }) => {
      setEntranceLocations(prev => [...prev, { lng, lat }])
    })
  }

  function handleRemoveEntrance(index) {
    setEntranceLocations(prev => prev.filter((_, i) => i !== index))
  }

  // ─── 저장 ─────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    if (!isValid || submitting) return
    setSubmitting(true)
    setError('')

    try {
      const surveyId = mode === 'edit'
        ? initialFeature.properties.id
        : generateSurveyId()

      // 1) 새 사진 업로드 (인덱스: 기존 최대 + 1 부터)
      const existingPaths = existingPhotos.map(p => p.path)
      let nextIdx = nextPhotoIndex(existingPaths)
      const newPaths = []
      for (const p of newPhotos) {
        const path = makePhotoPath(surveyId, nextIdx++)
        await uploadSurveyPhoto(p.blob, path)
        newPaths.push(path)
      }
      const finalPhotoPaths = [...existingPaths, ...newPaths]

      // entrance_locations: 한 개 이상 있을 때만 payload 에 포함.
      // payload state 는 initialPayload 복사본이라 미터치 시 옛 값이 남아있을 수 있어
      // 항상 entranceLocations state 기준으로 재구성. 레거시 단일 키도 함께 제거.
      const finalPayload = { ...payload }
      delete finalPayload.entrance_location
      if (entranceLocations.length > 0) {
        finalPayload.entrance_locations = entranceLocations.map(p => ({
          lng: p.lng,
          lat: p.lat,
        }))
      } else {
        delete finalPayload.entrance_locations
      }

      // 2) DB
      if (mode === 'new') {
        const fullLoc = location || initialFeature?.geometry
        // initialFeature 가 location 백업으로 쓰일 일은 사실상 없지만 안전망.
        await saveSurvey({
          id:          surveyId,
          surveyType,
          lng:         location.lng,
          lat:         location.lat,
          buildingId:  building?.id ?? null,
          buildingPnu: building?.pnu ?? null,
          payload:     finalPayload,
          memo:        memo || null,
          photoPaths:  finalPhotoPaths,
        })
      } else {
        await updateSurvey(surveyId, {
          payload:    finalPayload,
          memo:       memo || null,
          photoPaths: finalPhotoPaths,
        })
      }

      // 미리보기 URL 메모리 해제
      newPhotos.forEach(p => p.preview && URL.revokeObjectURL(p.preview))

      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err.message || '저장에 실패했습니다')
      setSubmitting(false)
    }
  }

  // ─── 렌더 ─────────────────────────────────────────────────
  const headerTitle = `${TYPE_LABELS[surveyType] || '조사'} — ${mode === 'edit' ? '수정' : '신규 입력'}`
  const buildingLine = building?.bldNm || building?.pnu

  return (
    <>
      <div
        className={`sv-form-backdrop ${pickingEntrance ? 'is-picking' : ''}`}
        onClick={() => { if (!submitting && !pickingEntrance) onClose?.() }}
      />
      <form
        className={`sv-form-sheet ${pickingEntrance ? 'is-picking' : ''}`}
        onSubmit={handleSubmit}
      >
        <div className="sv-sheet-handle" />

        <header className="sv-form-header">
          <div className="sv-form-title-line">
            <h2 className="sv-form-title">{headerTitle}</h2>
            <button
              type="button"
              className="sv-form-close"
              onClick={() => { if (!submitting) onClose?.() }}
              aria-label="닫기"
            >×</button>
          </div>
          {buildingLine && surveyType === 'building' && (
            <div className="sv-form-building">{buildingLine}</div>
          )}
        </header>

        <div className="sv-form-body">

          {/* ── 건물 — 1층 업종 (다중 선택 + 직접입력) ── */}
          {surveyType === 'building' && (
            <div className="sv-form-field">
              <div className="sv-form-label">
                1층 업종 <span className="sv-required">*</span>
                <span className="sv-form-label-aux">중복 선택 가능</span>
              </div>
              <div className="sv-form-chips">
                {FIRST_FLOOR_USE_OPTIONS.map(o => {
                  const active = selectedUseCodes.includes(o.code)
                  return (
                    <button
                      key={o.code}
                      type="button"
                      className={`sv-chip ${active ? 'active' : ''}`}
                      onClick={() => toggleUseCode(o.code)}
                      aria-pressed={active}
                    >
                      {o.label}
                    </button>
                  )
                })}
                <button
                  type="button"
                  className={`sv-chip ${useCustomOn ? 'active' : ''}`}
                  onClick={toggleCustomUse}
                  aria-pressed={useCustomOn}
                >
                  + 직접입력
                </button>
              </div>
              {useCustomOn && (
                <input
                  type="text"
                  className="sv-form-input"
                  value={customUseText}
                  onChange={e => changeCustomUseText(e.target.value)}
                  placeholder="추가 업종 (자유 입력)"
                  maxLength={40}
                  autoFocus
                />
              )}
            </div>
          )}

          {/* ── 건물 — 층 수 ── */}
          {surveyType === 'building' && (
            <div className="sv-form-field">
              <div className="sv-form-label">층 수</div>
              <input
                type="number"
                inputMode="numeric"
                className="sv-form-input"
                min="1"
                step="1"
                value={payload.floor_count ?? ''}
                onChange={e => {
                  const v = e.target.value
                  if (v === '') {
                    const { floor_count: _omit, ...rest } = payload
                    setPayload(rest)
                  } else {
                    const n = parseInt(v, 10)
                    setPayload({
                      ...payload,
                      floor_count: Number.isFinite(n) && n > 0 ? n : undefined,
                    })
                  }
                }}
                placeholder="예: 4"
              />
            </div>
          )}

          {/* ── 건물 — 공실 여부 ── */}
          {surveyType === 'building' && (
            <label className="sv-form-check">
              <input
                type="checkbox"
                checked={!!payload.is_vacant}
                onChange={e => setPayload({ ...payload, is_vacant: e.target.checked })}
              />
              <span>공실</span>
            </label>
          )}

          {/* ── 도로 — 야간 밝기 ── */}
          {surveyType === 'road' && (
            <FieldSelect
              label="야간 밝기"
              required
              value={payload.night_brightness || ''}
              onChange={v => setPayload({ ...payload, night_brightness: v || undefined })}
              options={NIGHT_BRIGHTNESS_OPTIONS}
              placeholder="선택하세요"
            />
          )}

          {/* ── 도로 — 도로 폭 ── */}
          {surveyType === 'road' && (
            <FieldSelect
              label="도로 폭"
              required
              value={payload.road_width || ''}
              onChange={v => setPayload({ ...payload, road_width: v || undefined })}
              options={ROAD_WIDTH_OPTIONS}
              placeholder="선택하세요"
            />
          )}

          {/* ── 점 — 카테고리 ── */}
          {surveyType === 'point' && (
            <FieldSelect
              label="카테고리"
              required
              value={payload.category || ''}
              onChange={v => setPayload({ ...payload, category: v || undefined })}
              options={POINT_CATEGORY_OPTIONS}
              placeholder="선택하세요"
            />
          )}

          {/* ── 사진 ── */}
          <div className="sv-form-field">
            <div className="sv-form-label">
              사진 {surveyType === 'building' && <span className="sv-required">*</span>}
              <span className="sv-form-label-aux">{totalPhotoCount}장</span>
            </div>
            <div className="sv-photos">
              {existingPhotos.map(({ path, url }) => (
                <div key={path} className="sv-photo-thumb">
                  <img src={url} alt="기존 사진" />
                  <button
                    type="button"
                    className="sv-photo-remove"
                    onClick={() => removeExistingPhoto(path)}
                    aria-label="사진 삭제"
                  >×</button>
                </div>
              ))}
              {newPhotos.map(({ key, preview }) => (
                <div key={key} className="sv-photo-thumb sv-photo-new">
                  <img src={preview} alt="새 사진" />
                  <button
                    type="button"
                    className="sv-photo-remove"
                    onClick={() => removeNewPhoto(key)}
                    aria-label="사진 삭제"
                  >×</button>
                </div>
              ))}
              <button
                type="button"
                className="sv-photo-add"
                onClick={() => fileInputRef.current?.click()}
                aria-label="사진 추가"
              >
                <span>+</span>
                <small>사진 추가</small>
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>

          {/* ── 메모 ── */}
          <div className="sv-form-field">
            <div className="sv-form-label">메모</div>
            <textarea
              className="sv-form-textarea"
              rows={3}
              value={memo}
              onChange={e => setMemo(e.target.value)}
              placeholder="자유 메모 (선택)"
            />
          </div>

          {/* ── 위치 ── */}
          <div className="sv-form-field">
            <div className="sv-form-label">위치</div>
            <div className="sv-form-coords">
              {formatLatLng(location || (initialFeature && {
                lng: initialFeature.geometry.coordinates[0],
                lat: initialFeature.geometry.coordinates[1],
              }))}
            </div>
          </div>

          {/* ── 건물 — 입구 위치 (선택, 여러 개 가능) ── */}
          {surveyType === 'building' && (
            <div className="sv-form-field">
              <div className="sv-form-label">
                건물 입구 위치
                <span className="sv-form-label-aux">
                  선택{entranceLocations.length > 0 && ` · ${entranceLocations.length}개`}
                </span>
              </div>
              {entranceLocations.length > 0 && (
                <div className="sv-entrance-list">
                  {entranceLocations.map((loc, i) => (
                    <div key={`${loc.lat},${loc.lng},${i}`} className="sv-entrance-row">
                      <div className="sv-entrance-coords">
                        ✓ {i + 1}. {loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}
                      </div>
                      <button
                        type="button"
                        className="sv-entrance-clear"
                        onClick={() => handleRemoveEntrance(i)}
                      >
                        삭제
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="sv-entrance-pick"
                onClick={handleStartEntrancePick}
                disabled={!onStartEntrancePick || pickingEntrance}
              >
                {entranceLocations.length > 0
                  ? '+ 지도에서 입구 추가'
                  : '지도에서 입구 선택'}
              </button>
            </div>
          )}

        </div>

        <footer className="sv-form-footer">
          {error && <p className="sv-form-error">{error}</p>}
          {!error && validationErrors.length > 0 && (
            <p className="sv-form-hint">{validationErrors[0]}</p>
          )}
          <div className="sv-form-actions">
            <button
              type="button"
              className="sv-btn-secondary"
              onClick={() => { if (!submitting) onClose?.() }}
              disabled={submitting}
            >
              취소
            </button>
            <button
              type="submit"
              className="sv-btn-primary"
              disabled={!isValid || submitting}
            >
              {submitting ? '저장 중...' : (mode === 'edit' ? '수정 저장' : '저장')}
            </button>
          </div>
        </footer>
      </form>
    </>
  )
}


// ─── 작은 select 헬퍼 ───────────────────────────────────────
function FieldSelect({ label, required, value, onChange, options, placeholder }) {
  return (
    <div className="sv-form-field">
      <div className="sv-form-label">
        {label} {required && <span className="sv-required">*</span>}
      </div>
      <select
        className="sv-form-select"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o.code} value={o.code}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}
