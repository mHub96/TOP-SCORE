/* TOP SCORE server — Cloudflare Worker + D1.
   Accounts (owner approves sign-ups), per-account progress sync, the owner's private book library,
   user-vs-user challenges, leaderboard.
   Passwords: the browser stretches the password with PBKDF2 (200k rounds, salt = app + username);
   the server stores SHA-256(per-user salt + that). Sessions: random tokens, stored hashed. */
const ORIGINS = ['https://mhub96.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'];
const MAX_PROGRESS = 1_800_000;
const CHUNK = 1_000_000;

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Key',
    'Access-Control-Max-Age': '86400', 'Vary': 'Origin'
  };
}
const J = (req, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) } });
const ERR = (req, msg, status = 400) => J(req, { error: msg }, status);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const rnd = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const now = () => Date.now();
const userOut = u => u && ({ id: u.id, username: u.username, display: u.display, role: u.role, status: u.status, lb: !!u.lb, pwAllowed: !!u.pw_allowed, pwRequest: !!u.pw_request, books: JSON.parse(u.books || '[]'), created: u.created, seen: u.seen });
async function body(req) { try { return await req.json(); } catch (e) { return {}; } }

async function auth(req, env) {
  const h = req.headers.get('Authorization') || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!t) return null;
  const s = await env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').bind(await sha(t)).first();
  if (!s || s.status !== 'active') return null;
  if (now() - (s.seen || 0) > 60000) await env.DB.prepare('UPDATE users SET seen = ? WHERE id = ?').bind(now(), s.id).run();
  return s;
}
const isOwner = u => u && u.role === 'owner';
const CH_SQL = `SELECT c.*, a.display AS from_name, b.display AS to_name FROM challenges c JOIN users a ON a.id = c.from_id JOIN users b ON b.id = c.to_id`;

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url), p = url.pathname, M = req.method;
    try {
      if (p === '/' || p === '/api/health') return J(req, { ok: true, service: 'topscore' });

      // ----- accounts -----
      if (p === '/api/signup' && M === 'POST') {
        const b = await body(req);
        const username = String(b.username || '').trim().toLowerCase();
        const display = String(b.display || username).trim().slice(0, 40) || username;
        if (!/^[a-z0-9._-]{3,24}$/.test(username)) return ERR(req, 'Username: 3–24 letters, numbers, dot, dash or underscore.');
        if (!/^[0-9a-f]{64}$/.test(b.pw || '')) return ERR(req, 'Bad password data.');
        if (await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()) return ERR(req, 'That username is taken.');
        const first = !(await env.DB.prepare('SELECT 1 FROM users LIMIT 1').first());
        const salt = rnd(16);
        await env.DB.prepare('INSERT INTO users (username, display, salt, pass, role, status, lb, created) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
          .bind(username, display, salt, await sha(salt + b.pw), first ? 'owner' : 'user', first ? 'active' : 'pending', now()).run();
        return J(req, { ok: true, owner: first, pending: !first });
      }
      if (p === '/api/login' && M === 'POST') {
        const b = await body(req);
        const u = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(String(b.username || '').trim().toLowerCase()).first();
        if (!u || u.pass !== await sha(u.salt + (b.pw || ''))) return ERR(req, 'Wrong username or password.', 401);
        if (u.status === 'pending') return ERR(req, 'Your account is waiting for the owner’s approval.', 403);
        if (u.status !== 'active') return ERR(req, 'This account is not active.', 403);
        const token = rnd(32);
        await env.DB.prepare('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)').bind(await sha(token), u.id, now()).run();
        return J(req, { token, user: userOut(u) });
      }
      if (p === '/api/logout' && M === 'POST') {
        const t = (req.headers.get('Authorization') || '').slice(7);
        if (t) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(await sha(t)).run();
        return J(req, { ok: true });
      }
      if (p.startsWith('/api/admin/pack/')) {          // upload script (admin key), used to put the owner's packs on the server
        if (!env.ADMIN_KEY || req.headers.get('X-Admin-Key') !== env.ADMIN_KEY) return ERR(req, 'forbidden', 403);
        return packUpload(req, env, p);
      }
      const me = await auth(req, env);
      if (!me) return ERR(req, 'Please log in.', 401);

      if (p === '/api/me' && M === 'GET') return J(req, { user: userOut(me) });
      if (p === '/api/me' && M === 'POST') {
        const b = await body(req);
        if (b.display !== undefined) await env.DB.prepare('UPDATE users SET display = ? WHERE id = ?').bind(String(b.display).trim().slice(0, 40) || me.username, me.id).run();
        if (b.lb !== undefined) await env.DB.prepare('UPDATE users SET lb = ? WHERE id = ?').bind(b.lb ? 1 : 0, me.id).run();
        if (Array.isArray(b.books)) await env.DB.prepare('UPDATE users SET books = ? WHERE id = ?').bind(JSON.stringify(b.books.slice(0, 40).map(String)), me.id).run();
        return J(req, { user: userOut(await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me.id).first()) });
      }
      if (p === '/api/password' && M === 'POST') {
        const b = await body(req);
        if (!isOwner(me) && !me.pw_allowed) return ERR(req, 'Password changes need the owner’s approval first. Use “Ask the owner”.', 403);
        if (me.pass !== await sha(me.salt + (b.old || ''))) return ERR(req, 'Your current password is wrong.', 401);
        if (!/^[0-9a-f]{64}$/.test(b.pw || '')) return ERR(req, 'Bad password data.');
        const salt = rnd(16);
        await env.DB.prepare('UPDATE users SET salt = ?, pass = ?, pw_allowed = 0, pw_request = 0 WHERE id = ?').bind(salt, await sha(salt + b.pw), me.id).run();
        return J(req, { ok: true });
      }
      if (p === '/api/password/request' && M === 'POST') {
        await env.DB.prepare('UPDATE users SET pw_request = 1 WHERE id = ?').bind(me.id).run();
        return J(req, { ok: true });
      }

      // ----- progress -----
      if (p === '/api/progress' && M === 'GET') {
        const row = await env.DB.prepare('SELECT rev, updated, data FROM progress WHERE user_id = ?').bind(me.id).first();
        return J(req, row || { rev: 0, updated: 0, data: null });
      }
      if (p === '/api/progress' && M === 'PUT') {
        const text = await req.text();
        if (text.length > MAX_PROGRESS + 4000) return ERR(req, 'too large', 413);
        let b; try { b = JSON.parse(text); } catch (e) { return ERR(req, 'bad json'); }
        if (typeof b.data !== 'string' || b.data.length > MAX_PROGRESS) return ERR(req, 'bad data');
        const base = Number(b.baseRev) || 0, t = now();
        if (b.stats) await saveStats(env, me.id, b.stats);
        const cur = await env.DB.prepare('SELECT rev, updated, data FROM progress WHERE user_id = ?').bind(me.id).first();
        if (!cur) {
          await env.DB.prepare('INSERT INTO progress (user_id, rev, updated, data) VALUES (?, 1, ?, ?)').bind(me.id, t, b.data).run();
          return J(req, { rev: 1, updated: t });
        }
        if (cur.rev !== base) return J(req, { conflict: true, ...cur });
        const r = await env.DB.prepare('UPDATE progress SET rev = rev + 1, updated = ?, data = ? WHERE user_id = ? AND rev = ?').bind(t, b.data, me.id, base).run();
        if (!r.meta.changes) return J(req, { conflict: true, ...(await env.DB.prepare('SELECT rev, updated, data FROM progress WHERE user_id = ?').bind(me.id).first()) });
        return J(req, { rev: base + 1, updated: t });
      }

      // ----- leaderboard -----
      if (p === '/api/leaderboard' && M === 'GET') {
        const wk = weekKey();
        const rows = await env.DB.prepare(`SELECT u.id, u.display, s.xp, s.answered, s.correct, s.mastered, s.streak, s.best_streak, s.week, s.week_answered, s.week_correct, s.week_xp, s.updated
          FROM users u JOIN stats s ON s.user_id = u.id WHERE u.status = 'active' AND (u.lb = 1 OR u.id = ?)`).bind(me.id).all();
        return J(req, { week: wk, me: me.id, rows: rows.results.map(r => Object.assign(r, r.week === wk ? {} : { week_answered: 0, week_correct: 0, week_xp: 0 })) });
      }
      if (p === '/api/users' && M === 'GET') {
        const rows = await env.DB.prepare("SELECT id, username, display, books, seen FROM users WHERE status = 'active' AND id != ? ORDER BY display").bind(me.id).all();
        return J(req, { users: rows.results.map(r => ({ id: r.id, username: r.username, display: r.display, books: JSON.parse(r.books || '[]'), online: now() - (r.seen || 0) < 180000 })) });
      }
      if (p === '/api/inbox' && M === 'GET') {
        const ch = await env.DB.prepare(CH_SQL + ` WHERE (c.from_id = ? OR c.to_id = ?) AND c.status IN ('pending','accepted','running') AND c.created > ?`).bind(me.id, me.id, now() - 86400000).all();
        const out = { challenges: ch.results.map(chOut) };
        if (isOwner(me)) {
          out.pendingUsers = (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'").first()).n;
          out.pwRequests = (await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE pw_request = 1').first()).n;
        }
        return J(req, out);
      }

      // ----- challenges -----
      if (p === '/api/challenges' && M === 'POST') {
        const b = await body(req);
        const to = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").bind(Number(b.to)).first();
        if (!to || to.id === me.id) return ERR(req, 'Choose another user.');
        const mode = String(b.mode || 'challenge');
        if (!['challenge', 'shuffle', 'confidence', 'blitz', 'survival', 'boss'].includes(mode)) return ERR(req, 'Unsupported mode.');
        if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 400) return ERR(req, 'No questions.');
        const r = await env.DB.prepare(`INSERT INTO challenges (from_id, to_id, mode, title, ch_key, ids, status, created) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`)
          .bind(me.id, to.id, mode, String(b.title || '').slice(0, 160), String(b.ch || ''), JSON.stringify(b.ids.map(String)), now()).run();
        return J(req, { id: r.meta.last_row_id });
      }
      if (p === '/api/challenges' && M === 'GET') {
        const rows = await env.DB.prepare(CH_SQL + ` WHERE c.from_id = ? OR c.to_id = ? ORDER BY c.created DESC LIMIT 40`).bind(me.id, me.id).all();
        return J(req, { challenges: rows.results.map(chOut) });
      }
      const cm = p.match(/^\/api\/challenges\/(\d+)(?:\/(\w+))?$/);
      if (cm) {
        const id = Number(cm[1]), act = cm[2] || '';
        const c = await env.DB.prepare(CH_SQL + ' WHERE c.id = ?').bind(id).first();
        if (!c || (c.from_id !== me.id && c.to_id !== me.id)) return ERR(req, 'Challenge not found.', 404);
        const side = c.from_id === me.id ? 'from' : 'to';
        if (M === 'GET') return J(req, { challenge: chOut(c), side });
        const b = await body(req);
        if (act === 'accept' && side === 'to' && c.status === 'pending') await env.DB.prepare("UPDATE challenges SET status = 'accepted' WHERE id = ?").bind(id).run();
        else if (act === 'decline' && side === 'to' && c.status === 'pending') await env.DB.prepare("UPDATE challenges SET status = 'declined' WHERE id = ?").bind(id).run();
        else if (act === 'cancel' && ['pending', 'accepted'].includes(c.status)) await env.DB.prepare("UPDATE challenges SET status = 'cancelled' WHERE id = ?").bind(id).run();
        else if (act === 'ready' && c.status === 'accepted') {
          await env.DB.prepare(`UPDATE challenges SET ${side}_ready = 1 WHERE id = ?`).bind(id).run();
          const x = await env.DB.prepare('SELECT from_ready, to_ready FROM challenges WHERE id = ?').bind(id).first();
          if (x.from_ready && x.to_ready) await env.DB.prepare("UPDATE challenges SET status = 'running', start_at = ? WHERE id = ? AND status = 'accepted'").bind(now() + 4000, id).run();
        }
        else if (act === 'progress' && c.status === 'running') {
          await env.DB.prepare(`UPDATE challenges SET ${side}_score = ?, ${side}_correct = ?, ${side}_answered = ?, ${side}_done = ?, ${side}_ms = ? WHERE id = ?`)
            .bind(Number(b.score) || 0, Number(b.correct) || 0, Number(b.answered) || 0, b.done ? 1 : 0, Number(b.ms) || 0, id).run();
          const x = await env.DB.prepare('SELECT from_done, to_done FROM challenges WHERE id = ?').bind(id).first();
          if (x.from_done && x.to_done) await env.DB.prepare("UPDATE challenges SET status = 'done', ended = ? WHERE id = ?").bind(now(), id).run();
        }
        else if (act === 'progress' && c.status === 'done') { /* late update after both finished: ignore */ }
        else return ERR(req, 'Not possible now.');
        const c2 = await env.DB.prepare(CH_SQL + ' WHERE c.id = ?').bind(id).first();
        return J(req, { challenge: chOut(c2), side });
      }

      // ----- the owner's private book library -----
      if (p === '/api/books' && M === 'GET') {
        if (!isOwner(me)) return J(req, { books: [] });
        const rows = await env.DB.prepare('SELECT id, meta, size, chunks, visible, updated FROM books ORDER BY id').all();
        return J(req, { books: rows.results.map(r => ({ id: r.id, meta: JSON.parse(r.meta || '{}'), size: r.size, chunks: r.chunks, visible: !!r.visible, updated: r.updated })) });
      }
      const bm = p.match(/^\/api\/books\/([a-z0-9_-]+)\/(pack|visible)$/);
      if (bm) {
        if (!isOwner(me)) return ERR(req, 'Only the owner’s account has the private library.', 403);
        const bid = bm[1];
        if (bm[2] === 'visible' && M === 'POST') {
          const b = await body(req);
          await env.DB.prepare('UPDATE books SET visible = ? WHERE id = ?').bind(b.visible ? 1 : 0, bid).run();
          return J(req, { ok: true });
        }
        if (bm[2] === 'pack' && M === 'GET') {
          const bk = await env.DB.prepare('SELECT chunks, size FROM books WHERE id = ?').bind(bid).first();
          if (!bk) return ERR(req, 'No such book.', 404);
          const { readable, writable } = new TransformStream();
          const pump = (async () => {
            const w = writable.getWriter();
            for (let i = 0; i < bk.chunks; i++) {
              const row = await env.DB.prepare('SELECT data FROM pack_chunks WHERE book_id = ? AND idx = ?').bind(bid, i).first();
              await w.write(new Uint8Array(row.data));
            }
            await w.close();
          })();
          return new Response(readable, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bk.size), 'Cache-Control': 'no-store', ...cors(req) } });
        }
      }

      // ----- owner administration -----
      if (p === '/api/admin/users' && M === 'GET') {
        if (!isOwner(me)) return ERR(req, 'Owner only.', 403);
        const rows = await env.DB.prepare("SELECT * FROM users ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created").all();
        return J(req, { users: rows.results.map(userOut) });
      }
      const am = p.match(/^\/api\/admin\/users\/(\d+)$/);
      if (am) {
        if (!isOwner(me)) return ERR(req, 'Owner only.', 403);
        const uid = Number(am[1]);
        const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first();
        if (!u || u.role === 'owner') return ERR(req, 'Not possible for this account.');
        if (M === 'DELETE') {
          await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid), env.DB.prepare('DELETE FROM progress WHERE user_id = ?').bind(uid),
            env.DB.prepare('DELETE FROM stats WHERE user_id = ?').bind(uid), env.DB.prepare('DELETE FROM users WHERE id = ?').bind(uid)]);
          return J(req, { ok: true });
        }
        const b = await body(req);
        if (b.status && ['active', 'rejected', 'pending'].includes(b.status)) {
          await env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(b.status, uid).run();
          if (b.status !== 'active') await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid).run();
        }
        if (b.allowPw !== undefined) await env.DB.prepare('UPDATE users SET pw_allowed = ?, pw_request = 0 WHERE id = ?').bind(b.allowPw ? 1 : 0, uid).run();
        if (b.resetPw && /^[0-9a-f]{64}$/.test(b.resetPw)) {
          const salt = rnd(16);
          await env.DB.batch([env.DB.prepare('UPDATE users SET salt = ?, pass = ?, pw_allowed = 1, pw_request = 0 WHERE id = ?').bind(salt, await sha(salt + b.resetPw), uid),
            env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid)]);
        }
        return J(req, { user: userOut(await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(uid).first()) });
      }
      return ERR(req, 'not found', 404);
    } catch (e) {
      return ERR(req, 'Server error: ' + (e && e.message || e), 500);
    }
  }
};

