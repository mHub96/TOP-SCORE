/* TOP SCORE progress sync — Cloudflare Worker + D1.
   A sync code (random, generated on the user's first device) identifies one progress record.
   GET  /api/p/:code        -> {rev, updated, data} (data null when nothing is saved yet)
   PUT  /api/p/:code        body {baseRev, data} -> {rev} | {conflict:true, rev, updated, data} when another device saved first
   The code is the only secret: it is long and random (≈ 60 bits), so it cannot be guessed. */
const ORIGINS = ['https://mhub96.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'];
const CODE = /^TS-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const MAX = 1_800_000; // bytes of compressed+base64 payload (D1 row limit is 2 MB)

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
const json = (req, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) } });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/p\/([^/]+)$/);
    if (url.pathname === '/' || url.pathname === '/api/health') return json(req, { ok: true, service: 'topscore-sync' });
    if (!m) return json(req, { error: 'not found' }, 404);
    const code = decodeURIComponent(m[1]).toUpperCase();
    if (!CODE.test(code)) return json(req, { error: 'invalid code' }, 400);

    if (req.method === 'GET') {
      const row = await env.DB.prepare('SELECT rev, updated, data FROM progress WHERE code = ?').bind(code).first();
      if (!row) return json(req, { rev: 0, updated: 0, data: null });   // nothing saved under this code yet
      return json(req, row);
    }
    if (req.method === 'PUT') {
      const text = await req.text();
      if (text.length > MAX + 200) return json(req, { error: 'too large' }, 413);
      let body; try { body = JSON.parse(text); } catch (e) { return json(req, { error: 'bad json' }, 400); }
      if (typeof body.data !== 'string' || body.data.length > MAX) return json(req, { error: 'bad data' }, 400);
      const base = Number(body.baseRev) || 0, now = Date.now();
      const cur = await env.DB.prepare('SELECT rev, updated, data FROM progress WHERE code = ?').bind(code).first();
      if (!cur) {
        if (base !== 0) return json(req, { error: 'unknown code' }, 404);
        await env.DB.prepare('INSERT INTO progress (code, rev, updated, data) VALUES (?, 1, ?, ?)').bind(code, now, body.data).run();
        return json(req, { rev: 1, updated: now });
      }
      if (cur.rev !== base) return json(req, { conflict: true, ...cur });   // someone else saved first: client merges and retries
      const res = await env.DB.prepare('UPDATE progress SET rev = rev + 1, updated = ?, data = ? WHERE code = ? AND rev = ?').bind(now, body.data, code, base).run();
      if (!res.meta.changes) {
        const again = await env.DB.prepare('SELECT rev, updated, data FROM progress WHERE code = ?').bind(code).first();
        return json(req, { conflict: true, ...again });
      }
      return json(req, { rev: base + 1, updated: now });
    }
    return json(req, { error: 'method not allowed' }, 405);
  }
};
