#!/usr/bin/env python3
"""
토지소유공간정보 SHP(AL_D160) → buildings 대지면적(plat_area) 보강
+ vl_rat / bc_rat 재계산.

스코프 (사용자 결정):
  Q1 = B  지목 '대' 만 보강 (도로/공원/학교용지 등 제외)
  Q2 = B  같은 PNU 의 다른 buildings 행에 plat_area 가 이미 있으면
          그 값을 NULL 행에 복사. 단 다른 행들의 값이 서로 다르면
          (집합건물 분할 케이스) 보강 SKIP.
          기존 plat_area 가 전혀 없으면 SHP 의 필지 면적 사용.

UPDATE 규칙:
  - plat_area NULL 인 행만 UPDATE (덮어쓰기 X)
  - 같은 트랜잭션에서 vl_rat / bc_rat 도 NULL 이면 재계산:
      vl_rat = (tot_area  / plat_area) × 100
      bc_rat = (arch_area / plat_area) × 100
  - 기존 vl_rat / bc_rat 가 있으면 덮어쓰기 X

좌표계: SHP 는 EPSG:5186 (Korea Central Belt 2010). 좌표 변환 불필요 —
        PNU 키로만 매칭하므로 geometry 안 읽음.

환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
옵션: --dry-run, --verbose, --limit
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

import shapefile  # pyshp
from dotenv import load_dotenv
from shapely.geometry import shape

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SHP_PATH  = PROJECT_ROOT / "scripts" / "etl" / "raw" / "AL_D160_11_20251103" / "AL_D160_11_20251103"
AREA_PATH = PROJECT_ROOT / "src" / "gis" / "data" / "sindang-survey-area.json"
GEOJSON_PATH = PROJECT_ROOT / "src" / "gis" / "data" / "junggu-buildings-final-lite.geojson"

SIGUNGU_CD = "11140"
TABLE = "buildings"


# ─── 답사영역 PNU 추출 ──────────────────────────────────────

def load_survey_pnus():
    with open(AREA_PATH, "r", encoding="utf-8") as f:
        poly = shape(json.load(f)["features"][0]["geometry"])
    with open(GEOJSON_PATH, "r", encoding="utf-8") as f:
        gj = json.load(f)
    pnus = set()
    for feat in gj["features"]:
        try:
            if poly.contains(shape(feat["geometry"]).centroid):
                pnu = (feat["properties"].get("pnu") or "").strip()
                if pnu:
                    pnus.add(pnu)
        except Exception:
            pass
    return pnus


# ─── SHP → 중구 + 지목 '대' 필지 면적 dict ──────────────────

def load_shp_areas():
    """A0=PNU, A20=지목명, A22=면적(㎡), A24=시군구코드."""
    sf = shapefile.Reader(str(SHP_PATH), encoding="cp949")
    out = {}
    skipped_non_dae = 0
    skipped_other_dist = 0
    skipped_no_area = 0
    for rec in sf.iterRecords():
        if rec["A24"] != SIGUNGU_CD:
            skipped_other_dist += 1
            continue
        if rec["A20"] != "대":
            skipped_non_dae += 1
            continue
        a = rec["A22"]
        if not isinstance(a, (int, float)) or a <= 0:
            skipped_no_area += 1
            continue
        out[rec["A0"]] = float(a)
    return out, {
        "non_dae": skipped_non_dae,
        "other_dist": skipped_other_dist,
        "no_area": skipped_no_area,
    }


# ─── 보강 plan 구성 ─────────────────────────────────────────

def build_plans(rows, shp_areas):
    """
    rows: buildings 답사영역 SELECT 결과 (id, pnu, plat_area, arch_area, tot_area, vl_rat, bc_rat)
    shp_areas: {pnu: area}
    return: ([(id, pnu, update_dict)], stats_dict)
    """
    by_pnu = defaultdict(list)
    for r in rows:
        by_pnu[r["pnu"]].append(r)

    plans = []
    stats = {
        "pnu_no_null": 0,           # 모두 plat_area 있음 — 보강 대상 아님
        "pnu_filled_from_same":  0, # 같은 PNU 의 기존값 복사
        "pnu_filled_from_shp":   0, # SHP 의 필지 면적 사용
        "pnu_skip_inconsistent": 0, # 같은 PNU 값이 서로 다름 — SKIP
        "pnu_no_source":         0, # 다른 행 값 없음 + SHP 매칭 X
        "rows_plat_area_filled": 0,
        "rows_vl_rat_calc":      0,
        "rows_bc_rat_calc":      0,
    }

    for pnu, group in by_pnu.items():
        null_rows = [r for r in group if r["plat_area"] is None]
        if not null_rows:
            stats["pnu_no_null"] += 1
            continue

        # 1) 같은 PNU 의 다른 행에 plat_area 있는지 확인
        other = [float(r["plat_area"]) for r in group if r["plat_area"] is not None and float(r["plat_area"]) > 0]
        source = None
        if other:
            uniq = {round(v, 4) for v in other}
            if len(uniq) == 1:
                source = other[0]
                stats["pnu_filled_from_same"] += 1
            else:
                # 분할 케이스 — SKIP
                stats["pnu_skip_inconsistent"] += 1
                continue
        elif pnu in shp_areas:
            source = shp_areas[pnu]
            stats["pnu_filled_from_shp"] += 1
        else:
            stats["pnu_no_source"] += 1
            continue

        # 2) NULL 행마다 UPDATE 계획
        for r in null_rows:
            update = {"plat_area": round(source, 2)}
            tot = r.get("tot_area")
            arch = r.get("arch_area")
            if r.get("vl_rat") is None and tot:
                update["vl_rat"] = round(float(tot) / source * 100, 2)
                stats["rows_vl_rat_calc"] += 1
            if r.get("bc_rat") is None and arch:
                update["bc_rat"] = round(float(arch) / source * 100, 2)
                stats["rows_bc_rat_calc"] += 1
            plans.append((r["id"], pnu, update))
            stats["rows_plat_area_filled"] += 1

    return plans, stats


# ─── 메인 ────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="SHP → buildings plat_area 보강 + vl/bc 재계산")
    parser.add_argument("--dry-run", action="store_true", help="DB 쓰기 없이 시뮬레이션")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--limit", type=int, default=None, help="처음 N 행만 UPDATE")
    args = parser.parse_args()

    load_dotenv(PROJECT_ROOT / ".env.local")
    load_dotenv(PROJECT_ROOT / ".env")
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    client = None
    if url and key:
        from supabase import create_client  # type: ignore
        client = create_client(url, key)
    elif not args.dry_run:
        print("ERROR: SUPABASE_URL/SUPABASE_SERVICE_KEY 누락", file=sys.stderr)
        sys.exit(2)

    print("답사영역 PNU 로딩…")
    survey_pnus = load_survey_pnus()
    print(f"  {len(survey_pnus):,}")

    print("SHP 로딩 (중구 + 지목 '대' 만)…")
    shp_areas, shp_stats = load_shp_areas()
    print(f"  중구 지목 '대' unique PNU: {len(shp_areas):,}")
    print(f"  스킵: 타구 {shp_stats['other_dist']:,} · 지목 '대' 아님 {shp_stats['non_dae']:,} · 면적 없음 {shp_stats['no_area']:,}")
    inter = survey_pnus & set(shp_areas.keys())
    print(f"  답사영역 ∩ SHP: {len(inter):,}")

    print("buildings 조회…")
    rows = []
    if client is not None:
        pnu_list = list(survey_pnus)
        cols = "id,pnu,plat_area,arch_area,tot_area,vl_rat,bc_rat"
        for i in range(0, len(pnu_list), 200):
            res = client.table(TABLE).select(cols).in_("pnu", pnu_list[i:i+200]).execute()
            rows.extend(res.data or [])
    else:
        # dry-run + env 없음 — GeoJSON 폴백
        print("  (env 없음 → GeoJSON 폴백)")
        with open(GEOJSON_PATH) as f:
            gj = json.load(f)
        for feat in gj["features"]:
            pnu = (feat["properties"].get("pnu") or "").strip()
            if pnu in survey_pnus:
                p = feat["properties"]
                rows.append({
                    "id":        None,
                    "pnu":       pnu,
                    "plat_area": p.get("platArea") or None,
                    "arch_area": p.get("archArea") or None,
                    "tot_area":  p.get("totArea") or None,
                    "vl_rat":    p.get("vlRat") or None,
                    "bc_rat":    p.get("bcRat") or None,
                })
    print(f"  답사영역 buildings 행: {len(rows):,}")

    print("\n보강 plan 구성…")
    plans, stats = build_plans(rows, shp_areas)

    print(f"\n=== Plan 통계 ===")
    print(f"  PNU 분류:")
    print(f"    plat_area 모두 채워져 있음 (SKIP):     {stats['pnu_no_null']:,}")
    print(f"    같은 PNU 의 기존값 복사:                {stats['pnu_filled_from_same']:,}")
    print(f"    SHP 의 필지 면적 사용:                  {stats['pnu_filled_from_shp']:,}")
    print(f"    같은 PNU 값 불일치 → SKIP (분할 케이스): {stats['pnu_skip_inconsistent']:,}")
    print(f"    소스 없음 (다른 행도 NULL ∧ SHP 매칭 X): {stats['pnu_no_source']:,}")
    print(f"\n  UPDATE 대상 행: {stats['rows_plat_area_filled']:,}")
    print(f"    └ vl_rat 재계산: {stats['rows_vl_rat_calc']:,}")
    print(f"    └ bc_rat 재계산: {stats['rows_bc_rat_calc']:,}")

    if args.verbose and plans:
        print(f"\n[샘플 plan 5건]")
        for bid, pnu, u in plans[:5]:
            print(f"  id={bid} pnu={pnu}: {u}")

    if args.limit:
        plans = plans[:args.limit]
        print(f"\n--limit {args.limit} 적용 → {len(plans)} 건 처리")

    if args.dry_run:
        print("\n*** DRY RUN — DB 쓰기 없음 ***")
        return

    if not plans:
        print("보강할 행이 없습니다. 종료.")
        return

    print(f"\nUPDATE 실행 중…")
    ok = 0
    for bid, pnu, u in plans:
        try:
            client.table(TABLE).update(u).eq("id", bid).execute()
            ok += 1
            if ok % 100 == 0:
                print(f"  {ok:,}/{len(plans):,}", end="\r")
        except Exception as e:
            print(f"\nERROR id={bid} pnu={pnu}: {e}", file=sys.stderr)
    print(f"\n완료: {ok:,} 행 UPDATE 성공.")


if __name__ == "__main__":
    main()
