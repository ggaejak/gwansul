#!/usr/bin/env python3
"""
Supabase business_history 테이블 적재 스크립트.

입력: scripts/etl/raw/서울시 일반음식점 인허가 정보.csv (CP949)
출력: Supabase business_history 테이블 + match_business_history_to_buildings() 실행

필터링 정책:
  좌표(EPSG:2097)가 src/gis/data/sindang-survey-area.json 폴리곤(WGS84) 안에
  들어오는 행만 적재. 좌표 없는 행은 답사영역 판정 불가하므로 제외.

재실행 정책:
  business_history 는 (사업장명, 인허가일자) 조합도 unique 강제하지 않으므로
  중복 적재 위험이 있다. 재실행 전 Supabase SQL Editor 에서:
    TRUNCATE business_history RESTART IDENTITY;
  스크립트는 시작 시 기존 건수를 확인하고 0 이 아니면 중단.

환경변수:
  SUPABASE_URL          https://<ref>.supabase.co
  SUPABASE_SERVICE_KEY  service_role 키 (RLS 우회)

결측 치환:
  site_area_m2  : 빈값/0 → NULL
  closed_at     : 빈값 → NULL (영업 중인 경우)
  road_address  : 빈값 → NULL (옛 데이터)
  business_type : 빈값 → NULL

사용 예:
  python scripts/etl/loadBusinessHistory.py --dry-run --verbose
  python scripts/etl/loadBusinessHistory.py --limit 50 --verbose
  python scripts/etl/loadBusinessHistory.py
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime
from itertools import islice
from pathlib import Path

from dotenv import load_dotenv
from pyproj import Transformer
from shapely.geometry import Point, shape

# ─── 상수 ────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CSV_PATH = PROJECT_ROOT / "scripts" / "etl" / "raw" / "서울시 일반음식점 인허가 정보.csv"
AREA_PATH = PROJECT_ROOT / "src" / "gis" / "data" / "sindang-survey-area.json"

CSV_ENCODING = "cp949"
BATCH_SIZE = 200
TABLE = "business_history"
MATCH_RPC = "match_business_history_to_buildings"

# EPSG:2097 = Korea Central Belt 1985 (서울 열린데이터광장 좌표계)
SRC_CRS = "EPSG:2097"
DST_CRS = "EPSG:4326"


# ─── 헬퍼 ─────────────────────────────────────────────────────

def empty_to_none(val):
    if val is None:
        return None
    if isinstance(val, str) and not val.strip():
        return None
    return val.strip() if isinstance(val, str) else val


def parse_date(raw):
    """'YYYY-MM-DD' (공백 패딩 가능) → ISO 문자열, 실패/빈값은 None."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date().isoformat()
    except ValueError:
        return None


def parse_area(raw):
    """소재지면적 → float 또는 None. 0 도 NULL 치환."""
    s = empty_to_none(raw)
    if s is None:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return None if v == 0.0 else v


def chunked(iterable, size):
    it = iter(iterable)
    while True:
        chunk = list(islice(it, size))
        if not chunk:
            return
        yield chunk


# ─── 변환 ─────────────────────────────────────────────────────

def row_to_record(row, transformer, area_poly, data_source, stats):
    """CSV row → Supabase row dict 또는 None(스킵)."""
    name = empty_to_none(row.get("사업장명"))
    if not name:
        stats["skipped_no_name"] += 1
        return None

    jibun = empty_to_none(row.get("지번주소"))
    if not jibun:
        stats["skipped_no_jibun"] += 1
        return None

    x_raw = empty_to_none(row.get("좌표정보(X)"))
    y_raw = empty_to_none(row.get("좌표정보(Y)"))
    if not x_raw or not y_raw:
        stats["skipped_no_coord"] += 1
        return None

    try:
        lon, lat = transformer.transform(float(x_raw), float(y_raw))
    except Exception as e:
        stats["skipped_bad_coord"] += 1
        stats["_last_coord_error"] = f"{x_raw},{y_raw}: {e}"
        return None

    pt = Point(lon, lat)
    if not area_poly.contains(pt):
        stats["skipped_outside_area"] += 1
        return None

    status = empty_to_none(row.get("영업상태명"))
    if not status:
        stats["skipped_no_status"] += 1
        return None

    opened_raw = row.get("인허가일자")
    opened = parse_date(opened_raw)
    if opened is None and empty_to_none(opened_raw):
        stats["opened_unparseable"] += 1

    closed_raw = row.get("폐업일자")
    closed = parse_date(closed_raw)
    if closed is None and empty_to_none(closed_raw):
        stats["closed_unparseable"] += 1

    site_area = parse_area(row.get("소재지면적"))
    if site_area is None:
        stats["null_site_area"] += 1

    record = {
        "business_name":  name,
        "business_type":  empty_to_none(row.get("업태구분명")),
        "opened_at":      opened,
        "closed_at":      closed,
        "status":         status,
        "building_id":    None,                       # 매칭은 적재 후 RPC 에서
        "building_pnu":   None,
        "jibun_address":  jibun,
        "road_address":   empty_to_none(row.get("도로명주소")),
        "geom":           f"SRID=4326;POINT({lon} {lat})",
        "site_area_m2":   site_area,
        "data_source":    data_source,
    }
    stats[f"status_{status}"] += 1
    return record


