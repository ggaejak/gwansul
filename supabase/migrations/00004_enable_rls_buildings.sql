-- ============================================================
-- Migration: 00004_enable_rls_buildings
-- Order:     4 (마지막)
-- Purpose:   buildings 테이블에 RLS 활성화 및 anon SELECT 정책.
--            - 읽기(SELECT): anon + authenticated 허용 (공개 데이터)
--            - 쓰기(INSERT/UPDATE/DELETE): service_role 전용
--              (service_role 은 RLS 를 우회하므로 정책 불필요)
--
--            ANON_KEY 는 브라우저 노출 OK. SERVICE_KEY 는 ETL 전용.
--
-- Verification (실행 후):
--   -- (1) RLS 활성화 확인
--   SELECT relname, relrowsecurity
--   FROM pg_class
--   WHERE relname = 'buildings';
--   -- relrowsecurity = true 이어야 함
--
--   -- (2) 정책 목록
--   SELECT policyname, cmd, roles, qual
--   FROM pg_policies
--   WHERE tablename = 'buildings';
--   -- 'anon_read_buildings' (SELECT) 하나가 나타나야 함
--
--   -- (3) 브라우저 측 테스트 (Step 2 이후):
--   --   Supabase JS 클라이언트에서 SELECT buildings 가 성공하고,
--   --   INSERT/UPDATE/DELETE 는 permission denied 로 실패해야 정상.
-- ============================================================

ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;

-- 공개 데이터이므로 익명 사용자와 로그인 사용자 모두 SELECT 허용
CREATE POLICY anon_read_buildings
  ON buildings
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- INSERT/UPDATE/DELETE 정책 미생성 → RLS 기본 거부.
-- ETL 은 service_role 키를 사용하므로 RLS 를 우회한다.
