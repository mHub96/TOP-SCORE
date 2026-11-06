/* Cross-device progress sync.
   Each user gets a random sync code (created on the first device). Progress is stored under that code on the
   TOP SCORE sync service (Cloudflare Worker + D1). Entering the same code on another device links it: all linked
   devices upload their changes and merge the others' (newest result per question, nothing is lost). */
(function () {
  const API = 'https://topscore-sync.topscore-c067b3.workers.dev/api/p/';
  const KEY = 'topscore.sync';
  const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I to avoid confusion
  const CODE_RX = /^TS-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
  let st = load(), busy = null, timer = null, lastErr = '', listeners = [];

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function keep() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { } notify(); }
  function notify() { listeners.forEach(f => { try { f(info()); } catch (e) { } }); }
  function newCode() {
    const r = crypto.getRandomValues(new Uint8Array(12)); let s = '';
    for (let i = 0; i < 12; i++) s += ALPH[r[i] % 32];
    return `TS-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  }
  const norm = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^TS/, '').replace(/^(.{4})(.{4})(.{4})$/, 'TS-$1-$2-$3');

  // ---------- payload (gzip + base64 when the browser supports it) ----------
  async function encode(obj) {
    const txt = JSON.stringify(obj);
    if (!window.CompressionStream) return 'j:' + txt;
    const buf = await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    let bin = ''; const u = new Uint8Array(buf);
    for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return 'z:' + btoa(bin);
  }
  async function decode(s) {
    if (s.startsWith('j:')) return JSON.parse(s.slice(2));
    const bin = atob(s.slice(2)); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const txt = await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(txt);
  }
  function snapshot() {
    const S = Store.S;
    let chr = {}; try { chr = JSON.parse(localStorage.getItem('topscore.chresume') || '{}') || {}; } catch (e) { }
    const state = Object.assign({}, S, { log: S.log.slice(-25000), settings: undefined, backupNag: undefined });
    return { v: 1, at: Date.now(), state, chresume: chr };
  }
  /* bring the server copy into this device. XP: server total + what this device earned since its last sync */
  let absorbing = false;
  function absorb(remote) {
    if (!remote || !remote.state) return;
    absorbing = true;
    const localGain = Math.max(0, Store.S.xp - (st.xpBase || 0));
    Store.mergeState(remote.state, { xp: (remote.state.xp || 0) + localGain });
    try {
      const cur = JSON.parse(localStorage.getItem('topscore.chresume') || '{}') || {};
      for (const k in remote.chresume || {}) if (!cur[k] || (remote.chresume[k].ts || 0) > (cur[k].ts || 0)) cur[k] = remote.chresume[k];
      localStorage.setItem('topscore.chresume', JSON.stringify(cur));
    } catch (e) { }
    absorbing = false;
  }

  async function req(method, body) {
    const r = await fetch(API + encodeURIComponent(st.code), { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let j = {}; try { j = await r.json(); } catch (e) { }
    return { status: r.status, j };
  }

  /* one sync round: pull what others saved, merge, push ours */
  async function sync(why = '') {
    if (!st.code || !navigator.onLine) { if (!navigator.onLine) { lastErr = 'Offline — will sync when you are back online'; notify(); } return false; }
    if (busy) return busy;
    busy = (async () => {
      st.state = 'syncing'; notify();
      try {
        const g = await req('GET');
        if (g.status !== 200) throw new Error('server ' + g.status);
        if (!g.j.data) st.rev = 0;
        else if (g.j.rev !== st.rev) { absorb(await decode(g.j.data)); st.rev = g.j.rev; }
        for (let attempt = 0; attempt < 3; attempt++) {
          const p = await req('PUT', { baseRev: st.rev || 0, data: await encode(snapshot()) });
          if (p.status === 200 && p.j.conflict) { absorb(await decode(p.j.data)); st.rev = p.j.rev; continue; }
          if (p.status === 200) { st.rev = p.j.rev; break; }
          throw new Error(p.j.error || ('server ' + p.status));
        }
        st.xpBase = Store.S.xp; st.at = Date.now(); st.dirty = false; st.state = 'ok'; lastErr = '';
        keep();
        if (why === 'start' && window.App && location.hash.match(/^#\/?$|^#\/book|^#\/stats|^#\/ch/)) App.render();
        return true;
      } catch (e) {
        st.state = 'error'; lastErr = navigator.onLine ? 'Could not reach the sync service — will retry' : 'Offline — will sync later'; keep();
        return false;
      } finally { busy = null; }
    })();
    return busy;
  }
  function schedule(ms = 12000) { st.dirty = true; clearTimeout(timer); timer = setTimeout(() => sync('change'), ms); }

  /* link this device to the progress saved under another code */
  async function link(code) {
    code = norm(code);
    if (!CODE_RX.test(code)) throw new Error('That does not look like a TOP SCORE code (TS-XXXX-XXXX-XXXX).');
    if (code === st.code) throw new Error('This device already uses that code.');
    const r = await fetch(API + encodeURIComponent(code), { cache: 'no-store' });
    if (!r.ok) throw new Error('Could not reach the sync service. Try again in a moment.');
    const j = await r.json();
    if (!j.data) throw new Error('No saved progress was found for that code. Check it on your other device.');
    const prev = { code: st.code };
    st.code = code; st.rev = 0; st.xpBase = 0;
    absorb(await decode(j.data));
    st.rev = j.rev; keep();
    await sync('link');
    return prev;
  }
  function info() { return { code: st.code, at: st.at || 0, state: st.state || 'idle', error: lastErr, dirty: !!st.dirty }; }

  function start() {
    if (!st.code) { st.code = newCode(); st.rev = 0; st.xpBase = 0; keep(); }
    sync('start');
    // upload shortly after progress changes; pull when the app comes back to the foreground; periodic safety net
    window.__onSave = () => { if (!absorbing) schedule(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) { if (st.dirty) sync('hide'); } else sync('show'); });
    addEventListener('online', () => sync('online'));
    setInterval(() => { if (!document.hidden) sync('tick'); }, 4 * 60000);
  }

  window.Sync = { start, sync, link, info, onChange: f => listeners.push(f), norm, CODE_RX };
})();
