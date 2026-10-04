#!/usr/bin/env python3
"""Publish stamp for the portal: auto-update PAGE_LABEL in index.html / transfer/index.html, transfer.js ?v=, and version.json."""
import re, time, pathlib, datetime, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import autoupdate as au
ms = int(time.time() * 1000)
jst = datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone(datetime.timedelta(hours=9)))
v = jst.strftime('%Y%m%d%H%M%S'); label = jst.strftime('%Y-%m-%d %H:%M:%S')
for p in [ROOT / 'index.html', ROOT / 'transfer/index.html']:
    s = p.read_text(); s2 = re.sub(r'\?v=\d{14}', f'?v={v}', s)
    if s2 != s: p.write_text(s2)
    au.set_label(p, label)
au.write_json(ROOT / 'version.json', label, ms)
print(ms, v, label)
