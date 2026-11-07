"""Upload the owner's book packs (../packs/*.tspack) to the server library in 1 MB chunks."""
import json, os, struct, sys, urllib.request, urllib.parse, glob
here = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get('TS_SERVER', 'https://topscore-sync.topscore-c067b3.workers.dev') + '/api/admin/pack/'
KEY = open(os.path.join(here, 'admin-key.txt')).read().strip()
files = sys.argv[1:] or sorted(glob.glob(os.path.join(here, '..', 'packs', '*.tspack')))
for f in files:
    raw = open(f, 'rb').read()
    n = struct.unpack('<I', raw[8:12])[0]; h = json.loads(raw[12:12 + n])
    book = h['book']; bid = book['id']
    meta = {k: book.get(k) for k in ('id', 'title', 'short', 'authors', 'year', 'color', 'icon', 'order')}
    meta['counts'] = h.get('counts'); meta['built'] = h.get('built'); meta['file'] = os.path.basename(f)
    C = 1_000_000; chunks = [raw[i:i + C] for i in range(0, len(raw), C)]
    for i, c in enumerate(chunks):
        q = '?meta=' + urllib.parse.quote(json.dumps(meta)) if i == 0 else ''
        req = urllib.request.Request(f'{URL}{bid}/{i}/{len(chunks)}{q}', data=c, method='PUT', headers={'X-Admin-Key': KEY, 'Content-Type': 'application/octet-stream', 'User-Agent': 'topscore-uploader/1.0'})
        with urllib.request.urlopen(req, timeout=120) as r: json.load(r)
    print(f'{bid}: {len(raw) / 1048576:.1f} MB in {len(chunks)} chunks')
