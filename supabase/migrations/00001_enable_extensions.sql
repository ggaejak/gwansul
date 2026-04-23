-- ============================================================
-- Migration: 00001_enable_extensions
-- Order:     1 (이 파일을 가장 먼저 실행)
-- Purpose:   PostGIS 확장 활성화. 이후 모든 마이그레이션이 의존함.
--
-- Verification (실행 후 Supabase SQL Editor에서 확인):
--   SELECT PostGIS_Version();
--   -- 예: "3.3 USE_GEOS=1 USE_PROJ=1 USE_STATS=1"
--
--   SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis';
--   -- 1행 반환되면 성공
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;
