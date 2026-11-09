/* Account progress sync: every device logged into the same account uploads its changes and merges the
   others' (newest result per question; nothing is lost). Also sends the leaderboard summary. */
(function () {
  let st = {}, busy = null, timer = null, lastErr = '', listeners = [], absorbing = false;
  const KEY = () => 'topscore.sync' + (window.TS_NS || '');
  const CHR = () => 'topscore.chresume' + (window.TS_NS || '');
  function load() { try { st = JSON.parse(localStorage.getItem(KEY())) || {}; } catch (e) { st = {}; } }
  function keep() { try { localStorage.setItem(KEY(), JSON.stringify(st)); } catch (e) { } listeners.forEach(f => { try { f(info()); } catch (e) { } }); }

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
    return JSON.parse(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }
  function snapshot() {
    const S = Store.S;
    let chr = {}; try { chr = JSON.parse(localStorage.getItem(CHR()) || '{}') || {}; } catch (e) { }
    return { v: 1, at: Date.now(), state: Object.assign({}, S, { log: S.log.slice(-25000), backupNag: undefined }), chresume: chr };
  }
  function weekKey(t = Date.now()) {
    const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return d.getUTCFullYear() + '-W' + String(Math.ceil(((d - y) / 86400000 + 1) / 7)).padStart(2, '0');
  }
  /* leaderboard summary of this account */
  function stats() {
    const S = Store.S, wk = weekKey();
    let wc = 0, wi = 0;
    const base = {};   // known + mastered of each book at the end of last week (from the daily snapshots)
    Object.keys(S.daily).sort().forEach(d => {
      if (weekKey(new Date(d + 'T12:00').getTime()) === wk) return;
      const x = S.daily[d]; if (x.m) base.ts = x.m; Object.assign(base, x.mb || {});
    });
    // a question belongs to this week only if this week is when it was first answered / first got right
    const seen = {};
    S.log.forEach(l => { const s = seen[l[1]] || (seen[l[1]] = { t: l[0], r: 0, n: 0, g: 0 }); s.n++; if (l[2]) { s.g++; s.r = s.r || l[0]; } });
    for (const id in seen) {
      const s = seen[id], k = S.cards[id] || {};
      if (s.r && weekKey(s.r * 1000) === wk && s.g >= (k.c || 0)) wc++;
      if (!(k.c > 0) && weekKey(s.t * 1000) === wk && s.n >= (k.w || 0)) wi++;
    }
    const all = Store.tally(), had = Object.values(base).reduce((n, t) => n + (t[3] || 0) + (t[4] || 0), 0), km = all.known + all.mastered;
    return { v: 3, xp: S.xp, answered: all.correct + all.incorrect, correct: all.correct, mastered: km, mastered_only: all.mastered, week_mastered: Math.max(0, km - had), streak: Store.streak(), best_streak: Store.bestStreak(), week: wk, week_answered: wc + wi, week_correct: wc, week_xp: wc * Store.XP_PER_Q };
  }
  function absorb(remote) {
    if (!remote || !remote.state) return;
    absorbing = true;
    const remoteSettings = remote.state.settings;
    Store.mergeState(remote.state);
    if (remoteSettings && !st.seededSettings) { Object.assign(Store.S.settings, remoteSettings); st.seededSettings = 1; if (window.App && App.applyTheme) App.applyTheme(); }
    try {
      const cur = JSON.parse(localStorage.getItem(CHR()) || '{}') || {};
      for (const k in remote.chresume || {}) if (!cur[k] || (remote.chresume[k].ts || 0) > (cur[k].ts || 0)) cur[k] = remote.chresume[k];
      localStorage.setItem(CHR(), JSON.stringify(cur));
    } catch (e) { }
    absorbing = false;
  }

  /* fingerprint of what actually matters, so housekeeping saves do not cost a server write */
  function sigOf() {
    const S = Store.S, t = JSON.stringify([S.cards, S.conf, S.guide, S.flags, S.skips, S.best, S.ach, S.settings]);
    let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
    return h + ':' + t.length;
  }
  async function sync(why = '') {
    if (!window.Account || !Account.me()) return false;
    if (!navigator.onLine) { lastErr = 'Offline — will sync when you are back online'; keep(); return false; }
    if (busy) return busy;
    busy = (async () => {
      st.state = 'syncing'; keep();
      try {
        const g = await Account.api('/progress' + (st.rev ? '?rev=' + st.rev : ''));
        let merged = false;
        if (g.same) { /* nothing new on the server */ }
        else if (!g.data) st.rev = 0;
        else if (g.rev !== st.rev) { absorb(await decode(g.data)); st.rev = g.rev; merged = true; }
        const today = new Date().toISOString().slice(0, 10);
        const sig = sigOf();
        if ((!st.dirty || sig === st.sig) && st.rev && st.putDay === today) {        // nothing to save: no write; the Arena summary still refreshes once a day
          st.dirty = false; st.sig = sig; st.at = Date.now(); st.state = 'ok'; lastErr = ''; keep();
          if (merged && why === 'start' && window.App && /^#\/?$|^#\/book|^#\/stats|^#\/ch|^$/.test(location.hash)) App.render();
          return true;
        }
        for (let attempt = 0; attempt < 3; attempt++) {
          const p = await Account.api('/progress', { method: 'PUT', body: { baseRev: st.rev || 0, data: await encode(snapshot()), stats: stats() } });
          if (p.conflict) { if (p.data) absorb(await decode(p.data)); st.rev = p.rev; continue; }
          st.rev = p.rev; break;
        }
        st.at = Date.now(); st.dirty = false; st.state = 'ok'; lastErr = ''; st.putDay = today; st.sig = sigOf();
        keep();
        if (why === 'start' && window.App && /^#\/?$|^#\/book|^#\/stats|^#\/ch|^$/.test(location.hash)) App.render();
        return true;
      } catch (e) {
        st.state = 'error'; lastErr = navigator.onLine ? (e.message || 'Could not reach the server — will retry') : 'Offline — will sync later'; keep();
        return false;
      } finally { busy = null; }
    })();
    return busy;
  }
  function schedule(ms = 30000) { st.dirty = true; clearTimeout(timer); timer = setTimeout(() => sync('change'), ms); }
  function info() { return { at: st.at || 0, state: st.state || 'idle', error: lastErr, dirty: !!st.dirty }; }
  function start() {
    load();
    window.__onSave = () => { if (!absorbing) schedule(); };
    sync('start');
    document.addEventListener('visibilitychange', () => { if (document.hidden) { if (st.dirty) sync('hide'); } else if (Date.now() - (st.at || 0) > 120000) sync('show'); });
    addEventListener('online', () => sync('online'));
    setInterval(() => { if (!document.hidden) sync('tick'); }, 15 * 60000);
  }
  window.Sync = { start, sync, info, onChange: f => listeners.push(f), stats };
})();
