"""Deploy the TOP SCORE server with the API token in ../cloudflare-token.txt (line 1 token, line 2 account id).
Creates/updates D1 'topscore-sync' tables, uploads worker 'topscore-sync' with the D1 binding and the ADMIN_KEY secret
(stored locally in ../sync-worker/admin-key.txt, gitignored), and enables workers.dev."""
import json, os, sys, urllib.request, uuid, secrets

here = os.path.dirname(os.path.abspath(__file__))
lines = [l.strip() for l in open(os.path.join(here, '..', 'cloudflare-token.txt'), encoding='utf-8-sig') if l.strip()]
TOKEN, ACCT = lines[0], lines[1]
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCT}'
NAME = sys.argv[1] if len(sys.argv) > 1 else 'topscore-sync'      # 'topscore-test' = separate server + database for automated tests
KEYF = os.path.join(here, 'admin-key.txt')
if not os.path.exists(KEYF): open(KEYF, 'w').write(secrets.token_hex(24))
ADMIN_KEY = open(KEYF).read().strip()
VAPID = json.load(open(os.path.join(here, 'vapid.json')))     # web-push keys (gitignored)

def call(method, path, body=None, ctype='application/json', raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, data=data, method=method, headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': ctype})
    try:
        with urllib.request.urlopen(req, timeout=90) as r: return json.load(r)
    except urllib.error.HTTPError as e:
        j = json.loads(e.read() or b'{}'); raise SystemExit(f'{method} {path} failed: {[x.get("message") for x in j.get("errors", [])]}')

dbs = call('GET', '/d1/database')['result']
db = next((d for d in dbs if d['name'] == NAME), None) or call('POST', '/d1/database', {'name': NAME})['result']
dbid = db['uuid']
SCHEMA = [
    'CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, display TEXT, salt TEXT, pass TEXT, role TEXT, status TEXT, lb INTEGER DEFAULT 1, pw_allowed INTEGER DEFAULT 0, pw_request INTEGER DEFAULT 0, books TEXT, created INTEGER, seen INTEGER)',
    'CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER)',
    'DROP TABLE IF EXISTS progress_codes',
    'CREATE TABLE IF NOT EXISTS progress2 (user_id INTEGER PRIMARY KEY, rev INTEGER NOT NULL, updated INTEGER NOT NULL, data TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS stats (user_id INTEGER PRIMARY KEY, xp INTEGER, answered INTEGER, correct INTEGER, mastered INTEGER, streak INTEGER, best_streak INTEGER, week TEXT, week_answered INTEGER, week_correct INTEGER, week_xp INTEGER, updated INTEGER)',
    'CREATE TABLE IF NOT EXISTS challenges (id INTEGER PRIMARY KEY AUTOINCREMENT, from_id INTEGER, to_id INTEGER, mode TEXT, title TEXT, ch_key TEXT, ids TEXT, status TEXT, created INTEGER, start_at INTEGER, ended INTEGER, from_ready INTEGER DEFAULT 0, to_ready INTEGER DEFAULT 0, from_score INTEGER DEFAULT 0, to_score INTEGER DEFAULT 0, from_correct INTEGER DEFAULT 0, to_correct INTEGER DEFAULT 0, from_answered INTEGER DEFAULT 0, to_answered INTEGER DEFAULT 0, from_done INTEGER DEFAULT 0, to_done INTEGER DEFAULT 0, from_ms INTEGER DEFAULT 0, to_ms INTEGER DEFAULT 0)',
    'CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, meta TEXT, size INTEGER, chunks INTEGER, visible INTEGER DEFAULT 1, updated INTEGER)',
    'CREATE TABLE IF NOT EXISTS pack_chunks (book_id TEXT, idx INTEGER, data BLOB, PRIMARY KEY (book_id, idx))',
    'CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, user_id INTEGER, keys TEXT, created INTEGER)',
    'CREATE TABLE IF NOT EXISTS notifs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, body TEXT, url TEXT, created INTEGER, delivered INTEGER DEFAULT 0)',
    'CREATE TABLE IF NOT EXISTS exams (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, host_id INTEGER, title TEXT, cfg TEXT, keys TEXT, status TEXT, cur INTEGER DEFAULT -1, q_start INTEGER, all_at INTEGER, next_code TEXT, created INTEGER, started INTEGER, ended INTEGER)',
    'CREATE TABLE IF NOT EXISTS exam_players (id INTEGER PRIMARY KEY AUTOINCREMENT, exam_id INTEGER, token TEXT UNIQUE, name TEXT, user_id INTEGER, status TEXT, reason TEXT, joined INTEGER, ended INTEGER, seen INTEGER)',
    'CREATE INDEX IF NOT EXISTS exam_players_exam ON exam_players (exam_id)',
    'CREATE TABLE IF NOT EXISTS exam_answers (exam_id INTEGER, player_id INTEGER, q INTEGER, choice TEXT, ms INTEGER, at INTEGER, PRIMARY KEY (exam_id, player_id, q))',
    'CREATE INDEX IF NOT EXISTS exam_answers_q ON exam_answers (exam_id, q)',
]
for sql in SCHEMA: call('POST', f'/d1/database/{dbid}/query', {'sql': sql})
# the old code-based sync table had user codes as keys; the account system uses user ids
cols = call('POST', f'/d1/database/{dbid}/query', {'sql': "SELECT name FROM pragma_table_info('progress')"})['result'][0]['results']
if any(c['name'] == 'code' for c in cols):
    call('POST', f'/d1/database/{dbid}/query', {'sql': 'DROP TABLE progress'})
    call('POST', f'/d1/database/{dbid}/query', {'sql': 'ALTER TABLE progress2 RENAME TO progress'})
else:
    call('POST', f'/d1/database/{dbid}/query', {'sql': 'CREATE TABLE IF NOT EXISTS progress (user_id INTEGER PRIMARY KEY, rev INTEGER NOT NULL, updated INTEGER NOT NULL, data TEXT NOT NULL)'})
    call('POST', f'/d1/database/{dbid}/query', {'sql': 'DROP TABLE IF EXISTS progress2'})
ucols = [c['name'] for c in call('POST', f'/d1/database/{dbid}/query', {'sql': "SELECT name FROM pragma_table_info('users')"})['result'][0]['results']]
if 'exam_host' not in ucols:     # owner-granted right to host exam rooms
    call('POST', f'/d1/database/{dbid}/query', {'sql': 'ALTER TABLE users ADD COLUMN exam_host INTEGER DEFAULT 0'})
scols = [c['name'] for c in call('POST', f'/d1/database/{dbid}/query', {'sql': "SELECT name FROM pragma_table_info('stats')"})['result'][0]['results']]
for col in ('mastered_only', 'week_mastered'):      # leaderboard: known and mastered apart, weekly gain
    if col not in scols:
        call('POST', f'/d1/database/{dbid}/query', {'sql': f'ALTER TABLE stats ADD COLUMN {col} INTEGER DEFAULT 0'})
print('schema ready')

src = open(os.path.join(here, 'worker.js'), 'rb').read()
meta = {'main_module': 'worker.js', 'compatibility_date': '2026-10-01',
        'bindings': [{'type': 'd1', 'name': 'DB', 'id': dbid}, {'type': 'secret_text', 'name': 'ADMIN_KEY', 'text': ADMIN_KEY},
                     {'type': 'secret_text', 'name': 'VAPID_PRIVATE_JWK', 'text': json.dumps(VAPID['privateJwk'])},
                     {'type': 'plain_text', 'name': 'VAPID_PUBLIC', 'text': VAPID['publicKey']}]}
b = uuid.uuid4().hex
parts = [
    f'--{b}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode() + json.dumps(meta).encode() + b'\r\n',
    f'--{b}\r\nContent-Disposition: form-data; name="worker.js"; filename="worker.js"\r\nContent-Type: application/javascript+module\r\n\r\n'.encode() + src + b'\r\n',
    f'--{b}--\r\n'.encode()]
call('PUT', f'/workers/scripts/{NAME}', raw=b''.join(parts), ctype=f'multipart/form-data; boundary={b}')
call('POST', f'/workers/scripts/{NAME}/subdomain', {'enabled': True, 'previews_enabled': False})
sub = call('GET', '/workers/subdomain')['result']['subdomain']
print(f'URL: https://{NAME}.{sub}.workers.dev')
