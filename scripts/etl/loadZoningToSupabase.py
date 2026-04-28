#!/usr/bin/env python3
"""
Supabase zoning 테이블 적재 스크립트 (Phase 2).

입력: src/gis/data/land_use_junggu.geojson (EPSG:4326 가정)
출력: Supabase zoning 테이블 (insert)

원본 데이터 형상 (실측):
  - 682 features (Polygon 527 + MultiPolygon 155)
  - properties: '용도지역명', 'ATRB_SE', 'DGM_AR', '구이름' (한국어 키 100% 일관)
  - 구이름: 중구 364 + 종로구 318 (혼재) → district_code 매핑 필요

환경변수 (.env 또는 .env.local 에서 로드):
  SUPABASE_URL          https://<ref>.supabase.co
  SUPABASE_SERVICE_KEY  service_role 키 (RLS 우회)

결측값 치환 규칙:
  dgm_ar:           원본 0     → NULL
  zone_name:        빈값        → 레코드 스킵 (NOT NULL 컬럼)
  source_district:  빈값        → NULL
  atrb_se:          빈값        → NULL

district_code 매핑:
  '구이름' 한국어 → 행정안전부 시군구 5자리 코드.
  매핑 실패 시 '11140' (중구) 기본값으로 폴백 + 통계 로그.

재실행 정책:
  Phase 1 buildings 와 동일. 재실행 전 SQL Editor 에서:
    TRUNCATE zoning RESTART IDENTITY;
  스크립트는 시작 시 기존 건수 0 인지 확인하고 0 이 아니면 중단한다.

사용 예:
  python scripts/etl/loadZoningToSupabase.py --dry-run --verbose
  python scripts/etl/loadZoningToSupabase.py --limit 10 --verbose
  python scripts/etl/loadZoningToSupabase.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from itertools import islice
from pathlib import Path

from dotenv import load_dotenv
from shapely.geometry import shape

# ─── 상수 ────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
INPUT_PATH = PROJECT_ROOT / "src" / "gis" / "data" / "land_use_junggu.geojson"

DEFAULT_DISTRICT = "11140"        # 중구
BATCH_SIZE = 100                  # 폴리곤이 무거우므로 buildings(500) 대비 작게
TABLE = "zoning"

# 행정안전부 시군구 코드 (서울 25개 구). 향후 다른 구 추가 시 확장.
DISTRICT_CODES = {
    "종로구": "11110", "중구": "11140", "용산구": "11170", "성동구": "11200",
    "광진구": "11215", "동대문구": "11230", "중랑구": "11260", "성북구": "11290",
    "강북구": "11305", "도봉구": "11320", "노원구": "11350", "은평구": "11380",
    "서대문구": "11410", "마포구": "11440", "양천구": "11470", "강서구": "11500",
    "구로구": "11530", "금천구": "11545", "영등포구": "11560", "동작구": "11590",
    "관악구": "11620", "서초구": "11650", "강남구": "11680", "송파구": "11710",
    "강동구": "11740",
}


# ─── 결측 치환 헬퍼 ────────────────────────────────────────────

def empty_to_none(val):
    if val is None:
        return None
    if isinstance(val, str) and not val.strip():
        return None
    return val


def zero_to_none(val):
    if val is None:
        return None
    try:
        return None if float(val) == 0.0 else val
    except (TypeError, ValueError):
        return val


def map_district_code(gu_name, stats):
    """'중구', '종로구' 등 한국어 → 5자리 시군구 코드. 실패 시 기본값."""
    if not gu_name:
        stats["gu_empty"] += 1
        return DEFAULT_DISTRICT
    gu = gu_name.strip()
    code = DISTRICT_CODES.get(gu)
    if code:
        return code
    stats[f"gu_unmapped:{gu}"] += 1
    return DEFAULT_DISTRICT


# ─── 변환 ─────────────────────────────────────────────────────

def feature_to_record(feature, data_source, stats):
    """
    GeoJSON Feature → Supabase row dict.
    반환: dict 또는 None(스킵).
    """
    props = feature.get("properties") or {}

    # 원본 한국어 키 → DB snake_case
    zone_name = empty_to_none(props.get("용도지역명"))
    if not zone_name:
        # NOT NULL 컬럼이므로 빈값은 스킵
        stats["skipped_no_zone_name"] += 1
        return None

    geom = feature.get("geometry")
    if not geom:
        stats["skipped_no_geom"] += 1
        return None

    # 결측 통계 (치환 전 원본 기준)
    dgm_raw = props.get("DGM_AR")
    if dgm_raw is None or (isinstance(dgm_raw, (int, float)) and float(dgm_raw) == 0.0):
        stats["null_dgm_ar"] += 1

    if not props.get("ATRB_SE"):
        stats["null_atrb_se"] += 1
    if not props.get("구이름"):
        stats["null_source_district"] += 1

    # geometry → EWKT (Polygon / MultiPolygon 둘 다 지원)
    try:
        shp = shape(geom)
        ewkt = f"SRID=4326;{shp.wkt}"
    except Exception as e:
        stats["skipped_bad_geom"] += 1
        stats["_last_geom_error"] = str(e)
        return None

    # geometry 타입 통계 (검증용)
    stats[f"geom_type:{geom.get('type', '?')}"] += 1

    record = {
        "district_code":   map_district_code(props.get("구이름"), stats),
        "zone_name":       zone_name,
        "atrb_se":         empty_to_none(props.get("ATRB_SE")),
        "dgm_ar":          zero_to_none(dgm_raw),
        "source_district": empty_to_none(props.get("구이름")),
        "geom":            ewkt,
        "data_source":     data_source,
    }
    return record


def chunked(iterable, size):
    it = iter(iterable)
    while True:
        chunk = list(islice(it, size))
        if not chunk:
            return
        yield chunk


# ─── 메인 ─────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Supabase zoning 적재 스크립트 (Phase 2)",
    )
    parser.add_argument("--limit", type=int, default=None,
                        help="처음 N 건만 업로드 (검증용)")
    parser.add_argument("--dry-run", action="store_true",
                        help="DB 에 쓰지 않고 변환 결과만 검증")
    parser.add_argument("--verbose", action="store_true",
                        help="결측/매핑 통계 및 샘플 출력")
    parser.add_argument("--input", type=Path, default=INPUT_PATH,
                        help=f"입력 geojson 경로 (기본: {INPUT_PATH})")
    args = parser.parse_args()

    # 0. 환경변수 로드
    env_local = PROJECT_ROOT / ".env.local"
    env_default = PROJECT_ROOT / ".env"
    if env_local.exists():
        load_dotenv(env_local)
    if env_default.exists():
        load_dotenv(env_default)

    if not args.dry_run:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_KEY")
        if not url or not key:
            print("ERROR: SUPABASE_URL 또는 SUPABASE_SERVICE_KEY 환경변수가 설정되지 않았습니다.",
                  file=sys.stderr)
            print("       .env 또는 .env.local 에 추가하거나 export 하세요.", file=sys.stderr)
            sys.exit(2)
        from supabase import create_client  # type: ignore
        client = create_client(url, key)
    else:
        client = None

    # 1. 입력 + data_source 태그
    if not args.input.exists():
        print(f"ERROR: 입력 파일 없음: {args.input}", file=sys.stderr)
        sys.exit(2)

    mtime = datetime.fromtimestamp(args.input.stat().st_mtime)
    data_source = f"seoul_zoning_{mtime.strftime('%Y%m%d')}"
    print(f"입력 파일:   {args.input}")
    print(f"파일 수정일: {mtime.isoformat()}")
    print(f"data_source: {data_source}")

    # 2. GeoJSON 로드
    with open(args.input, "r", encoding="utf-8") as f:
        fc = json.load(f)
    features = fc.get("features", [])
    total = len(features)
    if args.limit:
        features = features[: args.limit]
    print(f"총 feature: {total:,}, 처리 대상: {len(features):,}")
    if args.dry_run:
        print("*** DRY RUN — DB 쓰기 없음 ***")
    print()

    # 3. 변환
    stats = defaultdict(int)
    records = []
    for feat in features:
        r = feature_to_record(feat, data_source, stats)
        if r is not None:
            records.append(r)

    skipped = len(features) - len(records)
    print(f"변환 완료: 성공 {len(records):,} / 스킵 {skipped:,}")

    # district 매핑 결과 요약 (항상 출력)
    district_counts = defaultdict(int)
    for r in records:
        district_counts[r["district_code"]] += 1
    print(f"\n[district_code 분포]")
    for code, n in sorted(district_counts.items()):
        print(f"  {code}: {n:,}")
    unmapped = {k: v for k, v in stats.items() if k.startswith("gu_unmapped:")}
    if unmapped:
        print(f"\n[매핑 실패 (→ {DEFAULT_DISTRICT} 폴백)]")
        for k, v in unmapped.items():
            print(f"  {k.split(':', 1)[1]}: {v:,}")

    if args.verbose:
        print("\n[결측/통계]")
        for key in sorted(stats.keys()):
            if key.startswith("_") or key.startswith("gu_unmapped:"):
                continue
            print(f"  {key}: {stats[key]:,}")
        if records:
            print("\n[샘플 레코드 (첫 1건)]")
            sample = dict(records[0])
            sample["geom"] = sample["geom"][:80] + "…"
            print(json.dumps(sample, ensure_ascii=False, indent=2, default=str))
        if "_last_geom_error" in stats:
            print(f"\n[geometry 파싱 에러 예시]  {stats['_last_geom_error']}")

    if args.dry_run:
        print("\nDry-run 종료. DB 쓰기 없음.")
        return

    if not records:
        print("적재할 레코드가 없습니다. 종료.")
        return

    # 4. 기존 데이터 가드
    existing = client.table(TABLE).select("id", count="exact", head=True).execute()
    existing_count = existing.count or 0
    if existing_count > 0:
        print(f"\nERROR: zoning 테이블에 이미 {existing_count:,} 건이 존재합니다.",
              file=sys.stderr)
        print( "       Supabase SQL Editor 에서 다음을 실행 후 재시도:",
              file=sys.stderr)
        print( "         TRUNCATE zoning RESTART IDENTITY;",
              file=sys.stderr)
        sys.exit(1)

    # 5. 배치 업로드
    print(f"\n업로드 시작: 배치 크기 {BATCH_SIZE}, mode=insert")
    done = 0
    for batch_idx, batch in enumerate(chunked(records, BATCH_SIZE), start=1):
        try:
            client.table(TABLE).insert(batch).execute()
        except Exception as e:
            first_zone = batch[0].get("zone_name")
            print(f"\nERROR: 배치 {batch_idx} 실패 (첫 zone_name={first_zone}): {e}",
                  file=sys.stderr)
            sys.exit(1)
        done += len(batch)
        print(f"  {done:,}/{len(records):,} 적재 완료", end="\r")
    print()
    print(f"\n완료: {done:,} 건 insert 성공.")


if __name__ == "__main__":
    main()
