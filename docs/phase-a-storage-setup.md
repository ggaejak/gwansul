# Phase A — Supabase Storage 설정 가이드

현장 조사 사진 저장용 버킷(`survey-photos`) 셋업.
SQL 로는 자동화 어려우므로 **Supabase Dashboard 에서 수동 설정** 필요.

---

## 1. 버킷 생성

Supabase Dashboard → **Storage** → **Create new bucket**

| 항목 | 값 |
|------|-----|
| Name | `survey-photos` |
| Public bucket | **ON** (체크) |
| File size limit | `2 MB` (압축 후 200~500KB 예상, 안전망 2MB) |
| Allowed MIME types | `image/jpeg, image/webp` |

> Public bucket 으로 설정하는 이유: 대시보드에서 사진을 그대로
> `<img src>` 로 표시하기 위함. 신당동 외관 사진은 민감 정보 아님.
> 민감 데이터가 아닌지 운영 중 재검토 필요.

---

## 2. RLS 정책

**Storage → Policies → survey-photos** 에서 정책 4 개 추가:

### (a) 공개 읽기 — 모든 사용자가 사진 표시 가능

| 항목 | 값 |
|------|-----|
| Policy name | `survey_photos_public_read` |
| Allowed operation | SELECT |
| Target roles | `anon, authenticated` |
| USING expression | `bucket_id = 'survey-photos'` |

### (b) 익명 업로드 — 조사원이 사진 올림

| 항목 | 값 |
|------|-----|
| Policy name | `survey_photos_anon_insert` |
| Allowed operation | INSERT |
| Target roles | `anon, authenticated` |
| WITH CHECK expression | `bucket_id = 'survey-photos'` |

### (c) 수정 차단

| 항목 | 값 |
|------|-----|
| Policy name | (생성하지 않음 — 기본 거부) |

UPDATE 정책을 만들지 않음으로써 조사원이 자기/타인 사진을 덮어쓰지 못하게 함.

### (d) 삭제 차단 (관리자만 — service_role)

UPDATE 와 마찬가지로 정책 미생성. 관리자 페이지에서 사진을 삭제하려면 service_role 키 사용.

---

## 3. 경로 컨벤션

클라이언트(Phase B)에서 따를 규칙:

```
survey-photos/{yyyy-mm}/{survey_id}_{idx}.jpg
```

예: `survey-photos/2026-05/3a8b1c5e-...-1234_0.jpg`

- `{yyyy-mm}` 월별 분산 — 한 디렉토리에 수만 장 쌓이는 것 방지
- `{survey_id}` field_surveys.id (UUID, 클라에서 미리 생성)
- `{idx}` 같은 조사에 사진 여러 장일 때 0,1,2,...

`field_surveys.photo_paths` 에는 **버킷명 제외 경로**만 저장:
- 저장값 예: `2026-05/3a8b1c5e-..._0.jpg`
- 표시 시: `${bucket_public_url}/${path}` 로 조립

---

## 4. 사진 압축 정책 (Phase B 구현 시)

- 라이브러리: `browser-image-compression` (npm) 권장
- 최대 너비: 1600px
- 품질: 0.7 (JPEG)
- 목표 크기: 200~500KB
- 압축 실패 시: 사용자에게 경고 후 전송 보류 (서버 부담 방지)

---

## 5. 무료 티어 제약

Supabase Free tier:
- Storage: **1 GB**
- 평균 사진 350KB → 약 **2,800 장** 적재 가능
- 1 건물당 1 장 가정 시 신당동 건물(약 1,000~2,000 동) 1 회 조사 분량

조사 진행 중 용량 추적은 Phase C4 진행률 대시보드에서 노출 권장 (Storage 사용량 API 호출).

---

## 6. 검증

업로드 테스트 (브라우저 콘솔에서):

```js
import { supabase } from '@/lib/supabase'

// 임의 1x1 PNG 업로드
const blob = await fetch(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
).then(r => r.blob())

const { data, error } = await supabase.storage
  .from('survey-photos')
  .upload('test/probe.png', blob)

console.log({ data, error })
// 기대: data.path = 'test/probe.png', error = null
```

이후 Storage UI 에서 파일 확인 → 삭제.
