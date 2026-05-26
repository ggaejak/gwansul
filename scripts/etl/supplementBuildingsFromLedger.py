#!/usr/bin/env python3
"""
서울시 건축물대장 표제부 CSV → buildings 테이블 결측 필드 보강.

스코프 (사용자 결정):
  대지면적/용적률/건폐율은 제외 (Phase 2 분석 결과 보강 효과 5% 수준).
  연면적/건축면적/주용도/구조/지상층수/지하층수/사용승인일만 보강.

매칭 키:
  CSV 의 동명을 buildings 의 (address, bjdong_cd) 에서 추출한 매핑으로
  법정동코드(5) 변환 → PNU 19 자리 = "11140" + 동코드 + 대지구분(1) + 주지번(4) + 부지번(4)
  대지구분: "대지"→1, "산"→2

대상:
  답사영역 폴리곤 내부 건물만 (junggu-buildings-final-lite.geojson centroid 기준).
  PNU 단위로 CSV 다중 행은 주부속구분 "주건축물" 우선 → 필드별 첫 유효값.

UPDATE 규칙:
  - 기존 값이 NULL 인 컬럼만 채움 (덮어쓰기 X)
  - CSV 값이 빈/0(숫자) 또는 빈문자/파싱실패 → 보강 안 함

환경변수:
  SUPABASE_URL, SUPABASE_SERVICE_KEY

옵션:
  --dry-run : DB 쓰기 없이 보강 시뮬레이션
  --verbose : 통계 + 샘플
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from shapely.geometry import shape

# ─── 상수 ────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CSV_PATH        = PROJECT_ROOT / "scripts" / "etl" / "raw" / "서울시 건축물대장 표제부.csv"
GEOJSON_PATH    = PROJECT_ROOT / "src" / "gis" / "data" / "junggu-buildings-final-lite.geojson"
AREA_PATH       = PROJECT_ROOT / "src" / "gis" / "data" / "sindang-survey-area.json"
DONG_MAP_PATH   = PROJECT_ROOT / "scripts" / "etl" / "raw" / "_dong_code_map.json"

SIGUNGU_CD = "11140"
TABLE = "buildings"
CSV_ENCODING = "cp949"
DONG_RE = re.compile(r"중구\s+(\S+동\S*?)\s")

# (CSV 컬럼, DB 컬럼, 파서) — 대지면적/용적률/건폐율 제외
FIELDS = [
    ("건축면적",      "arch_area",     "num"),
    ("연면적",        "tot_area",      "num"),
    ("주용도코드명",  "main_purps",    "str"),
    ("구조코드명",    "strct",         "str"),
    ("지상층수",      "grnd_flr_cnt",  "int"),
    ("지하층수",      "ugrnd_flr_cnt", "int"),
    ("사용승인일자",  "use_apr_day",   "date"),
]


# ─── 파서 ────────────────────────────────────────────────────

def parse_num(v):
    s = (v or "").strip()
    if not s:
        return None
    try:
        x = float(s)
    except ValueError:
        return None
    return None if x == 0.0 else x

def parse_int(v):
    s = (v or "").strip()
    if not s:
        return None
    try:
        x = int(float(s))
    except ValueError:
        return None
    return None if x == 0 else x

def parse_str(v):
    s = (v or "").strip()
    return s or None

def parse_date(v):
    s = (v or "").strip()
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date().isoformat()
    except ValueError:
        return None

PARSERS = {"num": parse_num, "int": parse_int, "str": parse_str, "date": parse_date}


# ─── 동명 → 법정동코드 매핑 (없으면 GeoJSON 에서 즉석 추출) ───

def load_or_build_dong_map(geojson):
    if DONG_MAP_PATH.exists():
        with open(DONG_MAP_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    print("동매핑 캐시 없음 — GeoJSON 에서 즉석 추출…")
    counts = defaultdict(lambda: defaultdict(int))
    for feat in geojson["features"]:
        p = feat["properties"]
        code = (p.get("bjdongCd") or "").strip()
        addr = (p.get("address") or "").strip()
        if not code or len(code) != 5:
            continue
        m = DONG_RE.search(addr)
        if not m:
            continue
        counts[m.group(1).strip()][code] += 1
    return {dong: max(c.items(), key=lambda x: x[1])[0] for dong, c in counts.items()}


# ─── PNU 생성 + CSV 집계 ─────────────────────────────────────

def make_pnu(row, dong_map):
    dong = (row.get("법정동코드명") or "").strip()
    bjdong = dong_map.get(dong)
    if not bjdong:
        return None
    plat_div = (row.get("대지구분코드명") or "").strip()
    plat_pnu = "1" if plat_div == "대지" else "2" if plat_div == "산" else None
    if plat_pnu is None:
        return None
    bun = (row.get("주지번") or "").zfill(4)
    ji  = (row.get("부지번") or "").zfill(4)
    if len(bun) != 4 or len(ji) != 4 or not bun.isdigit() or not ji.isdigit():
        return None
    return f"{SIGUNGU_CD}{bjdong}{plat_pnu}{bun}{ji}"


def aggregate_pnu(rows):
    """같은 PNU 의 여러 행 → 주건축물 우선, 필드별 첫 유효값."""
    rows = sorted(
        rows,
        key=lambda r: 0 if (r.get("주부속구분코드명") or "").strip() == "주건축물" else 1,
    )
    out = {}
    for csv_col, db_col, kind in FIELDS:
        parser = PARSERS[kind]
        for r in rows:
            v = parser(r.get(csv_col))
            if v is not None:
                out[db_col] = v
                break
    return out


# ─── 메인 ─────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="건축물대장 CSV → buildings 결측 보강 (대지/용적률/건폐율 제외)",
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="DB 쓰기 없이 보강 시뮬레이션")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--limit", type=int, default=None,
                        help="UPDATE 대상 buildings 행 N 건만 처리 (검증용)")
    args = parser.parse_args()

    # 0. env
    env_local = PROJECT_ROOT / ".env.local"
    env_default = PROJECT_ROOT / ".env"
    if env_local.exists(): load_dotenv(env_local)
    if env_default.exists(): load_dotenv(env_default)

    # dry-run 도 SELECT 는 가능 — 정확한 DB 결측 기반 시뮬레이션을 위해 client 생성.
    # 환경변수 없으면 GeoJSON 폴백 (정확도 낮음, 0 도 NULL 로 추정).
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if url and key:
        from supabase import create_client  # type: ignore
        client = create_client(url, key)
    else:
        client = None
        if not args.dry_run:
            print("ERROR: SUPABASE_URL/SUPABASE_SERVICE_KEY 누락", file=sys.stderr)
            sys.exit(2)
        print("(env 없음 → GeoJSON 폴백, 0 값을 NULL 로 추정)")

    # 1. 답사영역 + GeoJSON 로드
    with open(AREA_PATH, "r", encoding="utf-8") as f:
        area_poly = shape(json.load(f)["features"][0]["geometry"])
    with open(GEOJSON_PATH, "r", encoding="utf-8") as f:
        gj = json.load(f)

    # 답사영역 내 unique PNU
    area_pnus = set()
    for feat in gj["features"]:
        try:
            c = shape(feat["geometry"]).centroid
            if not area_poly.contains(c):
                continue
        except Exception:
            continue
        pnu = (feat["properties"].get("pnu") or "").strip()
        if pnu:
            area_pnus.add(pnu)
    print(f"답사영역 unique PNU: {len(area_pnus):,}")

    # 2. 동매핑 로드
    dong_map = load_or_build_dong_map(gj)
    print(f"동매핑: {len(dong_map)} 동")

    # 3. CSV 스캔 — 답사영역 PNU 에 해당하는 행만 수집
    csv_by_pnu = defaultdict(list)
    csv_total = 0
    pnu_fail = 0
    with open(CSV_PATH, "r", encoding=CSV_ENCODING, errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if (row.get("시군구코드명") or "").strip() != "서울특별시 중구":
                continue
            csv_total += 1
            pnu = make_pnu(row, dong_map)
            if pnu is None:
                pnu_fail += 1
                continue
            if pnu in area_pnus:
                csv_by_pnu[pnu].append(row)
    print(f"CSV 중구 행: {csv_total:,}  ·  PNU 생성 실패: {pnu_fail:,}")
    print(f"답사영역 매칭 CSV PNU: {len(csv_by_pnu):,}")

    # 4. PNU 별 집계 — 필드별 첫 유효값
    pnu_supplements = {pnu: aggregate_pnu(rows) for pnu, rows in csv_by_pnu.items()}

    if args.verbose:
        print("\n[샘플 PNU 집계 결과 (상위 3건)]")
        for pnu in list(pnu_supplements)[:3]:
            print(f"  {pnu}: {pnu_supplements[pnu]}")

    # 5. buildings 조회 — 답사영역 PNU 중 CSV 매칭되는 것
    print("\nbuildings 조회 중…")
    pnus_to_query = list(pnu_supplements.keys())
    rows_db = []
    BATCH = 200  # IN 절 크기
    select_cols = "id,pnu," + ",".join(f[1] for f in FIELDS)
    if client is not None:
        for i in range(0, len(pnus_to_query), BATCH):
            chunk = pnus_to_query[i:i+BATCH]
            res = client.table(TABLE).select(select_cols).in_("pnu", chunk).execute()
            rows_db.extend(res.data or [])
    else:
        # GeoJSON 폴백 (dry-run + env 없음)
        for feat in gj["features"]:
            pnu = (feat["properties"].get("pnu") or "").strip()
            if pnu in pnu_supplements:
                p = feat["properties"]
                rows_db.append({
                    "id":            None,
                    "pnu":           pnu,
                    "arch_area":     p.get("archArea") if "archArea" in p else None,
                    "tot_area":      p.get("totArea"),
                    "main_purps":    p.get("mainPurps"),
                    "strct":         p.get("strct"),
                    "grnd_flr_cnt":  p.get("grndFlrCnt"),
                    "ugrnd_flr_cnt": p.get("ugrndFlrCnt"),
                    "use_apr_day":   p.get("useAprDay"),
                })

    print(f"buildings 행 수 (답사영역 매칭 PNU): {len(rows_db):,}")
    # 같은 PNU 에 buildings 행이 여러 개일 수 있음
    db_pnu_count = defaultdict(int)
    for r in rows_db:
        db_pnu_count[r["pnu"]] += 1
    multi = sum(1 for n in db_pnu_count.values() if n > 1)
    print(f"  └ unique PNU: {len(db_pnu_count):,}  ·  PNU 다중행 PNU: {multi:,}")

    # 6. 보강 — NULL 필드만 채움
    update_plans = []     # [(id, pnu, {field: value, ...})]
    fill_count_by_field = defaultdict(int)

    def is_null(v):
        if v is None:
            return True
        if isinstance(v, str) and not v.strip():
            return True
        if isinstance(v, (int, float)) and v == 0:
            # buildings ETL 에서 0 은 NULL 치환되지만, geojson 폴백 시 0 이 살아있을 수 있음.
            # tot_area 의 진짜 0 은 매우 드물어 안전하게 NULL 취급.
            return True
        return False

    for r in rows_db:
        sup = pnu_supplements.get(r["pnu"], {})
        if not sup:
            continue
        plan = {}
        for _, db_col, _ in FIELDS:
            if is_null(r.get(db_col)) and db_col in sup:
                plan[db_col] = sup[db_col]
                fill_count_by_field[db_col] += 1
        if plan:
            update_plans.append((r["id"], r["pnu"], plan))

    print(f"\n=== 보강 계획 ===")
    print(f"  UPDATE 대상 행: {len(update_plans):,}")
    print(f"  필드별 보강 카운트:")
    for _, db_col, _ in FIELDS:
        c = fill_count_by_field.get(db_col, 0)
        print(f"    {db_col:14s}: {c:,}")

    if args.verbose and update_plans:
        print(f"\n[샘플 UPDATE 계획 5건]")
        for bid, pnu, plan in update_plans[:5]:
            print(f"  id={bid} pnu={pnu}: {plan}")

    if args.limit:
        update_plans = update_plans[:args.limit]
        print(f"\n--limit {args.limit} 적용 → {len(update_plans)} 건만 처리")

    if args.dry_run:
        print("\n*** DRY RUN — DB 쓰기 없음 ***")
        return

    if not update_plans:
        print("보강할 행이 없습니다. 종료.")
        return

    # 7. 실제 UPDATE
    print(f"\nUPDATE 실행 중…")
    ok = 0
    for bid, pnu, plan in update_plans:
        try:
            client.table(TABLE).update(plan).eq("id", bid).execute()
            ok += 1
            if ok % 50 == 0:
                print(f"  {ok:,}/{len(update_plans):,}", end="\r")
        except Exception as e:
            print(f"\nERROR id={bid} pnu={pnu}: {e}", file=sys.stderr)
    print(f"\n완료: {ok:,} 행 UPDATE 성공.")


if __name__ == "__main__":
    main()
