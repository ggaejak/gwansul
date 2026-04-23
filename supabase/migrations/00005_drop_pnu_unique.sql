-- ============================================================
-- Migration: 00005_drop_pnu_unique
-- Order:     5 (00004 이후)
-- Purpose:   buildings.pnu 의 UNIQUE 제약 제거.
--
--            근거 (실측):
--              전체 20,533 feature 중 pnu 고유값 15,902, 중복 4,631.
--              서울 건축물대장에는 "집합건물"이 존재하여 같은 필지
--              (같은 pnu) 위에 여러 동이 들어설 수 있다.
--              pnu 를 UNIQUE 로 두면 이를 표현할 수 없다.
--
--            변경 내용:
--              - UNIQUE 제약 제거 (PRIMARY KEY 는 id BIGSERIAL 유지)
--              - 조회용 일반 인덱스 추가
--              - NOT NULL 은 유지 (pnu 없는 레코드는 허용 안 함)
--
--            ETL 운영 변경:
--              upsert(on_conflict=pnu) 를 더 이상 쓸 수 없으므로
--              insert 로 전환. 재실행 시에는 사전에
--                TRUNCATE buildings RESTART IDENTITY;
--              를 실행해 테이블을 비워야 한다.
--
-- Verification (실행 후):
--   -- (1) UNIQUE 제약 제거 확인
--   SELECT conname, contype
--   FROM pg_constraint
--   WHERE conrelid = 'buildings'::regclass;
--   -- 기대: 'buildings_pkey'(p) 하나만 남고 'buildings_pnu_key' 없음
--
--   -- (2) 일반 인덱스 생성 확인
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'buildings' AND indexname = 'buildings_pnu_idx';
--   -- 기대: 1 행 반환
--
--   -- (3) NOT NULL 유지 확인
--   SELECT is_nullable FROM information_schema.columns
--   WHERE table_name = 'buildings' AND column_name = 'pnu';
--   -- 기대: 'NO'
-- ============================================================

-- UNIQUE 제약 제거 (뒷받침 UNIQUE 인덱스도 함께 삭제됨)
ALTER TABLE buildings DROP CONSTRAINT buildings_pnu_key;

-- 조회 성능 유지를 위한 일반 인덱스
CREATE INDEX buildings_pnu_idx ON buildings (pnu);

COMMENT ON COLUMN buildings.pnu IS
  '필지식별번호. 집합건물(같은 필지 위 여러 동)의 경우 중복 가능. PK 는 id(BIGSERIAL).';
