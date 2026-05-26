#!/usr/bin/env python3
"""
DB → 정적 GeoJSON 내보내기.

buildings 테이블의 모든 중구(district_code='11140') 건물을 GeoJSON
FeatureCollection 으로 직렬화해
src/gis/data/junggu-buildings-final-lite.geojson 을 덮어쓴다.

목적:
  - 적재/보강 결과(주소·면적·연도·건물명 등)를 정적 fallback 파일에도
    반영해 VITE_USE_DB_BUILDINGS=false 환경(또는 DB 폴백 시) 에서도
    최신 상태가 보이도록 유지.

환경변수 (.env / .env.local 에서 자동 로드):
  SUPABASE_URL          https://<ref>.supabase.co
  SUPABASE_SERVICE_KEY  service_role 키 (RLS 우회)

조회 방식:
  client.table("buildings") 로 페이지네이션 조회.
  geom 컬럼은 PostgREST 가 hex EWKB / EWKT / GeoJSON 중 한 형식으로
  반환할 수 있어 parse_geom() 에서 모두 처리.
  중구 전체 약 2만건, PAGE_SIZE=1000 으로 약 21회 round-trip.

출력 속성 (기존 lite 파일 + bldNm):
  pnu, address, bldNm, regType, mainPurps, strct,
  archArea, useAprDay, totArea, platArea, bcRat, vlRat,
  grndFlrCnt, ugrndFlrCnt, bjdongCd

NULL 환원:
  기존 lite 포맷과 호환되도록 (`vlRat > 0` 같은 느슨한 비교가 그대로 동작)
    numeric NULL → 0
    string  NULL → ""
    date    NULL → ""

사용:
  python scripts/etl/exportBuildingsToGeojson.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from shapely import wkb, wkt
from shapely.geometry import mapping
from supabase import Client, create_client

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_PATH = PROJECT_ROOT / "src" / "gis" / "data" / "junggu-buildings-final-lite.geojson"

DISTRICT = "11140"
PAGE_SIZE = 1000  # PostgREST 의 db-max-rows 기본치(있다면)보다 작거나 같게.

SELECT_COLS = (
    "pnu,address,bld_nm,reg_type,main_purps,strct,"
    "arch_area,use_apr_day,tot_area,plat_area,bc_rat,vl_rat,"
    "grnd_flr_cnt,ugrnd_flr_cnt,bjdong_cd,geom"
)


# ─── 변환 유틸 ────────────────────────────────────────────────

def _num_or_zero(v):
    if v is None:
        return 0
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0
    i = int(f)
    return i if f == i else f


def _int_or_zero(v):
    if v is None:
        return 0
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _str_or_empty(v):
    return "" if v is None else str(v)


def parse_geom(raw):
    """
    PostgREST 가 PostGIS geometry 컬럼을 돌려주는 가능한 형식들을
    GeoJSON geometry dict 로 환원.
      - dict          : 이미 GeoJSON
      - "{...}"       : GeoJSON 문자열
      - hex EWKB      : "0103000020E610..."  (가장 흔함)
      - (E)WKT        : "SRID=4326;POLYGON((...))" 또는 "POLYGON((...))"
    실패 시 None.
    """
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s:
        return None

    if s.startswith("{"):
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            return None

    # hex EWKB
    if all(c in "0123456789abcdefABCDEF" for c in s):
        try:
            return mapping(wkb.loads(bytes.fromhex(s)))
        except Exception:
            pass

    # (E)WKT — "SRID=4326;..." prefix 제거
    body = s.split(";", 1)[1] if s.upper().startswith("SRID=") else s
    try:
        return mapping(wkt.loads(body))
    except Exception:
        return None


def row_to_feature(row):
    geometry = parse_geom(row.get("geom"))
    if geometry is None:
        return None
    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "pnu":         _str_or_empty(row.get("pnu")),
            "address":     _str_or_empty(row.get("address")),
            "bldNm":       _str_or_empty(row.get("bld_nm")),
            "regType":     _str_or_empty(row.get("reg_type")),
            "mainPurps":   _str_or_empty(row.get("main_purps")),
            "strct":       _str_or_empty(row.get("strct")),
            "archArea":    _num_or_zero(row.get("arch_area")),
            "useAprDay":   _str_or_empty(row.get("use_apr_day")),
            "totArea":     _num_or_zero(row.get("tot_area")),
            "platArea":    _num_or_zero(row.get("plat_area")),
            "bcRat":       _num_or_zero(row.get("bc_rat")),
            "vlRat":       _num_or_zero(row.get("vl_rat")),
            "grndFlrCnt":  _int_or_zero(row.get("grnd_flr_cnt")),
            "ugrndFlrCnt": _int_or_zero(row.get("ugrnd_flr_cnt")),
            "bjdongCd":    _str_or_empty(row.get("bjdong_cd")),
        },
    }


# ─── 메인 ─────────────────────────────────────────────────────

def main():
    # .env.local 을 먼저 로드해서 .env 가 덮어쓰지 않게 함 (load_dotenv 는 기본 override=False).
    load_dotenv(PROJECT_ROOT / ".env.local")
    load_dotenv(PROJECT_ROOT / ".env")

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print(
            "[error] SUPABASE_URL / SUPABASE_SERVICE_KEY 가 .env / .env.local 에 없습니다.",
            file=sys.stderr,
        )
        sys.exit(1)

    client: Client = create_client(url, key)
    print(f"[info] connected to {url}")

    # ─── 예상 행수 확인 (count='exact', head=True 로 데이터 없이 카운트만) ───
    count_resp = (
        client.table("buildings")
        .select("pnu", count="exact", head=True)
        .eq("district_code", DISTRICT)
        .execute()
    )
    expected = count_resp.count or 0
    if expected == 0:
        print("[error] DB 에 중구 건물이 0건. 적재가 안 됐거나 권한 문제.", file=sys.stderr)
        sys.exit(1)
    print(f"[info] expected rows: {expected:,}")

    # ─── 페이지네이션 조회 ────────────────────────────────────
    features = []
    skipped_geom = 0
    offset = 0
    while True:
        end = offset + PAGE_SIZE - 1
        resp = (
            client.table("buildings")
            .select(SELECT_COLS)
            .eq("district_code", DISTRICT)
            .order("id")                 # PK 기준 안정적 페이징 (pnu 는 집합건물로 중복 가능)
            .range(offset, end)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            break

        for row in rows:
            feat = row_to_feature(row)
            if feat is None:
                skipped_geom += 1
                continue
            features.append(feat)

        print(f"  [{offset + len(rows):>6,} / {expected:,}] fetched")

        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    if skipped_geom:
        print(f"[warn] skipped {skipped_geom} rows with unparseable / missing geom")

    if len(features) < expected - skipped_geom:
        print(
            f"[warn] feature count ({len(features):,}) < expected ({expected:,}) — "
            "PostgREST db-max-rows 제한일 수 있음. supabase 프로젝트 설정 확인.",
            file=sys.stderr,
        )

    # ─── 쓰기 ────────────────────────────────────────────────
    fc = {"type": "FeatureCollection", "features": features}
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = OUTPUT_PATH.stat().st_size / (1024 * 1024)
    print(f"[done] features={len(features):,}  file={OUTPUT_PATH.relative_to(PROJECT_ROOT)}  ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
