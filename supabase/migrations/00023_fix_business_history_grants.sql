-- ============================================================
-- Migration: 00023_fix_business_history_grants
-- Order:     23 (00020~00022 보강)
-- Purpose:   business_history 테이블 및 관련 RPC 의 GRANT 누락 보강.
--
--            현상:
--              ETL 이 service_role 키로 접근해도
--              "permission denied for table business_history" (42501).
--
--              information_schema.role_table_grants 확인 결과
--              anon / service_role 모두 REFERENCES, TRIGGER, TRUNCATE 만 보유,
--              SELECT/INSERT/UPDATE/DELETE 없음.
--              postgres(테이블 소유자)만 전체 권한.
--
--            원인:
--              00020 작성 시 GRANT 명시 누락. Supabase 의 public 스키마
--              default privileges 가 모든 환경에서 자동 부여되지 않을 수
--              있어, 신규 테이블은 명시적 GRANT 가 안전.
--              (Phase 1 buildings, Phase A field_surveys 에서도 같은 패턴
--               발생 이력 있음.)
--
--            대응:
--              00020 을 수정하지 않고 본 보강 마이그레이션으로 처리.
--              향후 신규 테이블 도입 시 CREATE 직후 GRANT 를 함께 명시할 것.
--
-- Verification (실행 후, 마지막 SELECT 로 자체 확인 가능):
--   SELECT grantee, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE table_name = 'business_history'
--    ORDER BY grantee, privilege_type;
--   기대:
--     anon          : SELECT
--     authenticated : SELECT
--     service_role  : SELECT, INSERT, UPDATE, DELETE
--     postgres      : (전체)
-- ============================================================

-- ── 테이블 GRANT ─────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON business_history TO service_role;
GRANT SELECT                          ON business_history TO anon;
GRANT SELECT                          ON business_history TO authenticated;

-- ── 시퀀스 GRANT (BIGSERIAL → business_history_id_seq) ───────
-- service_role 만: INSERT 시 nextval() 필요. anon/authenticated 은 INSERT 권한이 없으므로 시퀀스 접근도 불필요.
GRANT USAGE, SELECT ON SEQUENCE business_history_id_seq TO service_role;

-- ── RPC GRANT EXECUTE ────────────────────────────────────────
-- fetch_business_history_by_building(p_pnu VARCHAR, p_building_id BIGINT)
--   : 클라이언트(anon) 가 건물 상세 카드에서 호출. authenticated 도 동일.
GRANT EXECUTE ON FUNCTION fetch_business_history_by_building(VARCHAR, BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION fetch_business_history_by_building(VARCHAR, BIGINT) TO authenticated;

-- match_business_history_to_buildings(p_district VARCHAR, p_nearest_max_m INT)
--   : ETL 적재 후 1회 호출되는 보조 함수. UPDATE 를 수행하므로 service_role 전용.
--   기본 GRANT(PUBLIC EXECUTE) 제거 후 service_role 만 재부여.
REVOKE EXECUTE ON FUNCTION match_business_history_to_buildings(VARCHAR, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION match_business_history_to_buildings(VARCHAR, INT) TO service_role;

-- ── 자체 검증 SELECT (선택 실행) ─────────────────────────────
-- SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--  WHERE table_name = 'business_history'
--  ORDER BY grantee, privilege_type;