# ─── 메인 ─────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Supabase business_history 적재 스크립트",
    )
    parser.add_argument("--limit", type=int, default=None,
                        help="처음 N 건만 업로드 (검증용, 답사영역 필터 통과 기준)")
    parser.add_argument("--dry-run", action="store_true",
                        help="DB 에 쓰지 않고 변환 결과만 검증")
    parser.add_argument("--verbose", action="store_true",
                        help="통계 및 샘플 출력")
    parser.add_argument("--skip-match", action="store_true",
                        help="적재 후 buildings 매칭 RPC 호출 생략")
    parser.add_argument("--input", type=Path, default=CSV_PATH,
                        help=f"입력 CSV 경로 (기본: {CSV_PATH})")
    parser.add_argument("--area", type=Path, default=AREA_PATH,
                        help=f"답사영역 폴리곤 경로 (기본: {AREA_PATH})")
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
            print("ERROR: SUPABASE_URL 또는 SUPABASE_SERVICE_KEY 환경변수가 없습니다.",
                  file=sys.stderr)
            sys.exit(2)
        from supabase import create_client  # type: ignore
        client = create_client(url, key)
    else:
        client = None

    # 1. 입력 파일 확인 및 data_source 태그
    if not args.input.exists():
        print(f"ERROR: 입력 파일 없음: {args.input}", file=sys.stderr)
        sys.exit(2)
    if not args.area.exists():
        print(f"ERROR: 답사영역 파일 없음: {args.area}", file=sys.stderr)
        sys.exit(2)

    mtime = datetime.fromtimestamp(args.input.stat().st_mtime)
    data_source = f"seoul_restaurants_{mtime.strftime('%Y%m%d')}"
    print(f"입력 CSV:    {args.input}")
    print(f"답사영역:    {args.area}")
    print(f"파일 수정일: {mtime.isoformat()}")
    print(f"data_source: {data_source}")

    # 2. 답사영역 폴리곤 로드
    with open(args.area, "r", encoding="utf-8") as f:
        gj = json.load(f)
    area_poly = shape(gj["features"][0]["geometry"])
    print(f"답사영역 bounds (WGS84): {area_poly.bounds}")

    # 3. 좌표 변환기
    transformer = Transformer.from_crs(SRC_CRS, DST_CRS, always_xy=True)

    # 4. CSV → 레코드 변환 (답사영역 필터 적용)
    stats = defaultdict(int)
    records = []
    total_csv = 0
    with open(args.input, "r", encoding=CSV_ENCODING, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_csv += 1
            r = row_to_record(row, transformer, area_poly, data_source, stats)
            if r is not None:
                records.append(r)
                if args.limit and len(records) >= args.limit:
                    break

    print(f"\nCSV 총 행:                {total_csv:,}")
    print(f"  └ 사업장명 없음 스킵:    {stats.get('skipped_no_name', 0):,}")
    print(f"  └ 지번주소 없음 스킵:    {stats.get('skipped_no_jibun', 0):,}")
    print(f"  └ 좌표 없음 스킵:        {stats.get('skipped_no_coord', 0):,}")
    print(f"  └ 좌표 변환 실패 스킵:   {stats.get('skipped_bad_coord', 0):,}")
    print(f"  └ 답사영역 외부 스킵:    {stats.get('skipped_outside_area', 0):,}")
    print(f"  └ 영업상태 없음 스킵:    {stats.get('skipped_no_status', 0):,}")
    print(f"적재 대상 (답사영역 내부): {len(records):,}")

    if records:
        active = stats.get("status_영업/정상", 0)
        closed = stats.get("status_폐업", 0)
        other = len(records) - active - closed
        print(f"  └ 영업/정상: {active:,}")
        print(f"  └ 폐업:     {closed:,}")
        if other:
            print(f"  └ 기타:     {other:,}")

    if args.dry_run:
        print("\n*** DRY RUN — DB 쓰기 없음 ***")

    if args.verbose:
        print("\n[변환 통계 전체]")
        for k in sorted(stats.keys()):
            if k.startswith("_"):
                continue
            print(f"  {k}: {stats[k]:,}")
        if "_last_coord_error" in stats:
            print(f"\n[좌표 파싱 에러 예시]  {stats['_last_coord_error']}")
        if records:
            print("\n[샘플 레코드 (첫 1건)]")
            print(json.dumps(records[0], ensure_ascii=False, indent=2, default=str))

            # 업태 분포
            bt_counter = Counter(r["business_type"] for r in records)
            print("\n[업태 분포 (상위 10)]")
            for k, v in bt_counter.most_common(10):
                print(f"  {k or '(NULL)'}: {v:,}")

    if args.dry_run:
        return

    if not records:
        print("적재할 레코드가 없습니다. 종료.")
        return

    # 5. 기존 데이터 가드 (limit=1 GET — head 보다 에러 body 가 살아남)
    try:
        existing = client.table(TABLE).select("id").limit(1).execute()
    except Exception as e:
        print(f"\nERROR: {TABLE} 존재/권한 확인 실패: {e}", file=sys.stderr)
        print( "  - 마이그레이션 00020~00022 가 적용되었는지 확인", file=sys.stderr)
        print( "  - SUPABASE_SERVICE_KEY 가 service_role 키인지 확인", file=sys.stderr)
        sys.exit(1)
    if existing.data:
        # 빈 게 아니면 정확한 카운트를 한 번 더 받아 안내
        cnt = client.table(TABLE).select("id", count="exact").limit(1).execute()
        print(f"\nERROR: business_history 테이블에 이미 {cnt.count:,} 건이 존재합니다.",
              file=sys.stderr)
        print( "       Supabase SQL Editor 에서 다음을 실행 후 재시도:",
              file=sys.stderr)
        print( "         TRUNCATE business_history RESTART IDENTITY;",
              file=sys.stderr)
        sys.exit(1)

    # 6. 배치 업로드
    print(f"\n업로드 시작: 배치 크기 {BATCH_SIZE}, mode=insert")
    done = 0
    for batch_idx, batch in enumerate(chunked(records, BATCH_SIZE), start=1):
        try:
            client.table(TABLE).insert(batch).execute()
        except Exception as e:
            first = batch[0].get("business_name")
            print(f"\nERROR: 배치 {batch_idx} 실패 (첫 사업장={first}): {e}",
                  file=sys.stderr)
            sys.exit(1)
        done += len(batch)
        print(f"  {done:,}/{len(records):,} 적재 완료", end="\r")
    print()
    print(f"\n완료: {done:,} 건 insert 성공.")

    # 7. buildings 공간 매칭
    if args.skip_match:
        print("--skip-match 지정됨 — 매칭 RPC 호출 생략.")
        return

    print(f"\n공간 매칭 RPC 호출: {MATCH_RPC}()")
    try:
        result = client.rpc(MATCH_RPC, {}).execute()
    except Exception as e:
        print(f"WARN: 매칭 RPC 호출 실패 — 수동으로 실행하세요: SELECT * FROM {MATCH_RPC}();",
              file=sys.stderr)
        print(f"  {e}", file=sys.stderr)
        return

    rows = result.data or []
    if rows:
        r = rows[0]
        contained = r.get("contained_count", 0)
        nearest = r.get("nearest_count", 0)
        unmatched = r.get("unmatched_count", 0)
        matched = contained + nearest
        total = matched + unmatched
        rate = (matched / max(total, 1)) * 100
        print(f"  ST_Contains 매칭:  {contained:,}")
        print(f"  nearest(≤10m) 매칭: {nearest:,}")
        print(f"  미매칭:            {unmatched:,}")
        print(f"  매칭률:            {rate:.1f}% ({matched:,}/{total:,})")
    else:
        print("  매칭 RPC 응답 빈값.")


if __name__ == "__main__":
    main()
