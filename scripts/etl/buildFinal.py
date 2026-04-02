"""
GIS 건물통합정보 → 최종 GeoJSON (좌표 변환 + 필드 정리)
실행: python3 scripts/etl/buildFinal.py
"""
import json
import os
from pyproj import Transformer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GIS_PATH = os.path.join(BASE_DIR, '../../src/gis/data/junggu-buildings-gis.geojson')
OUT_PATH = os.path.join(BASE_DIR, '../../src/gis/data/junggu-buildings-final.geojson')

transformer = Transformer.from_crs('EPSG:5186', 'EPSG:4326', always_xy=True)

def transform_coords(coords):
    if isinstance(coords[0], (int, float)):
        lng, lat = transformer.transform(coords[0], coords[1])
        return [round(lng, 7), round(lat, 7)]
    return [transform_coords(c) for c in coords]

print('=== GIS 데이터 로딩 ===')
with open(GIS_PATH, 'r') as f:
    gis = json.load(f)
print(f'총 건물: {len(gis["features"])}건')

features = []
for i, feat in enumerate(gis['features']):
    if (i + 1) % 5000 == 0:
        print(f'  {i+1}/{len(gis["features"])} 처리 중...')

    p = feat['properties']

    try:
        new_coords = transform_coords(feat['geometry']['coordinates'])
    except Exception:
        continue

    props = {
        'pnu': str(p.get('A2', '')),
        'address': ((p.get('A4') or '') + ' ' + str(p.get('A5') or '')).strip(),
        'regType': p.get('A7', ''),          # 일반/집합
        'mainPurps': p.get('A9', ''),        # 주용도
        'strct': p.get('A11', ''),           # 구조
        'bcRat': float(p.get('A12') or 0),   # 건폐율
        'useAprDay': str(p.get('A13') or ''),# 사용승인일
        'totArea': float(p.get('A14') or 0), # 연면적
        'platArea': float(p.get('A15') or 0),# 대지면적
        'vlRat': float(p.get('A18') or 0),   # 용적률
        'grndFlrCnt': int(p.get('A26') or 0),# 지상층수
        'ugrndFlrCnt': int(p.get('A27') or 0),# 지하층수
        'bjdongCd': str(p.get('A3', ''))[-5:],
    }

    features.append({
        'type': 'Feature',
        'geometry': {
            'type': feat['geometry']['type'],
            'coordinates': new_coords,
        },
        'properties': props,
    })

result = {
    'type': 'FeatureCollection',
    'features': features,
}

vlrat_count = len([f for f in features if f['properties']['vlRat'] > 0])
bcrat_count = len([f for f in features if f['properties']['bcRat'] > 0])

print(f'\n=== 완료 ===')
print(f'총 건물: {len(features)}건')
print(f'용적률 있는 건물: {vlrat_count}건')
print(f'건폐율 있는 건물: {bcrat_count}건')
print(f'층수 있는 건물: {len([f for f in features if f["properties"]["grndFlrCnt"] > 0])}건')

with open(OUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False)

print(f'저장: {OUT_PATH}')
print(f'파일 크기: {os.path.getsize(OUT_PATH) / (1024*1024):.1f} MB')
