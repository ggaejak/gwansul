-- ============================================================
-- Migration: 00018_update_sindang_area
-- Order:     18 (Phase C 보강 — 답사 영역 재정의)
-- Purpose:   sindang_area() 폴리곤을 재정의된 좌표 20점(닫힘 포함)으로 교체.
--            답사 영역 축소·재정의 — 현장 운영 변경에 따라 영역 경계를 갱신.
--
-- ※ 마이그레이션 번호: 사용자 가이드에는 00017 로 적혀 있었으나,
--   직전 C4 작업에서 00017_augment_survey_progress.sql 이 이미 사용 중이라
--   충돌 방지를 위해 00018 로 부여.
--
-- 클라이언트 좌표 동기:
--   src/gis/data/sindang-survey-area.json 도 동일한 20-vertex(닫힘 포함) 폴리곤으로
--   업데이트됨. 이 파일과 본 마이그레이션은 반드시 동일 좌표여야 함
--   (SurveyMap 의 isInsideSindang ray-casting 과 RPC 의 ST_Intersects 가
--    같은 영역을 판정해야 picker / 통계 / 마커가 일관됨).
--
-- 영향:
--   - survey_buildings_in_area()  → 새 영역 내 건물만 반환 (개수 감소 예상)
--   - fetch_surveys_in_area()     → 새 영역 외 조사는 결과에서 제외
--   - survey_progress()           → in_area_total 등 분모 변화
--   - 기존 field_surveys 데이터는 그대로 보존 (별도 정리 없음)
--   - curated_buildings / curated_roads / curated_points 은 영향 없음
--
-- Verification:
--   -- (1) 점 수
--   SELECT ST_NPoints(sindang_area());                  -- 기대: 20
--
--   -- (2) 닫힘 + 유효성
--   SELECT ST_IsClosed(sindang_area()::geometry),
--          ST_IsValid(sindang_area());                  -- t, t
--
--   -- (3) 새 영역 내 건물 수 (이전 6,447 에서 줄어듦)
--   SELECT COUNT(*) FROM buildings
--    WHERE ST_Intersects(geom, sindang_area());
--
--   -- (4) 새 영역 내 기존 조사 건수
--   SELECT survey_type, status, COUNT(*)
--   FROM field_surveys
--   WHERE ST_Intersects(location, sindang_area())
--   GROUP BY survey_type, status
--   ORDER BY 1, 2;
--
--   -- (5) 새 영역 밖으로 빠진 기존 조사 (보존되지만 RPC 결과에는 제외)
--   SELECT COUNT(*) FROM field_surveys
--   WHERE NOT ST_Intersects(location, sindang_area());
-- ============================================================


CREATE OR REPLACE FUNCTION sindang_area()
RETURNS GEOMETRY(Polygon, 4326)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ST_SetSRID(ST_GeomFromText(
    'POLYGON((' ||
      '127.01586881590003 37.569657095447525,'   ||
      '127.01625243830529 37.56534546377283,'    ||
      '127.01572970039382 37.56347708650161,'    ||
      '127.01911324032073 37.56221138495253,'    ||
      '127.02012069883835 37.56239973475887,'    ||
      '127.02052943236652 37.56172638793504,'    ||
      '127.02199429925224 37.562149998878056,'   ||
      '127.02255384068144 37.56200547306226,'    ||
      '127.02300650341112 37.562169933451614,'   ||
      '127.02313853003903 37.56214003158982,'    ||
      '127.02335857442176 37.5622397044159,'     ||
      '127.02327055666836 37.56300718071239,'    ||
      '127.02408091489201 37.56304710636276,'    ||
      '127.02431710416766 37.56403205809575,'    ||
      '127.02360224900605 37.56529927390659,'    ||
      '127.023381293775 37.571428997252596,'     ||
      '127.02115874409259 37.57172774398555,'    ||
      '127.01917014700871 37.57088300874841,'    ||
      '127.01749348672092 37.57002796210419,'    ||
      '127.01586881590003 37.569657095447525'    ||
    '))'
  ), 4326);
$$;

COMMENT ON FUNCTION sindang_area()
  IS '신당동 조사 영역 폴리곤 (EPSG:4326, 20 vertices 닫힘 포함). 좌표는 src/gis/data/sindang-survey-area.json 와 동기. 00018 에서 재정의됨.';

-- GRANT 는 00009 에서 이미 부여됨. CREATE OR REPLACE 는 권한 유지.
