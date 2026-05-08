-- ============================================================
-- Migration: 00014_storage_survey_photos_policies
-- Order:     14 (Phase B 후속 — Storage RLS 보강)
-- Purpose:   survey-photos 버킷의 anon SELECT/INSERT 정책을 SQL 로 설정.
--
--            증상: 클라이언트가 사진 업로드 시 "new row violates row-level
--                  security policy" 에러. INSERT 정책 누락 또는 anon 미포함.
--
--            (1) 모든 사용자 SELECT 허용 (공개 버킷이라 사진 표시 필요)
--            (2) anon/authenticated INSERT 허용 (조사원이 비로그인 상태로 업로드)
--            (3) UPDATE/DELETE 정책 미생성 → 기본 거부 (덮어쓰기/삭제 차단)
--                삭제는 service_role 만 가능 (admin cleanup job 시 사용)
--
-- 전제: storage.objects 테이블은 Supabase 가 기본 생성하고 RLS 가 켜져 있음.
--      survey-photos 버킷은 Dashboard 에서 사전 생성됨
--      (docs/phase-a-storage-setup.md §1 — Public bucket).
--
-- Verification (실행 후):
--   -- (1) 정책 2 개 존재
--   SELECT policyname, cmd, roles
--   FROM pg_policies
--   WHERE schemaname = 'storage'
--     AND tablename  = 'objects'
--     AND policyname LIKE 'survey_photos_%'
--   ORDER BY policyname;
--   -- 기대:
--   --  survey_photos_anon_insert | INSERT | {anon, authenticated}
--   --  survey_photos_public_read | SELECT | {anon, authenticated}
--
--   -- (2) 클라이언트 측 검증
--   --     /survey 에서 건물 조사 사진 업로드 → "저장 완료" 토스트 (에러 X)
-- ============================================================


-- 안전을 위해 idempotent — 이전 잘못된 정책이 있다면 정리.
DROP POLICY IF EXISTS survey_photos_public_read ON storage.objects;
DROP POLICY IF EXISTS survey_photos_anon_insert ON storage.objects;


-- (1) 공개 읽기 — 모든 사용자가 사진 URL 로 접근 가능
CREATE POLICY survey_photos_public_read
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'survey-photos');


-- (2) 익명 업로드 — 조사원이 비로그인 상태로 사진 등록
CREATE POLICY survey_photos_anon_insert
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'survey-photos');


-- UPDATE / DELETE 정책 미생성 → RLS 기본 거부.
-- service_role 은 RLS 우회 + 별도 GRANT 보유 → 관리자 cleanup 시 사용 가능.
