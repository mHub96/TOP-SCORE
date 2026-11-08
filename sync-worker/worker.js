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
const userOut = u => u && ({ id: u.id, username: u.username, display: u.display, role: u.role, status: u.status, lb: !!u.lb, pwAllowed: !!u.pw_allowed, pwRequest: !!u.pw_request, books: JSON.parse(u.books || '[]'), created: u.created, seen: u.seen, examHost: u.role === 'owner' || !!u.exam_host });
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
const canHost = u => isOwner(u) || !!(u && u.exam_host);      // exam rooms: the owner and the people the owner allows
const CH_SQL = `SELECT c.*, a.display AS from_name, b.display AS to_name FROM challenges c JOIN users a ON a.id = c.from_id JOIN users b ON b.id = c.to_id`;

/* ---------- Web Push (VAPID, no payload: the service worker fetches /api/notifications) ---------- */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = str => b64u(new TextEncoder().encode(str));
let VKEY = null;
async function vapidKey(env) {
  if (!VKEY) VKEY = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return VKEY;
}
async function pushOne(env, sub) {
  const aud = new URL(sub.endpoint).origin;
  const head = b64uStr(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64uStr(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://mhub96.github.io/TOP-SCORE/' }));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(env), new TextEncoder().encode(head + '.' + claims));
  const r = await fetch(sub.endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'high', 'Content-Length': '0', Authorization: `vapid t=${head}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC}` } });
  if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run();
  return r.status;
}
/* queue a notification for a user and wake their devices */
async function notifyUser(env, ctx, uid, title, body, url) {
  await env.DB.prepare('INSERT INTO notifs (user_id, title, body, url, created, delivered) VALUES (?, ?, ?, ?, ?, 0)').bind(uid, title, body || '', url || '', Date.now()).run();
  if (!env.VAPID_PRIVATE_JWK) return;
  const subs = await env.DB.prepare('SELECT endpoint FROM push_subs WHERE user_id = ?').bind(uid).all();
  const job = Promise.all(subs.results.map(x => pushOne(env, x).catch(() => 0)));
  if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
}
async function notifyOwner(env, ctx, title, body, url) {
  const o = await env.DB.prepare("SELECT id FROM users WHERE role = 'owner' LIMIT 1").first();
  if (o) await notifyUser(env, ctx, o.id, title, body, url);
}

/* ---------- Exam room (presenter screen + phones) ----------
   The server keeps the clock: each question starts at q_start; it closes at q_start + secs (timer pace),
   when the examiner presses Next, or 3 s after every remaining player has answered (all_at + 3000).
   State moves forward lazily on every request (no background jobs). Question text never passes through
   the server: only question ids, option counts and the answer keys (kept server-side until the end). */
