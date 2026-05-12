# Phase C — Storage `survey-photos` DELETE 정책 수동 설정

조사 데이터 삭제 시 Supabase Storage의 사진 파일도 함께 제거되도록
`survey-photos` 버킷에 DELETE 정책을 추가합니다. 이 작업은 SQL 마이그레이션이 아니라
**Supabase Dashboard 에서 수동 설정**합니다.

## 배경

- [supabase/migrations/00019_add_delete_capability.sql](../supabase/migrations/00019_add_delete_capability.sql) 가
  `field_surveys` 테이블의 DELETE RLS / 트리거 / admin RPC 를 모두 처리합니다.
- 클라이언트(`src/data/surveys.js` 의 `deleteSurvey` / `adminDeleteSurvey`)는
  DB 삭제 직전(조사원) 또는 직후(관리자)에 `supabase.storage.from('survey-photos').remove(...)` 를
  best-effort 로 호출합니다.
- `survey-photos` 버킷은 [docs/phase-a-storage-setup.md](./phase-a-storage-setup.md) 에서
  생성될 때 anon SELECT/INSERT 정책만 설정되어 있고 DELETE 가 막혀 있을 수 있습니다.
- 정책이 없으면 `remove()` 호출이 silent fail 또는 RLS 에러 → 사진은 Orphan 으로 남고
  DB row 만 삭제됩니다.

## 설정 절차

1. Supabase Dashboard → **Storage** → **Policies** 탭으로 이동
2. 좌측 사이드바에서 **survey-photos** 버킷 선택 (없으면 phase-a-storage-setup.md 의 단계 먼저)
3. **`New policy`** 클릭 → **`For full customization`** (또는 `Custom`)
4. 아래 값으로 채우기:

   - **Policy name**: `survey_photos_anon_delete`
   - **Allowed operation**: `DELETE` 한 가지만 체크
   - **Target roles**: `anon`, `authenticated` 모두 체크
   - **USING expression** (정책 식):

     ```sql
     bucket_id = 'survey-photos'
     ```

5. **Save policy** 클릭

## 검증

Supabase SQL Editor 에서:

```sql
SELECT name, policyname, cmd FROM storage.policies
WHERE name = 'survey_photos_anon_delete';
-- 기대: 1 row 반환, cmd = DELETE
```

또는 실제 동작 검증:

1. `/survey` 에서 새 조사 1건 입력 (사진 1장 포함)
2. 마커 클릭 → 상세 시트의 **[삭제]** 버튼
3. 두 단계 confirm 모두 OK
4. Supabase Dashboard → Storage → survey-photos 에서 해당 사진 파일이 사라졌는지 확인
5. SQL Editor: `SELECT * FROM field_surveys WHERE id = '<deleted-uuid>';` → 0 rows

## 정책을 설정하지 않으면

- DB row 는 정상 삭제 (RLS / RPC 가 처리)
- 사진 파일은 Storage 에 남음 — orphan
- 클라이언트 콘솔에 `[surveys.removePhotosBestEffort] Storage 삭제 실패` 경고 출력
- 사용자 화면에는 에러 없음 (best-effort 설계라 의도된 동작)

orphan 파일은 후속 cleanup job 또는 수동 청소 대상이 됩니다.

## 보안 고려

- 이 정책은 anon 에게 **survey-photos 버킷 내 모든 객체** DELETE 권한을 부여합니다.
- 비공개 페이지 password gate 모델(`/survey` 비밀번호로만 접근 가능) 하에서는 허용 가능.
- 외부 공개 환경으로 확장 시에는 객체 path prefix 기반 제한 등을 추가 검토 필요
  (예: `USING (bucket_id = 'survey-photos' AND (storage.foldername(name))[1] LIKE '...')`)
