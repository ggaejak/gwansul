#!/usr/bin/env python3
"""
Supabase buildings 테이블 적재 스크립트 (Phase 1).

입력: src/gis/data/junggu-buildings-final-lite.geojson (EPSG:4326 가정)
출력: Supabase buildings 테이블 (insert)

재실행 정책:
  pnu 는 집합건물 때문에 중복 가능 (UNIQUE 아님, migration 00005).
  upsert 가 불가하므로 insert 만 사용한다.
  재실행 전 Supabase SQL Editor 에서 반드시:
    TRUNCATE buildings RESTART IDENTITY;
  스크립트는 시작 시 기존 건수를 확인하고 0 이 아니면 중단한다.

환경변수 (.env 또는 .env.local 에서 로드):
  SUPABASE_URL          https://<ref>.supabase.co
  SUPABASE_SERVICE_KEY  service_role 키 (RLS 우회)
                        ※ anon key 아님, Settings → API 의 "service_role" 값

결측값 치환 규칙 (docs/backend-migration-plan.md §1.3):
  vl_rat / bc_rat / plat_area / arch_area / tot_area  : 원본 0  → NULL
  grnd_flr_cnt / ugrnd_flr_cnt                        : 원본 0  → NULL
  use_apr_day                                         : 빈 문자열 / 파싱 실패 → NULL
  bld_nm                                              : 빈 문자열 → NULL
  * tot_area 의 0 은 진짜 0 일 수도 있어 건수를 항상 출력.

사용 예:
  # 처음 10건만 검증 적재
  python scripts/etl/loadBuildingsToSupabase.py --limit 10 --verbose

  # 전체 건조 실행 (DB 쓰기 없음)
  python scripts/etl/loadBuildingsToSupabase.py --dry-run --verbose

  # 전체 적재
  python scripts/etl/loadBuildingsToSupabase.py
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
INPUT_PATH = PROJECT_ROOT / "src" / "gis" / "data" / "junggu-buildings-final-lite.geojson"

DISTRICT_CODE = "11140"            # 중구
BATCH_SIZE = 500
TABLE = "buildings"

NUMERIC_ZERO_NULL_FIELDS = (
    "vlRat", "bcRat", "platArea", "archArea", "totArea",
    "grndFlrCnt", "ugrndFlrCnt",
)
STRING_EMPTY_NULL_FIELDS = ("bldNm",)


# ─── 결측 치환 헬퍼 ────────────────────────────────────────────

def empty_to_none(val):
    """빈 문자열/공백/None 을 None 으로."""
    if val is None:
        return None
    if isinstance(val, str) and not val.strip():
        return None
    return val


def zero_to_none(val):
    """숫자 0 (또는 0.0) 을 None 으로. None 은 None 유지. 0이 아닌 숫자는 그대로."""
    if val is None:
        return None
    try:
        return None if float(val) == 0.0 else val
    except (TypeError, ValueError):
        return val


def parse_apr_day(raw):
    """
    사용승인일 파싱: ISO('YYYY-MM-DD'), YYYYMMDD, 또는 빈값.
    성공 시 ISO 문자열, 실패/빈값은 None.
    """
    if raw is None:
        return None
    if not isinstance(raw, str):
        raw = str(raw)
    s = raw.strip()
    if not s:
        return None

    # ISO 형식 "YYYY-MM-DD"
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date().isoformat()
    except ValueError:
        pass
    # YYYYMMDD
    try:
        return datetime.strptime(s[:8], "%Y%m%d").date().isoformat()
    except ValueError:
        pass
    return None


# ─── 변환 ─────────────────────────────────────────────────────

def feature_to_record(feature, data_source, stats):
    """
    GeoJSON Feature → Supabase row dict.
    stats: defaultdict(int) — 결측 치환 통계 누적.
    반환: dict 또는 None(스킵해야 할 feature).
    """
    props = feature.get("properties") or {}

    pnu = empty_to_none(props.get("pnu"))
    if not pnu:
        stats["skipped_no_pnu"] += 1
        return None

    geom = feature.get("geometry")
    if not geom:
        stats["skipped_no_geom"] += 1
        return None

    # 결측 통계 집계 (치환 전 원본 기준)
    for f in NUMERIC_ZERO_NULL_FIELDS:
        v = props.get(f)
        if v is None or (isinstance(v, (int, float)) and float(v) == 0.0):
            stats[f"null_{f}"] += 1

    for f in STRING_EMPTY_NULL_FIELDS:
        v = props.get(f)
        if v is None or (isinstance(v, str) and not v.strip()):
            stats[f"null_{f}"] += 1

    apr_raw = props.get("useAprDay")
    apr_parsed = parse_apr_day(apr_raw)
    if apr_parsed is None and apr_raw not in (None, "", ):
        stats["apr_unparseable"] += 1
    if apr_parsed is None:
        stats["null_useAprDay"] += 1

    # geometry → EWKT
    try:
        shp = shape(geom)
        ewkt = f"SRID=4326;{shp.wkt}"
    except Exception as e:
        stats["skipped_bad_geom"] += 1
        stats["_last_geom_error"] = str(e)
        return None

    record = {
        "pnu":           pnu,
        "district_code": DISTRICT_CODE,
        "bjdong_cd":     empty_to_none(props.get("bjdongCd")),
        "address":       empty_to_none(props.get("address")),
        "bld_nm":        empty_to_none(props.get("bldNm")),
        "reg_type":      empty_to_none(props.get("regType")),
        "main_purps":    empty_to_none(props.get("mainPurps")),
        "strct":         empty_to_none(props.get("strct")),
        "arch_area":     zero_to_none(props.get("archArea")),
        "tot_area":      zero_to_none(props.get("totArea")),
        "plat_area":     zero_to_none(props.get("platArea")),
        "bc_rat":        zero_to_none(props.get("bcRat")),
        "vl_rat":        zero_to_none(props.get("vlRat")),
        "grnd_flr_cnt":  zero_to_none(props.get("grndFlrCnt")),
        "ugrnd_flr_cnt": zero_to_none(props.get("ugrndFlrCnt")),
        "use_apr_day":   apr_parsed,
        "geom":          ewkt,
        "data_source":   data_source,
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
        description="Supabase buildings 적재 스크립트 (Phase 1)",
    )
    parser.add_argument("--limit", type=int, default=None,
                        help="처음 N 건만 업로드 (검증용)")
    parser.add_argument("--dry-run", action="store_true",
                        help="DB 에 쓰지 않고 변환 결과만 검증")
    parser.add_argument("--verbose", action="store_true",
                        help="결측 치환 통계 및 샘플 출력")
    parser.add_argument("--input", type=Path, default=INPUT_PATH,
                        help=f"입력 geojson 경로 (기본: {INPUT_PATH})")
    args = parser.parse_args()

    # 0. 환경변수 로드 — .env.local 우선, 없으면 .env
    env_local = PROJECT_ROOT / ".env.local"
    env_default = PROJECT_ROOT / ".env"
    if env_local.exists():
        load_dotenv(env_local)
    if env_default.exists():
        load_dotenv(env_default)  # .env.local 에 없는 키만 채워짐

    if not args.dry_run:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_KEY")
        if not url or not key:
            print("ERROR: SUPABASE_URL 또는 SUPABASE_SERVICE_KEY 환경변수가 설정되지 않았습니다.",
                  file=sys.stderr)
            print("       .env 또는 .env.local 에 추가하거나 export 하세요.", file=sys.stderr)
            sys.exit(2)
        # supabase 는 dry-run 이 아닐 때만 import (의존성 오류를 줄이기 위함)
        from supabase import create_client  # type: ignore
        client = create_client(url, key)
    else:
        client = None

    # 1. 입력 파일 확인 및 data_source 태그 생성
    if not args.input.exists():
        print(f"ERROR: 입력 파일 없음: {args.input}", file=sys.stderr)
        sys.exit(2)

    mtime = datetime.fromtimestamp(args.input.stat().st_mtime)
    data_source = f"moldt_brtitle_{mtime.strftime('%Y%m%d')}"
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

    # tot_area=0 건수는 verbose 여부와 무관하게 항상 출력 (진짜 0 vs 결측 검증용)
    n_tot_zero = stats.get("null_totArea", 0)
    pct = (n_tot_zero / max(len(records), 1)) * 100
    print(f"totArea == 0 (NULL 치환) 건수: {n_tot_zero:,} "
          f"({pct:.1f}% — 전량 결측인지 혹은 진짜 0 인지 검증 필요)")

    if args.verbose:
        print("\n[결측 치환 통계]")
        for key in sorted(stats.keys()):
            if key.startswith("_"):
                continue
            print(f"  {key}: {stats[key]:,}")
        if records:
            print("\n[샘플 레코드 (첫 1건)]")
            sample = dict(records[0])
            # geom 은 길어서 앞부분만
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

    # 4. 기존 데이터 가드 — insert 전 테이블이 비어 있어야 함
    existing = client.table(TABLE).select("pnu", count="exact", head=True).execute()
    existing_count = existing.count or 0
    if existing_count > 0:
        print(f"\nERROR: buildings 테이블에 이미 {existing_count:,} 건이 존재합니다.",
              file=sys.stderr)
        print( "       Supabase SQL Editor 에서 다음을 실행 후 재시도:",
              file=sys.stderr)
        print( "         TRUNCATE buildings RESTART IDENTITY;",
              file=sys.stderr)
        sys.exit(1)

    # 5. 배치 업로드 (insert)
    print(f"\n업로드 시작: 배치 크기 {BATCH_SIZE}, mode=insert")
    done = 0
    for batch_idx, batch in enumerate(chunked(records, BATCH_SIZE), start=1):
        try:
            client.table(TABLE).insert(batch).execute()
        except Exception as e:
            first_pnu = batch[0].get("pnu")
            print(f"\nERROR: 배치 {batch_idx} 실패 (첫 pnu={first_pnu}): {e}",
                  file=sys.stderr)
            sys.exit(1)
        done += len(batch)
        print(f"  {done:,}/{len(records):,} 적재 완료", end="\r")
    print()
    print(f"\n완료: {done:,} 건 insert 성공.")


if __name__ == "__main__":
    main()