const EX_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const exCode = () => [...crypto.getRandomValues(new Uint8Array(6))].map(b => EX_ALPHA[b % EX_ALPHA.length]).join('');
const exParse = e => { if (!e) return null; e.cfg = JSON.parse(e.cfg); e.keys = JSON.parse(e.keys); e.n = e.cfg.ids.length; return e; };
const exLoad = async (env, col, v) => exParse(await env.DB.prepare(`SELECT * FROM exams WHERE ${col} = ?`).bind(v).first());
const exDeadline = e => e.status === 'running' && e.cfg.pace === 'timer' ? e.q_start + e.cfg.secs * 1000 : null;
function exAdvanceAt(e) {
  if (e.status !== 'running') return Infinity;
  let t = exDeadline(e) || Infinity;
  if (e.cfg.auto && e.all_at) t = Math.min(t, e.all_at + 3000);
  return t;
}
async function exStep(env, e) {
  const t = now();
  if (e.cur + 1 >= e.n) {
    const r = await env.DB.prepare("UPDATE exams SET status = 'done', ended = ?, all_at = NULL WHERE id = ? AND cur = ? AND status = 'running'").bind(t, e.id, e.cur).run();
    if (r.meta.changes) await env.DB.prepare("UPDATE exam_players SET status = 'done', reason = 'completed', ended = ? WHERE exam_id = ? AND status = 'in'").bind(t, e.id).run();
  } else await env.DB.prepare("UPDATE exams SET cur = cur + 1, q_start = ?, all_at = NULL WHERE id = ? AND cur = ? AND status = 'running'").bind(t, e.id, e.cur).run();
}
async function exTick(env, e) {
  for (let g = 0; g < 3 && e && e.status === 'running' && now() >= exAdvanceAt(e); g++) { await exStep(env, e); e = await exLoad(env, 'id', e.id); }
  return e;
}
/* heartbeat: a phone that stops checking in while the exam runs (app in the background, closed, frozen) is out */
const EX_SILENT = 10000;
async function exStale(env, e) {
  if (!e || e.status !== 'running') return e;
  const r = await env.DB.prepare("UPDATE exam_players SET status = 'left', reason = 'stopped responding (app left, closed or offline)', ended = ? WHERE exam_id = ? AND status = 'in' AND COALESCE(seen, 0) < ?").bind(now(), e.id, now() - EX_SILENT).run();
  if (r.meta.changes) { await exCheckAll(env, e, false); e = await exLoad(env, 'id', e.id); }
  return e;
}
async function exEnd(env, e, why) {
  const t = now();
  await env.DB.prepare("UPDATE exams SET status = 'done', ended = ?, all_at = NULL WHERE id = ? AND status IN ('lobby', 'running')").bind(t, e.id).run();
  await env.DB.prepare("UPDATE exam_players SET status = 'done', reason = ?, ended = ? WHERE exam_id = ? AND status = 'in'").bind(why, t, e.id).run();
}
/* after an answer / retract / someone leaving: has every player still in the exam answered the current question? */
async function exCheckAll(env, e, fresh) {
  if (e.status !== 'running') return;
  const r = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM exam_players WHERE exam_id = ?1 AND status = 'in') AS n, (SELECT COUNT(*) FROM exam_answers a JOIN exam_players p ON p.id = a.player_id WHERE a.exam_id = ?1 AND a.q = ?2 AND p.status = 'in') AS a").bind(e.id, e.cur).first();
  if (!r.n) return exEnd(env, e, 'completed');                   // nobody left in the exam
  const all = r.a >= r.n;
  if (all && (fresh || !e.all_at)) await env.DB.prepare('UPDATE exams SET all_at = ? WHERE id = ? AND cur = ?').bind(now(), e.id, e.cur).run();
  if (!all && e.all_at) await env.DB.prepare('UPDATE exams SET all_at = NULL WHERE id = ? AND cur = ?').bind(e.id, e.cur).run();
}
const exOk = (e, q, choice) => { const k = e.keys[q] || []; const c = JSON.parse(choice || '[]'); return c.length === k.length && k.every(x => c.includes(x)); };
async function exBoard(env, e) {
  const players = (await env.DB.prepare("SELECT id, name, user_id, status, reason, joined, ended, seen FROM exam_players WHERE exam_id = ? AND status != 'kicked' ORDER BY id").bind(e.id).all()).results;
  const ans = (await env.DB.prepare('SELECT player_id, q, choice, ms FROM exam_answers WHERE exam_id = ?').bind(e.id).all()).results;
  const by = {}; players.forEach(x => by[x.id] = Object.assign(x, { score: 0, answered: 0, ms: 0 }));
  for (const a of ans) { const x = by[a.player_id]; if (!x) continue; x.answered++; x.ms += a.ms || 0; if (exOk(e, a.q, a.choice)) x.score++; }
  const board = players.slice().sort((a, b) => b.score - a.score || a.ms - b.ms);
  board.forEach((x, i) => x.rank = i && board[i - 1].score === x.score && board[i - 1].ms === x.ms ? board[i - 1].rank : i + 1);
  return { board, ans };
}
const exPublic = (e, t) => ({ id: e.id, code: e.code, title: e.title, status: e.status, cur: e.cur, n: e.n, q_start: e.q_start, deadline: exDeadline(e), all_at: e.cfg.auto ? e.all_at : null, now: t || now(),
  pace: e.cfg.pace, secs: e.cfg.secs, auto: !!e.cfg.auto, guests: !!e.cfg.guests, book: e.cfg.book, bookTitle: e.cfg.bookTitle, chapters: e.cfg.chapters, next_code: e.next_code || null });
