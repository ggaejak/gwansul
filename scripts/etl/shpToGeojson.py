"""
SHP → GeoJSON 변환 + 서울 중구만 필터링
실행: python3 scripts/etl/shpToGeojson.py
"""
import shapefile
import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SHP_PATH = os.path.join(BASE_DIR, '../../src/gis/data/AL_D010_11_20260309.shp')
OUT_PATH = os.path.join(BASE_DIR, '../../src/gis/data/junggu-buildings-gis.geojson')

print('=== SHP 파일 로딩 중... ===')
sf = shapefile.Reader(SHP_PATH, encoding='euc-kr')

fields = [f[0] for f in sf.fields[1:]]  # 첫 번째는 DeletionFlag
print(f'필드: {fields}')
print(f'총 레코드 수: {len(sf)}')

# 시군구코드(SGG_CD) 또는 주소에서 중구(11140) 필터링
# 필드명 확인 후 적절한 필터 적용
sample = sf.record(0)
print(f'샘플 레코드: {dict(zip(fields, sample))}')

# 중구 코드: 11140
features = []
filtered = 0

for i, (shape, rec) in enumerate(zip(sf.shapes(), sf.records())):
    props = dict(zip(fields, rec))

    # 시군구코드 필드 찾기 (SGG_CD, SIGUNGU_CD, BJD_CD 앞 5자리 등)
    sgg = ''
    for key in ['SGG_CD', 'SIGUNGU_CD', 'ADM_CD']:
        if key in props:
            sgg = str(props[key])[:5]
            break

    # BJD_CD (법정동코드)가 있으면 앞 5자리가 시군구코드
    if not sgg and 'BJD_CD' in props:
        sgg = str(props['BJD_CD'])[:5]

    # A16 같은 필드에 주소가 있을 수 있음
    if not sgg:
        for key, val in props.items():
            if isinstance(val, str) and '중구' in val:
                sgg = '11140'
                break

    if sgg != '11140':
        continue

    filtered += 1

    # Shape → GeoJSON geometry
    geom = shape.__geo_interface__

    import datetime
    clean_props = {}
    for k, v in props.items():
        if isinstance(v, bytes):
            v = v.decode('euc-kr', errors='replace')
        elif isinstance(v, (datetime.date, datetime.datetime)):
            v = v.isoformat()
        clean_props[k] = v

    features.append({
        'type': 'Feature',
        'geometry': geom,
        'properties': clean_props
    })

    if filtered % 500 == 0:
        print(f'  중구 건물 {filtered}건 추출...')

geojson = {
    'type': 'FeatureCollection',
    'features': features
}

print(f'\n=== 완료: 중구 건물 {len(features)}건 추출 ===')

with open(OUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(geojson, f, ensure_ascii=False)

print(f'저장: {OUT_PATH}')
file_size_mb = os.path.getsize(OUT_PATH) / (1024 * 1024)
print(f'파일 크기: {file_size_mb:.1f} MB')
