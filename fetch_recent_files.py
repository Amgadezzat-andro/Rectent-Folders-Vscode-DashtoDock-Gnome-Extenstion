import os, json
from xml.etree import ElementTree as ET
from urllib.parse import unquote

xbel = os.path.expanduser('~/.local/share/recently-used.xbel')
try:
    root = ET.parse(xbel).getroot()
    items = []
    for bm in root.findall('bookmark'):
        href = bm.get('href', '')
        if not href.startswith('file://'):
            continue
        visited = bm.get('visited') or bm.get('modified', '')
        title_el = bm.find('title')
        name = unquote((title_el.text if title_el is not None else None) or href.rstrip('/').split('/')[-1])
        items.append({'uri': href, 'name': name, 'visited': visited})
    items.sort(key=lambda x: x['visited'], reverse=True)
    print(json.dumps(items), end='')
except Exception:
    print('[]', end='')