async function exCreate(env, me, cfg, keys) {
  const n = Array.isArray(cfg.ids) ? cfg.ids.length : 0;
  if (!n || n > 300 || !Array.isArray(keys) || keys.length !== n) throw new Error('bad exam');
  const c = {
    ids: cfg.ids.map(String), nopts: cfg.ids.map((_, i) => Math.max(2, Math.min(12, +(cfg.nopts || [])[i] || 5))), multi: cfg.ids.map((_, i) => !!(cfg.multi || [])[i]),
    pace: cfg.pace === 'manual' ? 'manual' : 'timer', secs: Math.max(10, Math.min(600, +cfg.secs || 60)), auto: cfg.auto !== false, guests: cfg.guests !== false,
    book: String(cfg.book || ''), bookTitle: String(cfg.bookTitle || '').slice(0, 80), chapters: String(cfg.chapters || '').slice(0, 300), chs: (Array.isArray(cfg.chs) ? cfg.chs : []).slice(0, 400).map(String)
  };
  const k = keys.map(a => (Array.isArray(a) ? a : [a]).map(Number).filter(x => x >= 0 && x < 12));
  for (let i = 0; i < 6; i++) {
    const code = exCode();
    try {
      const r = await env.DB.prepare("INSERT INTO exams (code, host_id, title, cfg, keys, status, cur, created) VALUES (?, ?, ?, ?, ?, 'lobby', -1, ?)").bind(code, me.id, String(cfg.title || 'Exam').slice(0, 120), JSON.stringify(c), JSON.stringify(k), now()).run();
      return { id: r.meta.last_row_id, code };
    } catch (err) { if (!/UNIQUE/i.test(err.message)) throw err; }
  }
  throw new Error('could not create a room code');
}