function weekKey(t = Date.now()) {
  const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return d.getUTCFullYear() + '-W' + String(Math.ceil(((d - y) / 86400000 + 1) / 7)).padStart(2, '0');
}
async function saveStats(env, uid, s) {
  const n = k => Math.max(0, Math.round(Number(s[k]) || 0));
  await env.DB.prepare(`INSERT INTO stats (user_id, xp, answered, correct, mastered, streak, best_streak, week, week_answered, week_correct, week_xp, updated)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    ON CONFLICT(user_id) DO UPDATE SET xp = ?2, answered = ?3, correct = ?4, mastered = ?5, streak = ?6, best_streak = ?7, week = ?8, week_answered = ?9, week_correct = ?10, week_xp = ?11, updated = ?12`)
    .bind(uid, n('xp'), n('answered'), n('correct'), n('mastered'), n('streak'), n('best_streak'), String(s.week || weekKey()), n('week_answered'), n('week_correct'), n('week_xp'), Date.now()).run();
}
function chOut(c) {
  const side = k => ({ id: c[k + '_id'], name: c[k + '_name'], ready: !!c[k + '_ready'], score: c[k + '_score'] || 0, correct: c[k + '_correct'] || 0, answered: c[k + '_answered'] || 0, done: !!c[k + '_done'], ms: c[k + '_ms'] || 0 });
  return { id: c.id, from: side('from'), to: side('to'), mode: c.mode, title: c.title, ch: c.ch_key, ids: JSON.parse(c.ids || '[]'), status: c.status, startAt: c.start_at, created: c.created, ended: c.ended, now: Date.now() };
}
/* pack upload in 1 MB chunks: PUT /api/admin/pack/<book>/<index>/<count>?meta=<json> with the raw bytes */
async function packUpload(req, env, p) {
  const m = p.match(/^\/api\/admin\/pack\/([a-z0-9_-]+)\/(\d+)\/(\d+)$/);
  if (!m || req.method !== 'PUT') return ERR(req, 'bad upload path');
  const bid = m[1], i = Number(m[2]), n = Number(m[3]);
  const buf = await req.arrayBuffer();
  if (buf.byteLength > CHUNK + 1024) return ERR(req, 'chunk too large', 413);
  if (i === 0) {
    await env.DB.batch([env.DB.prepare('DELETE FROM pack_chunks WHERE book_id = ?').bind(bid),
      env.DB.prepare('INSERT INTO books (id, meta, size, chunks, visible, updated) VALUES (?, ?, 0, ?, 1, ?) ON CONFLICT(id) DO UPDATE SET meta = excluded.meta, size = 0, chunks = excluded.chunks, updated = excluded.updated')
        .bind(bid, new URL(req.url).searchParams.get('meta') || '{}', n, Date.now())]);
  }
  await env.DB.prepare('INSERT OR REPLACE INTO pack_chunks (book_id, idx, data) VALUES (?, ?, ?)').bind(bid, i, buf).run();
  await env.DB.prepare('UPDATE books SET size = size + ? WHERE id = ?').bind(buf.byteLength, bid).run();
  return J(req, { ok: true, i, n });
}
