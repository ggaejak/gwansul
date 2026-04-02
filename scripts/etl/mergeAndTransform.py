"""
GIS 건물 폴리곤 좌표 변환(EPSG:5186→4326) + 건축물대장 병합
실행: python3 scripts/etl/mergeAndTransform.py
"""
import json
import os
from pyproj import Transformer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GIS_PATH = os.path.join(BASE_DIR, '../../src/gis/data/junggu-buildings-gis.geojson')
RAW_PATH = os.path.join(BASE_DIR, '../../src/gis/data/junggu-buildings-raw.json')
RECAP_PATH = os.path.join(BASE_DIR, '../../src/gis/data/junggu-buildings-recap.json')
OUT_PATH = os.path.join(BASE_DIR, '../../src/gis/data/junggu-buildings-final.geojson')

# EPSG:5186 → EPSG:4326 변환기
transformer = Transformer.from_crs('EPSG:5186', 'EPSG:4326', always_xy=True)

def transform_coords(coords):
    """중첩 좌표 배열을 재귀적으로 변환"""
    if isinstance(coords[0], (int, float)):
        lng, lat = transformer.transform(coords[0], coords[1])
        return [round(lng, 7), round(lat, 7)]
    return [transform_coords(c) for c in coords]

print('=== 데이터 로딩 ===')
with open(GIS_PATH, 'r') as f:
    gis = json.load(f)
print(f'GIS 건물: {len(gis["features"])}건')

with open(RAW_PATH, 'r') as f:
    raw = json.load(f)
print(f'표제부: {len(raw)}건')

with open(RECAP_PATH, 'r') as f:
    recap = json.load(f)
print(f'총괄표제부: {len(recap)}건')

# 건축물대장 데이터를 PNU 기반 키로 매핑
# GIS A2 필드: PNU코드 (19자리) 예: "1114013400101880005"
# 건축물대장: sigunguCd(5) + bjdongCd(5) + platGbCd(1) + bun(4) + ji(4) = 19자리

def make_pnu(b):
    # 건축물대장: 0=대지, 1=산 → PNU 표준: 1=대지, 2=산
    plat = b.get('platGbCd', '0')
    plat_pnu = '1' if plat == '0' else '2' if plat == '1' else plat
    return f"{b['sigunguCd']}{b['bjdongCd']}{plat_pnu}{b['bun']}{b['ji']}"

# 표제부 매핑 (같은 PNU에 여러 동 → 층수 가장 높은 것)
raw_map = {}
for b in raw:
    pnu = make_pnu(b)
    if pnu not in raw_map or (b.get('grndFlrCnt', 0) or 0) > (raw_map[pnu].get('grndFlrCnt', 0) or 0):
        raw_map[pnu] = b

# 총괄표제부 매핑
recap_map = {}
for b in recap:
    pnu = make_pnu(b)
    recap_map[pnu] = b

print(f'\n표제부 고유 PNU: {len(raw_map)}건')
print(f'총괄표제부 고유 PNU: {len(recap_map)}건')

# GIS 필드 매핑
# A2: PNU, A4: 주소, A5: 번지, A8: 용도코드, A9: 용도명
# A11: 구조명, A14: 연면적, A26: 지상층, A27: 지하층

print('\n=== 좌표 변환 + 데이터 병합 ===')
features = []
matched = 0
unmatched = 0

for i, feat in enumerate(gis['features']):
    if (i + 1) % 2000 == 0:
        print(f'  {i+1}/{len(gis["features"])} 처리 중...')

    props = feat['properties']
    pnu = str(props.get('A2', ''))

    # 좌표 변환
    geom = feat['geometry']
    try:
        new_coords = transform_coords(geom['coordinates'])
    except Exception:
        continue

    # 건축물대장 매칭
    ledger = raw_map.get(pnu, {})
    recap_data = recap_map.get(pnu, {})

    vlRat = ledger.get('vlRat', 0) or recap_data.get('vlRat', 0) or 0
    bcRat = ledger.get('bcRat', 0) or recap_data.get('bcRat', 0) or 0

    if pnu in raw_map or pnu in recap_map:
        matched += 1
    else:
        unmatched += 1

    new_props = {
        'pnu': pnu,
        'address': (props.get('A4', '') or '') + ' ' + (str(props.get('A5', '')) or ''),
        'bldNm': (ledger.get('bldNm', '') or '').strip(),
        'mainPurps': props.get('A9', '') or ledger.get('mainPurpsCdNm', '') or '',
        'strct': props.get('A11', '') or ledger.get('strctCdNm', '') or '',
        'grndFlrCnt': ledger.get('grndFlrCnt', 0) or int(props.get('A26', 0) or 0),
        'ugrndFlrCnt': ledger.get('ugrndFlrCnt', 0) or int(props.get('A27', 0) or 0),
        'totArea': ledger.get('totArea', 0) or float(props.get('A14', 0) or 0),
        'vlRat': vlRat,
        'bcRat': bcRat,
        'platArea': ledger.get('platArea', 0) or recap_data.get('platArea', 0) or 0,
        'useAprDay': (ledger.get('useAprDay', '') or '').strip(),
        'bjdongCd': str(props.get('A3', ''))[-5:] if props.get('A3') else '',
    }

    features.append({
        'type': 'Feature',
        'geometry': {
            'type': geom['type'],
            'coordinates': new_coords,
        },
        'properties': new_props,
    })

result = {
    'type': 'FeatureCollection',
    'features': features,
}

print(f'\n=== 완료 ===')
print(f'총 건물: {len(features)}건')
print(f'건축물대장 매칭: {matched}건')
print(f'매칭 실패 (GIS만): {unmatched}건')
print(f'용적률 있는 건물: {len([f for f in features if f["properties"]["vlRat"] > 0])}건')

with open(OUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False)

file_size_mb = os.path.getsize(OUT_PATH) / (1024 * 1024)
print(f'저장: {OUT_PATH}')
print(f'파일 크기: {file_size_mb:.1f} MB')
