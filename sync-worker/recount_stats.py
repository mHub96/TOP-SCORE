"""Recount the leaderboard numbers (v3.6 rules) of every account from its saved progress.
Each question counts once: correct if it was ever answered right, otherwise incorrect.
XP is (questions ever answered right) x 35. Only the summary columns of the `stats` table change.
The `progress` table (each user's real progress) is only read, never written.

  python recount_stats.py [worker-name]           preview, changes nothing
  python recount_stats.py [worker-name] --apply   saves a backup of `stats` in ../pack-build/, then updates it
"""
import base64, datetime, gzip, json, os, sys, urllib.request

here = os.path.dirname(os.path.abspath(__file__))
lines = [l.strip() for l in open(os.path.join(here, '..', 'cloudflare-token.txt'), encoding='utf-8-sig') if l.strip()]
TOKEN, ACCT = lines[0], lines[1]
API = f'https://api.cloudflare.com/client/v4/accounts/{ACCT}'
args = [a for a in sys.argv[1:] if not a.startswith('--')]
NAME = args[0] if args else 'topscore-sync'
APPLY = '--apply' in sys.argv


def call(method, path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body else None, method=method,
                                 headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


db = next(d for d in call('GET', '/d1/database')['result'] if d['name'] == NAME)['uuid']


def q(sql, params=None):
    return call('POST', f'/d1/database/{db}/query', {'sql': sql, 'params': params or []})['result'][0]['results']


def week_key(ts):
    y, w, _ = datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).isocalendar()
    return f'{y}-W{w:02d}'


def recount(state, now):
    """same rules as Store.tally() + Sync.stats() in the app"""
    cards = state.get('cards', {})
    correct = sum(1 for c in cards.values() if (c.get('c') or 0) > 0)
    incorrect = sum(1 for c in cards.values() if not (c.get('c') or 0) > 0 and (c.get('w') or 0) > 0)
    seen = {}
    for l in state.get('log', []):
        s = seen.setdefault(l[1], {'t': l[0], 'r': 0, 'n': 0, 'g': 0})
        s['n'] += 1
        if l[2]:
            s['g'] += 1
            s['r'] = s['r'] or l[0]
    wk, wc, wi = week_key(now), 0, 0
    for i, s in seen.items():
        k = cards.get(i, {})
        if s['r'] and week_key(s['r']) == wk and s['g'] >= (k.get('c') or 0):
            wc += 1
        if not (k.get('c') or 0) > 0 and week_key(s['t']) == wk and s['n'] >= (k.get('w') or 0):
            wi += 1
    skips = state.get('skips') or {}
    def tier(c):
        return 0 if not c.get('reps') else 1 if not c.get('ok') else 2 if (c.get('s') or 0) < 4 else 3 if (c.get('s') or 0) < 21 else 4
    tiers = [tier(c) for i, c in cards.items() if not (skips.get(i) or 0) > 0]
    known, mastered = tiers.count(3), tiers.count(4)
    base = {}
    for d in sorted(state.get('daily', {})):
        if week_key(datetime.datetime.fromisoformat(d + 'T12:00:00+00:00').timestamp()) == wk:
            continue
        x = state['daily'][d]
        if x.get('m'):
            base['ts'] = x['m']
        base.update(x.get('mb') or {})
    had = sum((t[3] or 0) + (t[4] or 0) for t in base.values())
    return {'answered': correct + incorrect, 'correct': correct, 'xp': correct * 35, 'week_xp': wc * 35, 'mastered': known + mastered,
            'mastered_only': mastered, 'week_mastered': max(0, known + mastered - had), 'week': wk, 'week_answered': wc + wi, 'week_correct': wc}


old = q('SELECT * FROM stats')
if APPLY:
    out = os.path.join(here, '..', 'pack-build', f'stats-backup-{NAME}-before-v36.json')
    if not os.path.exists(out):      # a second run must not replace the original numbers
        json.dump(old, open(out, 'w', encoding='utf-8'))
    print('backup:', os.path.normpath(out))
now = datetime.datetime.now(datetime.timezone.utc).timestamp()
by = {r['user_id']: r for r in old}
for n, r in enumerate(q('SELECT user_id FROM progress')):
    uid = r['user_id']
    s = q('SELECT data FROM progress WHERE user_id = ?', [uid])[0]['data']
    blob = json.loads(s[2:]) if s.startswith('j:') else json.loads(gzip.decompress(base64.b64decode(s[2:])))
    new = recount(blob['state'], now)
    o = by.get(uid, {})
    print(f"user#{n}: answered {o.get('answered')} -> {new['answered']} | correct {o.get('correct')} -> {new['correct']} | "
          f"incorrect {(o.get('answered') or 0) - (o.get('correct') or 0)} -> {new['answered'] - new['correct']} | "
          f"XP {o.get('xp')} -> {new['xp']} (week {new['week_xp']}) | known+mastered {new['mastered']} (+{new['week_mastered']} this week, {new['mastered_only']} mastered)")
    if APPLY and uid in by:
        cols = list(new)
        q('UPDATE stats SET ' + ', '.join(c + ' = ?' for c in cols) + ' WHERE user_id = ?', [new[c] for c in cols] + [uid])
print('applied' if APPLY else 'preview only (add --apply to update)')
