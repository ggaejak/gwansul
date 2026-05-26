#!/usr/bin/env python3
"""
VWorld WFS(lt_c_spbd) 폴리곤 → buildings.geom 교체.

배경: buildings 의 GIS 폴리곤이 VWorld 배경지도와 5~10m 어긋남.
      같은 VWorld 데이터셋 폴리곤으로 geom 만 교체 → 시각 일치.

스코프: 답사영역 (sindang-survey-area.json) 한정.

입력:
  scripts/etl/raw/sindang-vworld-buildings.geojson
    (Phase 2 에서 WFS BBOX 3x3 분할 다운로드 결과)

매칭 알고리즘:
  PNU 단위 그룹화:
    1:1 PNU  → 직접 UPDATE
    N:M PNU  → 같은 PNU 안에서 centroid 거리 그리디 nearest 매칭
  VWorld 에만 있는 폴리곤 (어디에도 매칭 X) → 새 건물 INSERT
  buildings 에만 있는 행 (VWorld PNU 없음)  → 사라진 건물 보고만 (삭제 X)

UPDATE 규칙:
  - geom 만 교체. 다른 속성 (vl_rat, plat_area, bld_nm 등) 그대로 보존.

INSERT 규칙 (새 건물):
  - pnu, geom, district_code='11140', data_source='vworld_spbd_YYYYMMDD'
  - bld_nm = VWorld.buld_nm (있을 때)
  - 나머지 속성 NULL

환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY
옵션: --dry-run, --verbose, --limit
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from shapely.geometry import shape

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
VWORLD_PATH = PROJECT_ROOT / "scripts" / "etl" / "raw" / "sindang-vworld-buildings.geojson"
AREA_PATH   = PROJECT_ROOT / "src" / "gis" / "data" / "sindang-survey-area.json"

TABLE = "buildings"
DISTRICT = "11140"
MATCH_MAX_DIST_M = 30   # centroid 이동 이 거리 초과면 매칭 SKIP (이상치 차단)


# ─── 헬퍼 ────────────────────────────────────────────────────

import math

def centroid_xy(geom):
    """shapely geometry → (lon, lat)."""
    c = geom.centroid
    return (c.x, c.y)


def dist2(a, b):
    return (a[0]-b[0])**2 + (a[1]-b[1])**2


def dist_m(a, b):
    """approx meters between two (lon, lat) — small distance, equirectangular."""
    lat0 = (a[1] + b[1]) / 2
    dx = (a[0] - b[0]) * 111000.0 * math.cos(math.radians(lat0))
    dy = (a[1] - b[1]) * 111000.0
    return math.sqrt(dx*dx + dy*dy)


def to_ewkt(geom):
    """shapely → 'SRID=4326;...' (PostgREST UPDATE 호환)."""
    return f"SRID=4326;{geom.wkt}"


# ─── 메인 ────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="VWorld 폴리곤 → buildings.geom 교체")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--skip-insert", action="store_true",
                        help="새 건물 INSERT 생략 (UPDATE 만)")
    args = parser.parse_args()

    load_dotenv(PROJECT_ROOT / ".env.local")
    load_dotenv(PROJECT_ROOT / ".env")
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL/SUPABASE_SERVICE_KEY 누락", file=sys.stderr)
        sys.exit(2)
    from supabase import create_client  # type: ignore
    client = create_client(url, key)

    data_source = f"vworld_spbd_{datetime.now().strftime('%Y%m%d')}"
    print(f"data_source: {data_source}")

    # 1. 답사영역 폴리곤
    with open(AREA_PATH, "r", encoding="utf-8") as f:
        area_poly = shape(json.load(f)["features"][0]["geometry"])

    # 2. VWorld features 로드 → PNU 별 그루핑 (답사영역 폴리곤 내부 centroid만)
    with open(VWORLD_PATH, "r", encoding="utf-8") as f:
        vworld_fc = json.load(f)

    vworld_by_pnu = defaultdict(list)   # pnu -> [{geom, centroid, props}]
    skipped_outside = 0
    skipped_no_pnu = 0
    for f in vworld_fc["features"]:
        pnu = (f["properties"].get("pnu") or "").strip()
        if not pnu:
            skipped_no_pnu += 1
            continue
        try:
            g = shape(f["geometry"])
            c = centroid_xy(g)
        except Exception:
            continue
        if not area_poly.contains(g.centroid):
            skipped_outside += 1
            continue
        vworld_by_pnu[pnu].append({
            "geom": g,
            "centroid": c,
            "props": f["properties"],
        })
    print(f"\nVWorld features:")
    print(f"  답사영역 내부 (PNU 매칭 후보): {sum(len(v) for v in vworld_by_pnu.values()):,}")
    print(f"  └ unique PNU: {len(vworld_by_pnu):,}")
    print(f"  답사영역 외부 skip: {skipped_outside:,}")
    print(f"  PNU 없음 skip: {skipped_no_pnu:,}")

    # 3. buildings 조회 — VWorld PNU + (안전망) 답사영역 buildings PNU 합집합
    #    답사영역 buildings PNU 는 GeoJSON 에서 추출 (geom centroid 폴리곤 내부)
    geojson_path = PROJECT_ROOT / "src" / "gis" / "data" / "junggu-buildings-final-lite.geojson"
    with open(geojson_path, "r", encoding="utf-8") as f:
        gj = json.load(f)
    area_buildings_pnus = set()
    for feat in gj["features"]:
        try:
            if area_poly.contains(shape(feat["geometry"]).centroid):
                pnu = (feat["properties"].get("pnu") or "").strip()
                if pnu:
                    area_buildings_pnus.add(pnu)
        except Exception:
            pass
    query_pnus = set(vworld_by_pnu.keys()) | area_buildings_pnus
    print(f"\nbuildings 조회 PNU: {len(query_pnus):,}  (VWorld {len(vworld_by_pnu)} ∪ area {len(area_buildings_pnus)})")

    # RPC 호출 (배치)
    rows = []
    pnu_list = list(query_pnus)
    BATCH = 300
    for i in range(0, len(pnu_list), BATCH):
        res = client.rpc("buildings_by_pnus_with_geom", {"p_pnus": pnu_list[i:i+BATCH]}).execute()
        rows.extend(res.data or [])
    print(f"buildings 행 수: {len(rows):,}")

    buildings_by_pnu = defaultdict(list)
    for r in rows:
        try:
            geom = shape(r["geom_json"])
            r["_centroid"] = centroid_xy(geom)
        except Exception:
            r["_centroid"] = None
        buildings_by_pnu[r["pnu"]].append(r)

    # 4. 매칭
    updates = []    # [(id, ewkt)]
    inserts = []    # [{pnu, geom(EWKT), bld_nm, district_code, data_source}]
    missing_in_vworld = []   # buildings 행 (PNU 가 VWorld 에 아예 없음 or 임계 초과로 분리)
    skipped_no_centroid = 0
    pnu_categories = {"1:1": 0, "1:1_split": 0, "N:M": 0, "only_buildings": 0, "only_vworld": 0}
    threshold_skipped = 0    # 임계 초과로 매칭 SKIP 한 쌍 수

    all_pnus = set(buildings_by_pnu.keys()) | set(vworld_by_pnu.keys())
    for pnu in all_pnus:
        b_rows = buildings_by_pnu.get(pnu, [])
        v_feats = vworld_by_pnu.get(pnu, [])

        if b_rows and not v_feats:
            # buildings 만 — VWorld 에 PNU 없음. 사라진 건물 후보
            pnu_categories["only_buildings"] += 1
            for b in b_rows:
                missing_in_vworld.append(b)
            continue

        if v_feats and not b_rows:
            # VWorld 만 — 새 건물 후보
            pnu_categories["only_vworld"] += 1
            for v in v_feats:
                inserts.append({
                    "pnu": pnu,
                    "geom": to_ewkt(v["geom"]),
                    "bld_nm": (v["props"].get("buld_nm") or None),
                    "district_code": DISTRICT,
                    "data_source": data_source,
                })
            continue

        # 양쪽 있음 — 매칭 (임계 거리 체크)
        if len(b_rows) == 1 and len(v_feats) == 1:
            b, v = b_rows[0], v_feats[0]
            if b["_centroid"] is None:
                # centroid 못 구함 — 보수적으로 매칭 SKIP, missing/new 로 분리
                missing_in_vworld.append(b)
                inserts.append({
                    "pnu": pnu, "geom": to_ewkt(v["geom"]),
                    "bld_nm": (v["props"].get("buld_nm") or None),
                    "district_code": DISTRICT, "data_source": data_source,
                })
                pnu_categories["1:1_split"] += 1
                continue
            d = dist_m(b["_centroid"], v["centroid"])
            if d > MATCH_MAX_DIST_M:
                # 임계 초과 — 같은 PNU 라도 다른 건물로 보고 분리
                threshold_skipped += 1
                pnu_categories["1:1_split"] += 1
                missing_in_vworld.append(b)
                inserts.append({
                    "pnu": pnu, "geom": to_ewkt(v["geom"]),
                    "bld_nm": (v["props"].get("buld_nm") or None),
                    "district_code": DISTRICT, "data_source": data_source,
                })
            else:
                pnu_categories["1:1"] += 1
                updates.append((b["id"], to_ewkt(v["geom"])))
            continue

        pnu_categories["N:M"] += 1
        # 그리디 nearest 매칭 + 임계 거리 체크
        used_v = set()
        used_b = set()
        candidates = []
        for bi, b in enumerate(b_rows):
            if b["_centroid"] is None:
                skipped_no_centroid += 1
                continue
            for vi, v in enumerate(v_feats):
                candidates.append((dist2(b["_centroid"], v["centroid"]), bi, vi))
        candidates.sort()
        for _, bi, vi in candidates:
            if bi in used_b or vi in used_v:
                continue
            d_m = dist_m(b_rows[bi]["_centroid"], v_feats[vi]["centroid"])
            if d_m > MATCH_MAX_DIST_M:
                threshold_skipped += 1
                continue   # 너무 멀면 매칭 안 함 (다음 후보 시도)
            updates.append((b_rows[bi]["id"], to_ewkt(v_feats[vi]["geom"])))
            used_b.add(bi)
            used_v.add(vi)
        for bi, b in enumerate(b_rows):
            if bi not in used_b:
                missing_in_vworld.append(b)
        for vi, v in enumerate(v_feats):
            if vi not in used_v:
                inserts.append({
                    "pnu": pnu,
                    "geom": to_ewkt(v["geom"]),
                    "bld_nm": (v["props"].get("buld_nm") or None),
                    "district_code": DISTRICT,
                    "data_source": data_source,
                })

    # 5. geom 변화량 계산 (UPDATE 대상만, dry-run 에서만 분석)
    centroid_shifts = []
    by_id = {r["id"]: r for r in rows}
    for bid, ewkt in updates[:500]:  # 샘플 500
        b = by_id.get(bid)
        if not b or b.get("_centroid") is None: continue
        try:
            # ewkt 에서 geom 다시 파싱
            wkt = ewkt.split(";", 1)[1]
            from shapely import wkt as shp_wkt
            new_g = shp_wkt.loads(wkt)
            new_c = centroid_xy(new_g)
            # 미터 환산 (대략): 위도 차이 × 111000, 경도 × 111000 × cos(lat)
            import math
            lat0 = (b["_centroid"][1] + new_c[1]) / 2
            dx = (new_c[0] - b["_centroid"][0]) * 111000 * math.cos(math.radians(lat0))
            dy = (new_c[1] - b["_centroid"][1]) * 111000
            shift_m = math.sqrt(dx*dx + dy*dy)
            centroid_shifts.append(shift_m)
        except Exception:
            pass

    # 통계
    print(f"\n=== 매칭 결과 (임계 {MATCH_MAX_DIST_M}m 적용) ===")
    print(f"  PNU 분류:")
    print(f"    1:1 매칭 성공  : {pnu_categories['1:1']:,}")
    print(f"    1:1 임계 분리  : {pnu_categories['1:1_split']:,}")
    print(f"    N:M             : {pnu_categories['N:M']:,}")
    print(f"    buildings 만 (VWorld PNU 없음): {pnu_categories['only_buildings']:,}")
    print(f"    VWorld 만 (새 건물 후보):       {pnu_categories['only_vworld']:,}")
    print(f"  임계 초과로 매칭 SKIP 한 쌍: {threshold_skipped:,}")
    print(f"\n  UPDATE 대상 행: {len(updates):,}")
    print(f"  INSERT 대상 행 (새 건물): {len(inserts):,}")
    print(f"  사라진 건물 (보고만): {len(missing_in_vworld):,}")
    if skipped_no_centroid:
        print(f"  buildings centroid 파싱 실패: {skipped_no_centroid:,}")

    if centroid_shifts:
        centroid_shifts.sort()
        n = len(centroid_shifts)
        print(f"\n  centroid 이동량 (UPDATE 샘플 {n}건):")
        print(f"    중앙값: {centroid_shifts[n//2]:.2f} m")
        print(f"    평균:   {sum(centroid_shifts)/n:.2f} m")
        print(f"    최대:   {centroid_shifts[-1]:.2f} m")

    if args.verbose and missing_in_vworld[:5]:
        print(f"\n  [사라진 건물 샘플 5건]")
        for b in missing_in_vworld[:5]:
            print(f"    id={b['id']} pnu={b['pnu']} address={b.get('address')}")

    if args.verbose and inserts[:5]:
        print(f"\n  [새 건물 INSERT 샘플 5건]")
        for i in inserts[:5]:
            print(f"    pnu={i['pnu']} bld_nm={i['bld_nm']!r}")

    if args.limit:
        updates = updates[:args.limit]
        inserts = inserts[:args.limit]
        print(f"\n--limit {args.limit} 적용")

    if args.dry_run:
        print("\n*** DRY RUN — DB 쓰기 없음 ***")
        return

    # 6. 실행
    print(f"\nUPDATE 실행 중 (geom 만 교체)…")
    ok_u = 0
    for bid, ewkt in updates:
        try:
            client.table(TABLE).update({"geom": ewkt}).eq("id", bid).execute()
            ok_u += 1
            if ok_u % 200 == 0:
                print(f"  {ok_u:,}/{len(updates):,}", end="\r")
        except Exception as e:
            print(f"\nERROR UPDATE id={bid}: {e}", file=sys.stderr)
    print(f"\n  UPDATE 완료: {ok_u}/{len(updates)}")

    if not args.skip_insert and inserts:
        print(f"\nINSERT 실행 중 (새 건물)…")
        ok_i = 0
        BATCH_INS = 100
        for i in range(0, len(inserts), BATCH_INS):
            chunk = inserts[i:i+BATCH_INS]
            try:
                client.table(TABLE).insert(chunk).execute()
                ok_i += len(chunk)
                print(f"  {ok_i:,}/{len(inserts):,}", end="\r")
            except Exception as e:
                print(f"\nERROR INSERT batch starting pnu={chunk[0]['pnu']}: {e}", file=sys.stderr)
        print(f"\n  INSERT 완료: {ok_i}/{len(inserts)}")

    print(f"\n=== 작업 완료 ===")


if __name__ == "__main__":
    main()
