"""Deploy the sync worker with the API token in ../cloudflare-token.txt (line 1 token, line 2 account id).
Creates D1 database 'topscore-sync' (once), the table, uploads worker 'topscore-sync' and enables workers.dev."""
import json, os, urllib.request, uuid

here = os.path.dirname(os.path.abspath(__file__))
lines = [l.strip() for l in open(os.path.join(here, '..', 'cloudflare-token.txt'), encoding='utf-8-sig') if l.strip()]
TOKEN, ACCT = lines[0], lines[1]
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCT}'
NAME = 'topscore-sync'

def call(method, path, body=None, ctype='application/json', raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, data=data, method=method, headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': ctype})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        j = json.loads(e.read() or b'{}'); raise SystemExit(f'{method} {path} failed: {[x.get("message") for x in j.get("errors", [])]}')

# 1. database
dbs = call('GET', '/d1/database')['result']
db = next((d for d in dbs if d['name'] == NAME), None)
if not db:
    db = call('POST', '/d1/database', {'name': NAME})['result']
    print('created D1 database', db['uuid'])
dbid = db['uuid']
call('POST', f'/d1/database/{dbid}/query', {'sql': 'CREATE TABLE IF NOT EXISTS progress (code TEXT PRIMARY KEY, rev INTEGER NOT NULL, updated INTEGER NOT NULL, data TEXT NOT NULL)'})
print('table ready')

# 2. worker script (ES module) with the D1 binding
src = open(os.path.join(here, 'worker.js'), 'rb').read()
meta = {'main_module': 'worker.js', 'compatibility_date': '2026-10-01', 'bindings': [{'type': 'd1', 'name': 'DB', 'id': dbid}]}
b = uuid.uuid4().hex
parts = [
    f'--{b}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode() + json.dumps(meta).encode() + b'\r\n',
    f'--{b}\r\nContent-Disposition: form-data; name="worker.js"; filename="worker.js"\r\nContent-Type: application/javascript+module\r\n\r\n'.encode() + src + b'\r\n',
    f'--{b}--\r\n'.encode()]
call('PUT', f'/workers/scripts/{NAME}', raw=b''.join(parts), ctype=f'multipart/form-data; boundary={b}')
print('worker uploaded')

# 3. public workers.dev address
call('POST', f'/workers/scripts/{NAME}/subdomain', {'enabled': True, 'previews_enabled': False})
sub = call('GET', '/workers/subdomain')['result']['subdomain']
print(f'URL: https://{NAME}.{sub}.workers.dev')