export default {
  async fetch(req, env, ctx) {
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
        if (!first) await notifyOwner(env, ctx, '👤 New account request', `${display} (@${username}) wants to join TOP SCORE`, '#/admin');
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
      // ----- exam room: players (account optional; guests allowed when the examiner allows it) -----
      if (p.startsWith('/api/exam/') && ['/api/exam/info', '/api/exam/join', '/api/exam/play', '/api/exam/answer', '/api/exam/finish', '/api/exam/leave-lobby'].includes(p)) {
        if (p === '/api/exam/info' && M === 'GET') {
          const e = await exTick(env, await exLoad(env, 'code', String(url.searchParams.get('code') || '').toUpperCase()));
          if (!e || e.status === 'closed') return ERR(req, 'No open exam with this code.', 404);
          const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM exam_players WHERE exam_id = ? AND status != 'kicked'").bind(e.id).first();
          return J(req, Object.assign(exPublic(e), { players: n.n }));
        }
        if (p === '/api/exam/join' && M === 'POST') {
          const b = await body(req), me = await auth(req, env);
          const e = await exLoad(env, 'code', String(b.code || '').toUpperCase());
          if (!e || e.status === 'closed') return ERR(req, 'No open exam with this code.', 404);
          if (e.status !== 'lobby') return ERR(req, 'This exam has already started — joining is closed.', 403);
          if (!me && !e.cfg.guests) return ERR(req, 'Log in to your TOP SCORE account to join this exam.', 403);
          if (me) {
            const old = await env.DB.prepare("SELECT id, token, name FROM exam_players WHERE exam_id = ? AND user_id = ? AND status = 'in'").bind(e.id, me.id).first();
            if (old) return J(req, { token: old.token, pid: old.id, name: old.name });
          }
          let name = (me ? me.display : String(b.name || '')).replace(/\s+/g, ' ').trim().slice(0, 30);
          if (name.length < 2) return ERR(req, 'Please type your name (at least 2 letters).');
          const taken = new Set((await env.DB.prepare("SELECT name FROM exam_players WHERE exam_id = ? AND status != 'kicked'").bind(e.id).all()).results.map(x => x.name.toLowerCase()));
          let nm = name; for (let i = 2; taken.has(nm.toLowerCase()); i++) nm = `${name} (${i})`;
          const token = rnd(24);
          const r = await env.DB.prepare("INSERT INTO exam_players (exam_id, token, name, user_id, status, joined, seen) VALUES (?, ?, ?, ?, 'in', ?, ?)").bind(e.id, token, nm, me ? me.id : null, now(), now()).run();
          return J(req, { token, pid: r.meta.last_row_id, name: nm });
        }
        const b = M === 'GET' ? {} : await body(req);
        const tok = M === 'GET' ? url.searchParams.get('t') : b.t;
        const pl = tok && await env.DB.prepare('SELECT * FROM exam_players WHERE token = ?').bind(String(tok)).first();
        if (!pl) return ERR(req, 'You are not in this exam.', 404);
        let e = await exTick(env, await exLoad(env, 'id', pl.exam_id));
        const t = now();
        if (p === '/api/exam/play' && M === 'GET') {
          if (t - (pl.seen || 0) > 2500) await env.DB.prepare('UPDATE exam_players SET seen = ? WHERE id = ?').bind(t, pl.id).run();
          e = await exStale(env, e);
          const me2 = await env.DB.prepare('SELECT status, reason, name FROM exam_players WHERE id = ?').bind(pl.id).first();
          const out = Object.assign(exPublic(e, t), { me: me2 });
          if (e.status === 'lobby') out.lobby = (await env.DB.prepare("SELECT name FROM exam_players WHERE exam_id = ? AND status = 'in' ORDER BY id").bind(e.id).all()).results.map(x => x.name);
          if (e.status === 'running' && me2.status === 'in') {
            const mine = await env.DB.prepare('SELECT choice FROM exam_answers WHERE exam_id = ? AND player_id = ? AND q = ?').bind(e.id, pl.id, e.cur).first();
            const c = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM exam_players WHERE exam_id = ?1 AND status = 'in') AS n, (SELECT COUNT(*) FROM exam_answers a JOIN exam_players p ON p.id = a.player_id WHERE a.exam_id = ?1 AND a.q = ?2 AND p.status = 'in') AS a").bind(e.id, e.cur).first();
            Object.assign(out, { q: { id: e.cfg.ids[e.cur], nopts: e.cfg.nopts[e.cur], multi: e.cfg.multi[e.cur] }, mine: mine ? JSON.parse(mine.choice) : null, inN: c.n, answeredN: c.a });
          }
          if (me2.status !== 'in' || e.status === 'done' || e.status === 'closed') {
            const { board, ans } = await exBoard(env, e);
            const my = board.find(x => x.id === pl.id) || {};
            out.result = { score: my.score || 0, answered: my.answered || 0, ms: my.ms || 0, n: e.n };
            if (e.status === 'done' || e.status === 'closed') {        // answer keys only once the whole exam is over (no passing them on)
              const mineA = {}, msA = {}; ans.filter(a => a.player_id === pl.id).forEach(a => { mineA[a.q] = JSON.parse(a.choice); msA[a.q] = a.ms; });
              out.result.rank = my.rank; out.result.of = board.length;
              out.result.review = e.cfg.ids.map((id, i) => ({ id, key: e.keys[i], mine: mineA[i] || null, ok: mineA[i] ? exOk(e, i, JSON.stringify(mineA[i])) : false, ms: msA[i] || null, nopts: e.cfg.nopts[i] }));
              out.board = board.map(x => ({ name: x.name, score: x.score, answered: x.answered, ms: x.ms, rank: x.rank, status: x.status, reason: x.reason, me: x.id === pl.id }));
            }
          }
          return J(req, out);
        }
        if (p === '/api/exam/answer' && M === 'POST') {
          if (pl.status !== 'in') return ERR(req, 'Your exam is already submitted.', 403);
          if (!e || e.status !== 'running') return ERR(req, 'The exam is not running.', 409);
          if (+b.q !== e.cur) return ERR(req, 'Too late — that question is closed.', 409);
          if (b.choice === null || (Array.isArray(b.choice) && !b.choice.length)) {
            await env.DB.prepare('DELETE FROM exam_answers WHERE exam_id = ? AND player_id = ? AND q = ?').bind(e.id, pl.id, e.cur).run();
          } else {
            const ch = (Array.isArray(b.choice) ? b.choice : [b.choice]).map(Number).filter(x => x >= 0 && x < e.cfg.nopts[e.cur]).sort((a, b) => a - b);
            if (!ch.length) return ERR(req, 'bad choice');
            await env.DB.prepare('INSERT INTO exam_answers (exam_id, player_id, q, choice, ms, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(exam_id, player_id, q) DO UPDATE SET choice = excluded.choice, ms = excluded.ms, at = excluded.at')
              .bind(e.id, pl.id, e.cur, JSON.stringify([...new Set(ch)]), t - e.q_start, t).run();
          }
          await exCheckAll(env, e, true);
          return J(req, { ok: true });
        }
        if (p === '/api/exam/leave-lobby' && M === 'POST') {
          if (e.status === 'lobby') await env.DB.prepare("UPDATE exam_players SET status = 'kicked', reason = 'left the lobby' WHERE id = ?").bind(pl.id).run();
          return J(req, { ok: true });
        }
        if (p === '/api/exam/finish' && M === 'POST') {           // voluntary finish, or the app lost focus (strict rule)
          if (pl.status === 'in' && e.status === 'running') {
            const left = !!b.left;
            await env.DB.prepare('UPDATE exam_players SET status = ?, reason = ?, ended = ? WHERE id = ?').bind(left ? 'left' : 'done', String(b.reason || (left ? 'left the app' : 'finished early')).slice(0, 80), t, pl.id).run();
            await exCheckAll(env, e, false);
          } else if (pl.status === 'in' && e.status === 'lobby') await env.DB.prepare("UPDATE exam_players SET status = 'kicked', reason = 'left the lobby' WHERE id = ?").bind(pl.id).run();
          return J(req, { ok: true });
        }
        return ERR(req, 'not found', 404);
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
        await notifyOwner(env, ctx, '🔑 Password change request', `${me.display} asks to change their password`, '#/admin');
        return J(req, { ok: true });
      }

      // ----- push notifications -----
      if (p === '/api/push/key' && M === 'GET') return J(req, { key: env.VAPID_PUBLIC || '' });
      if (p === '/api/push/subscribe' && M === 'POST') {
        const b = await body(req);
        if (!b.sub || !b.sub.endpoint || !/^https:\/\//.test(b.sub.endpoint)) return ERR(req, 'bad subscription');
        await env.DB.prepare('INSERT INTO push_subs (endpoint, user_id, keys, created) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys')
          .bind(b.sub.endpoint, me.id, JSON.stringify(b.sub.keys || {}), now()).run();
        return J(req, { ok: true });
      }
      if (p === '/api/push/unsubscribe' && M === 'POST') {
        const b = await body(req);
        await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').bind(String(b.endpoint || ''), me.id).run();
        return J(req, { ok: true });
      }
      if (p === '/api/push/test' && M === 'POST') {
        await env.DB.prepare('INSERT INTO notifs (user_id, title, body, url, created, delivered) VALUES (?, ?, ?, ?, ?, 0)').bind(me.id, '🔔 Notifications are on', 'You will be told about challenges' + (isOwner(me) ? ', new accounts and password requests.' : '.'), '#/arena', now()).run();
        const subs = await env.DB.prepare('SELECT endpoint FROM push_subs WHERE user_id = ?').bind(me.id).all();
        const st = await Promise.all(subs.results.map(x => pushOne(env, x).catch(e => 'error: ' + e.message)));
        return J(req, { devices: subs.results.length, results: st });
      }
      if (p === '/api/notifications' && M === 'GET') {
        // each device remembers the last id it showed (?after=) so a phone and a tablet both get every alert
        const after = url.searchParams.get('after');
        if (after !== null) {
          const since = +after > 0 ? now() - 3 * 86400000 : now() - 15 * 60000;
          const rows = await env.DB.prepare('SELECT id, title, body, url, created FROM notifs WHERE user_id = ? AND id > ? AND created > ? ORDER BY id').bind(me.id, +after || 0, since).all();
          return J(req, { items: rows.results });
        }
        const rows = await env.DB.prepare('SELECT id, title, body, url, created FROM notifs WHERE user_id = ? AND delivered = 0 AND created > ? ORDER BY id').bind(me.id, now() - 3 * 86400000).all();
        if (rows.results.length) await env.DB.prepare('UPDATE notifs SET delivered = 1 WHERE user_id = ? AND delivered = 0').bind(me.id).run();
        return J(req, { items: rows.results });
      }

      // ----- exam room: examiner (presenter screen) -----
      if ((p === '/api/exam' || p === '/api/exam/mine' || /^\/api\/exam\/\d+/.test(p)) && !canHost(me)) return ERR(req, 'Only the owner and the people the owner allows can host exam rooms.', 403);
      if (p === '/api/exam' && M === 'POST') {
        const b = await body(req);
        try { return J(req, await exCreate(env, me, b.cfg || {}, b.keys)); } catch (err) { return ERR(req, err.message); }
      }
      if (p === '/api/exam/mine' && M === 'GET') {
        const rows = (await env.DB.prepare("SELECT id, code, title, status, created, cfg FROM exams WHERE host_id = ? AND status != 'closed' ORDER BY id DESC LIMIT 10").bind(me.id).all()).results;
        return J(req, { exams: rows.map(r => ({ id: r.id, code: r.code, title: r.title, status: r.status, created: r.created, n: JSON.parse(r.cfg).ids.length })) });
      }
      let em;
      if ((em = p.match(/^\/api\/exam\/(\d+)(?:\/(\w+))?$/))) {
        let e = await exLoad(env, 'id', +em[1]);
        if (!e || e.host_id !== me.id) return ERR(req, 'Not your exam.', 404);
        e = await exTick(env, e);
        const act = em[2], t = now();
        if (!act && M === 'GET') {
          e = await exStale(env, e);
          const out = Object.assign(exPublic(e, t), { cfg: e.cfg, keys: e.keys });
          const players = (await env.DB.prepare("SELECT id, name, user_id, status, reason, joined, ended, seen FROM exam_players WHERE exam_id = ? AND status != 'kicked' ORDER BY id").bind(e.id).all()).results;
          if (e.status === 'running') {
            const a = new Set((await env.DB.prepare('SELECT player_id FROM exam_answers WHERE exam_id = ? AND q = ?').bind(e.id, e.cur).all()).results.map(x => x.player_id));
            players.forEach(x => x.answered = a.has(x.id));
          }
          out.players = players;
          if (e.status === 'done' || e.status === 'closed') { const { board, ans } = await exBoard(env, e); out.board = board; out.answers = ans; }
          return J(req, out);
        }
        if (M !== 'POST') return ERR(req, 'not found', 404);
        const b = await body(req);
        if (act === 'start') {
          const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM exam_players WHERE exam_id = ? AND status = 'in'").bind(e.id).first();
          if (e.status !== 'lobby') return ERR(req, 'Already started.');
          if (!n.n) return ERR(req, 'Nobody has entered the exam yet.');
          await env.DB.prepare("UPDATE exams SET status = 'running', cur = 0, q_start = ?, started = ?, all_at = NULL WHERE id = ? AND status = 'lobby'").bind(t, t, e.id).run();
        }
        if (act === 'next' && e.status === 'running') await exStep(env, e);
        if (act === 'end') await exEnd(env, e, 'exam ended by the examiner');
        if (act === 'close') { if (e.status !== 'done') await exEnd(env, e, 'exam ended by the examiner'); await env.DB.prepare("UPDATE exams SET status = 'closed' WHERE id = ?").bind(e.id).run(); }
        if (act === 'kick' && e.status === 'lobby') await env.DB.prepare("UPDATE exam_players SET status = 'kicked', reason = 'removed by the examiner' WHERE id = ? AND exam_id = ?").bind(+b.pid, e.id).run();
        if (act === 'retake') {
          const cfg = b.cfg ? Object.assign({}, b.cfg) : Object.assign({ title: e.title }, e.cfg);
          let r; try { r = await exCreate(env, me, cfg, b.cfg ? b.keys : e.keys); } catch (err) { return ERR(req, err.message); }
          if (e.status !== 'done') await exEnd(env, e, 'exam ended by the examiner');
          await env.DB.prepare('UPDATE exams SET next_code = ? WHERE id = ?').bind(r.code, e.id).run();
          return J(req, r);
        }
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
        await notifyUser(env, ctx, to.id, `⚔️ ${me.display} challenges you!`, String(b.title || ''), '#/duel/' + r.meta.last_row_id);
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
        const oppId = side === 'from' ? c.to_id : c.from_id;
        if (act === 'accept' && side === 'to' && c.status === 'pending') {
          await env.DB.prepare("UPDATE challenges SET status = 'accepted' WHERE id = ?").bind(id).run();
          await notifyUser(env, ctx, oppId, `⚔️ ${me.display} accepted your challenge`, 'Open the lobby and press Start.', '#/duel/' + id);
        }
        else if (act === 'decline' && side === 'to' && c.status === 'pending') await env.DB.prepare("UPDATE challenges SET status = 'declined' WHERE id = ?").bind(id).run();
        else if (act === 'cancel' && ['pending', 'accepted'].includes(c.status)) await env.DB.prepare("UPDATE challenges SET status = 'cancelled' WHERE id = ?").bind(id).run();
        else if (act === 'ready' && c.status === 'accepted') {
          await env.DB.prepare(`UPDATE challenges SET ${side}_ready = 1 WHERE id = ?`).bind(id).run();
          const x = await env.DB.prepare('SELECT from_ready, to_ready FROM challenges WHERE id = ?').bind(id).first();
          if (!(x.from_ready && x.to_ready)) await notifyUser(env, ctx, oppId, `▶️ ${me.display} is ready`, 'Press Start challenge to begin.', '#/duel/' + id);
          if (x.from_ready && x.to_ready) await env.DB.prepare("UPDATE challenges SET status = 'running', start_at = ? WHERE id = ? AND status = 'accepted'").bind(now() + 4000, id).run();
        }
        else if (act === 'progress' && c.status === 'running') {
          await env.DB.prepare(`UPDATE challenges SET ${side}_score = ?, ${side}_correct = ?, ${side}_answered = ?, ${side}_done = ?, ${side}_ms = ? WHERE id = ?`)
            .bind(Number(b.score) || 0, Number(b.correct) || 0, Number(b.answered) || 0, b.done ? 1 : 0, Number(b.ms) || 0, id).run();
          const x = await env.DB.prepare('SELECT from_done, to_done FROM challenges WHERE id = ?').bind(id).first();
          if (x.from_done && x.to_done) {
            await env.DB.prepare("UPDATE challenges SET status = 'done', ended = ? WHERE id = ?").bind(now(), id).run();
            await notifyUser(env, ctx, oppId, `🏁 Challenge result vs ${me.display}`, 'Tap to see who won.', '#/duel/' + id);
          }
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
        if (b.examHost !== undefined) await env.DB.prepare('UPDATE users SET exam_host = ? WHERE id = ?').bind(b.examHost ? 1 : 0, uid).run();
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
  if (s.v !== 2) return;      // an old cached app still counting repeats must not overwrite the corrected numbers
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
