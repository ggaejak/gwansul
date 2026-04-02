"""
인구통계 데이터 전처리: 집계구 GeoJSON + 생활인구 CSV → demographics.json
실행: python3 scripts/etl/buildDemographics.py
"""
import json
import csv
import os
import random
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GEO_PATH = os.path.join(BASE_DIR, '../../src/gis/data/서울_중구_집계구_2017.geojson')
CSV_PATH = os.path.join(BASE_DIR, '../../src/gis/data/집계구 단위 서울 생활인구(내국인).csv')
OUT_PATH = os.path.join(BASE_DIR, '../../src/gis/data/junggu-demographics.json')

def safe_float(v):
    try:
        if v == '*' or v == '': return 0
        return float(v)
    except: return 0

# ─── 집계구 GeoJSON 로드 ─────────────────────────────────────
with open(GEO_PATH, 'r') as f:
    geo = json.load(f)
print(f'집계구 폴리곤: {len(geo["features"])}개')

# 집계구코드 → 폴리곤 매핑
tract_map = {}
for feat in geo['features']:
    code = feat['properties']['TOT_OA_CD']
    tract_map[code] = feat

# ─── CSV 로드 (중구 집계구만, 시간대별 집계) ─────────────────
# CSV의 행정동코드가 1114xxxx 이면 중구
# 집계구코드로 매칭하는 게 더 정확 (tract_map에 있는 것만)

print('CSV 로드 중...')
# 시간대별 집계: { 집계구코드: { 시간대: { 'total': N, 'age_0_19': N, 'age_20_39': N, 'age_40_59': N, 'age_60+': N } } }
tract_hourly = defaultdict(lambda: defaultdict(lambda: {'total': 0, 'age_0_19': 0, 'age_20_39': 0, 'age_40_59': 0, 'age_60_plus': 0}))

with open(CSV_PATH, 'r', encoding='cp949') as f:
    reader = csv.reader(f)
    header = next(reader)

    row_count = 0
    matched = 0
    for row in reader:
        code = row[3]  # 집계구코드
        if code not in tract_map:
            continue

        hour = int(row[1])  # 시간대구분 (0~23)
        matched += 1

        # 남+여 합산 연령대별
        m = [safe_float(row[i]) for i in range(5, 19)]   # 남자 14개 연령대
        w = [safe_float(row[i]) for i in range(19, 33)]   # 여자 14개 연령대

        total = safe_float(row[4])
        # 0~9, 10~14, 15~19 → 0~19세
        age_0_19 = (m[0]+m[1]+m[2]) + (w[0]+w[1]+w[2])
        # 20~24, 25~29, 30~34, 35~39 → 20~39세
        age_20_39 = (m[3]+m[4]+m[5]+m[6]) + (w[3]+w[4]+w[5]+w[6])
        # 40~44, 45~49, 50~54, 55~59 → 40~59세
        age_40_59 = (m[7]+m[8]+m[9]+m[10]) + (w[7]+w[8]+w[9]+w[10])
        # 60~64, 65~69, 70+ → 60+
        age_60_plus = (m[11]+m[12]+m[13]) + (w[11]+w[12]+w[13])

        d = tract_hourly[code][hour]
        d['total'] += total
        d['age_0_19'] += age_0_19
        d['age_20_39'] += age_20_39
        d['age_40_59'] += age_40_59
        d['age_60_plus'] += age_60_plus
        row_count += 1

print(f'CSV 행: {row_count}, 매칭 집계구: {len(tract_hourly)}개')

# ─── 대표 시간대(14시, 오후 피크) 기준으로 집계구별 인구 확정 ──
PEAK_HOUR = 14
tract_pop = {}
for code, hourly in tract_hourly.items():
    if PEAK_HOUR in hourly:
        d = hourly[PEAK_HOUR]
    else:
        # 가장 가까운 시간대 사용
        d = next(iter(hourly.values()))
    tract_pop[code] = d

print(f'인구 데이터 있는 집계구: {len(tract_pop)}개')

# ─── Dot Density 점 사전 생성 ────────────────────────────────
# 1점 = 10명
DOT_PER = 10
AGE_GROUPS = ['age_0_19', 'age_20_39', 'age_40_59', 'age_60_plus']
AGE_COLORS = {
    'age_0_19': '#3366cc',
    'age_20_39': '#2ecc71',
    'age_40_59': '#f39c12',
    'age_60_plus': '#e74c3c',
}

print('점 생성 중...')

def random_point_in_polygon(polygon_coords):
    """폴리곤 내 랜덤 포인트 생성 (bounding box + point-in-polygon)"""
    # flatten to get all coords
    if isinstance(polygon_coords[0][0], list):
        # MultiPolygon or Polygon with holes
        ring = polygon_coords[0]
    else:
        ring = polygon_coords

    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    for _ in range(50):  # max attempts
        x = random.uniform(min_x, max_x)
        y = random.uniform(min_y, max_y)
        if point_in_ring(x, y, ring):
            return [round(x, 6), round(y, 6)]
    return [round((min_x+max_x)/2, 6), round((min_y+max_y)/2, 6)]

def point_in_ring(x, y, ring):
    n = len(ring)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside

dots = []  # [ { lat, lng, group } ]
for code, pop in tract_pop.items():
    feat = tract_map.get(code)
    if not feat:
        continue

    geom = feat['geometry']
    coords = geom['coordinates']
    if geom['type'] == 'MultiPolygon':
        poly_coords = coords[0][0]
    else:
        poly_coords = coords[0]

    for group in AGE_GROUPS:
        count = int(pop[group] / DOT_PER)
        for _ in range(count):
            pt = random_point_in_polygon(poly_coords)
            dots.append({
                'lat': pt[1],
                'lng': pt[0],
                'g': group,
            })

print(f'총 점 수: {len(dots)}')

# ─── 시간대별 총인구 (라인 차트용) ──────────────────────────
hourly_total = {}
for code, hourly in tract_hourly.items():
    for hour, d in hourly.items():
        if hour not in hourly_total:
            hourly_total[hour] = 0
        hourly_total[hour] += d['total']

hourly_chart = [{'hour': h, 'pop': round(hourly_total.get(h, 0))} for h in range(24)]

# ─── 최종 출력 ────────────────────────────────────────────────
result = {
    'dots': dots,
    'hourlyChart': hourly_chart,
    'tractPop': {code: pop for code, pop in tract_pop.items()},
    'dotPer': DOT_PER,
}

with open(OUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False)

file_mb = os.path.getsize(OUT_PATH) / (1024*1024)
print(f'\n=== 완료 ===')
print(f'점: {len(dots)}개 (1점={DOT_PER}명)')
print(f'시간대 데이터: {len(hourly_chart)}시간')
print(f'저장: {OUT_PATH} ({file_mb:.1f}MB)')
