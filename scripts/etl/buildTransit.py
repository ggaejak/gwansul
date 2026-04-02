"""
대중교통 데이터 전처리: 중구 근처 버스정류장 + 지하철역 좌표 수집
실행: python3 scripts/etl/buildTransit.py
"""
import json
import os
import urllib.request
import urllib.parse
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# API 키 읽기
env_path = os.path.join(BASE_DIR, '../../.env.local')
with open(env_path) as f:
    env = f.read()
KAKAO_KEY = [l.split('=',1)[1].strip() for l in env.splitlines() if l.startswith('VITE_KAKAO_REST_API_KEY')][0]

# 중구 근처 범위 (넓게 잡아서 도보 가능 범위의 역/정류장 포함)
LAT_MIN, LAT_MAX = 37.53, 37.59
LNG_MIN, LNG_MAX = 126.95, 127.04

# ─── 버스 정류장 ──────────────────────────────────────────────
bus_path = os.path.join(BASE_DIR, '../../src/gis/data/서울시 버스정류소 위치정보.json')
with open(bus_path, 'r') as f:
    bus_data = json.load(f)

bus_stops = []
for s in bus_data['DATA']:
    lat = float(s.get('ycrd', 0) or 0)
    lng = float(s.get('xcrd', 0) or 0)
    if LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX:
        bus_stops.append({
            'name': s['stops_nm'],
            'lat': lat,
            'lng': lng,
            'stopNo': s.get('stops_no', ''),
            'nodeId': s.get('node_id', ''),
        })

print(f'버스 정류장: 전체 {len(bus_data["DATA"])} → 중구 근처 {len(bus_stops)}개')

# ─── 지하철역 (카카오 지오코딩) ────────────────────────────────
subway_path = os.path.join(BASE_DIR, '../../src/gis/data/서울교통공사_노선별 지하철역 정보.json')
with open(subway_path, 'r') as f:
    subway_data = json.load(f)

# 1~9호선만 (중구 근처에 올 수 있는 호선)
TARGET_LINES = ['01호선', '02호선', '03호선', '04호선', '05호선', '06호선', '07호선', '08호선', '09호선']
LINE_COLORS = {
    '01호선': '#0052A4', '02호선': '#009B3E', '03호선': '#EF7C1C',
    '04호선': '#00A5DE', '05호선': '#996CAC', '06호선': '#CD7C2F',
    '07호선': '#747F00', '08호선': '#E6186C', '09호선': '#BDB092',
}

filtered_stations = [s for s in subway_data['DATA'] if s['line_num'] in TARGET_LINES]
# 중복 제거 (같은 역이 여러 호선에 있을 수 있음)
unique_names = set()
to_geocode = []
for s in filtered_stations:
    key = s['station_nm']
    if key not in unique_names:
        unique_names.add(key)
        to_geocode.append(s)

print(f'지하철역: 전체 {len(subway_data["DATA"])} → 1~9호선 고유역 {len(to_geocode)}개')
print('카카오 지오코딩 시작...')

def kakao_geocode(query):
    url = 'https://dapi.kakao.com/v2/local/search/keyword.json?' + urllib.parse.urlencode({'query': query})
    req = urllib.request.Request(url, headers={'Authorization': f'KakaoAK {KAKAO_KEY}'})
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            data = json.loads(res.read())
            if data['documents']:
                d = data['documents'][0]
                return float(d['y']), float(d['x'])
    except:
        pass
    return None, None

station_coords = {}
for i, s in enumerate(to_geocode):
    name = s['station_nm']
    if (i + 1) % 20 == 0:
        print(f'  [{i+1}/{len(to_geocode)}] 지오코딩 중...')

    lat, lng = kakao_geocode(f'{name}역 지하철')
    if lat and LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX:
        station_coords[name] = {'lat': lat, 'lng': lng}

    time.sleep(0.1)

print(f'중구 근처 지하철역: {len(station_coords)}개')

# 호선별 역 리스트 구성 (station_cd 순으로 정렬하여 노선 순서)
subway_lines = {}
for s in filtered_stations:
    name = s['station_nm']
    if name not in station_coords:
        continue
    line = s['line_num']
    if line not in subway_lines:
        subway_lines[line] = []
    subway_lines[line].append({
        'name': name,
        'lat': station_coords[name]['lat'],
        'lng': station_coords[name]['lng'],
        'code': s['station_cd'],
        'frCode': s.get('fr_code', ''),
    })

# station_cd 순 정렬 (노선 순서)
for line in subway_lines:
    subway_lines[line].sort(key=lambda x: x['code'])

# 최종 출력
result = {
    'busStops': bus_stops,
    'subwayLines': {
        line: {
            'color': LINE_COLORS.get(line, '#888'),
            'stations': stations
        }
        for line, stations in subway_lines.items()
    }
}

out_path = os.path.join(BASE_DIR, '../../src/gis/data/junggu-transit.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print(f'\n=== 완료 ===')
print(f'버스 정류장: {len(bus_stops)}개')
print(f'지하철 호선: {list(subway_lines.keys())}')
for line, data in result['subwayLines'].items():
    print(f'  {line}: {len(data["stations"])}개 역')
print(f'저장: {out_path}')
