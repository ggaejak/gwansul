"""
상권 데이터 전처리: 영역 + 점포 + 매출 → commerce.json
실행: python3 scripts/etl/buildCommerce.py
"""
import json
import csv
import os
import math
from collections import defaultdict
from pyproj import Transformer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, '../../src/gis/data')
OUT_PATH = os.path.join(DATA_DIR, 'junggu-commerce.json')

transformer = Transformer.from_crs('EPSG:5181', 'EPSG:4326', always_xy=True)

# ─── 1. 영역-상권 (중구만) ────────────────────────────────────
areas = []
with open(os.path.join(DATA_DIR, '서울시 상권분석서비스(영역-상권).csv'), 'r', encoding='cp949') as f:
    for r in csv.DictReader(f):
        if r['자치구_코드_명'] != '중구':
            continue
        x = float(r['엑스좌표_값'])
        y = float(r['와이좌표_값'])
        lng, lat = transformer.transform(x, y)
        area_sqm = float(r['영역_면적'] or 0)
        areas.append({
            'code': r['상권_코드'],
            'name': r['상권_코드_명'],
            'type': r['상권_구분_코드_명'],
            'typeCode': r['상권_구분_코드'],
            'dong': r['행정동_코드_명'],
            'lat': round(lat, 6),
            'lng': round(lng, 6),
            'area': area_sqm,
            'radius': round(math.sqrt(area_sqm / math.pi)),  # 원 반지름 근사
        })

print(f'중구 상권: {len(areas)}개')
code_set = set(a['code'] for a in areas)

# ─── 2. 점포-상권 (최신 분기, 중구 상권만) ─────────────────────
stores_by_code = defaultdict(lambda: {
    'total': 0, 'open': 0, 'close': 0, 'franchise': 0,
    'categories': defaultdict(int)
})

latest_quarter = ''
with open(os.path.join(DATA_DIR, '서울시 상권분석서비스(점포-상권).csv'), 'r', encoding='cp949') as f:
    for r in csv.DictReader(f):
        if r['상권_코드'] not in code_set:
            continue
        q = r['기준_년분기_코드']
        if q > latest_quarter:
            latest_quarter = q

print(f'최신 분기: {latest_quarter}')

with open(os.path.join(DATA_DIR, '서울시 상권분석서비스(점포-상권).csv'), 'r', encoding='cp949') as f:
    for r in csv.DictReader(f):
        if r['상권_코드'] not in code_set:
            continue
        if r['기준_년분기_코드'] != latest_quarter:
            continue

        code = r['상권_코드']
        count = int(r['점포_수'] or 0)
        d = stores_by_code[code]
        d['total'] += count
        d['open'] += int(r['개업_점포_수'] or 0)
        d['close'] += int(r['폐업_점포_수'] or 0)
        d['franchise'] += int(r['프랜차이즈_점포_수'] or 0)

        cat = r['서비스_업종_코드_명']
        d['categories'][cat] += count

print(f'점포 데이터 상권: {len(stores_by_code)}개')

# ─── 3. 추정매출-상권 (최신 분기, 중구 상권만) ────────────────
sales_by_code = defaultdict(lambda: {'total': 0, 'weekday': 0, 'weekend': 0})

with open(os.path.join(DATA_DIR, '서울시 상권분석서비스(추정매출-상권).csv'), 'r', encoding='cp949') as f:
    for r in csv.DictReader(f):
        if r['상권_코드'] not in code_set:
            continue
        if r['기준_년분기_코드'] != latest_quarter:
            continue

        code = r['상권_코드']
        d = sales_by_code[code]
        d['total'] += int(r['당월_매출_금액'] or 0)
        d['weekday'] += int(r['주중_매출_금액'] or 0)
        d['weekend'] += int(r['주말_매출_금액'] or 0)

print(f'매출 데이터 상권: {len(sales_by_code)}개')

# ─── 4. 합치기 ────────────────────────────────────────────────
for a in areas:
    code = a['code']
    st = stores_by_code.get(code, {})
    a['stores'] = st.get('total', 0)
    a['openStores'] = st.get('open', 0)
    a['closeStores'] = st.get('close', 0)
    a['franchise'] = st.get('franchise', 0)
    # 상위 5개 업종
    cats = st.get('categories', {})
    a['topCategories'] = sorted(cats.items(), key=lambda x: -x[1])[:8]

    sl = sales_by_code.get(code, {})
    a['salesTotal'] = sl.get('total', 0)
    a['salesWeekday'] = sl.get('weekday', 0)
    a['salesWeekend'] = sl.get('weekend', 0)

result = {
    'areas': areas,
    'quarter': latest_quarter,
}

with open(OUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

file_mb = os.path.getsize(OUT_PATH) / (1024*1024)
print(f'\n=== 완료 ===')
print(f'상권: {len(areas)}개')
print(f'분기: {latest_quarter}')
print(f'저장: {OUT_PATH} ({file_mb:.2f}MB)')
