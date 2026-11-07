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
    let a = 0, c = 0, wa = 0, wc = 0, wx = 0;
    for (const d in S.daily) {
      const x = S.daily[d]; a += x.a || 0; c += x.c || 0;
      if (weekKey(new Date(d + 'T12:00').getTime()) === wk) { wa += x.a || 0; wc += x.c || 0; wx += x.xp || 0; }
    }
    const t = Store.globalTiers();
    return { xp: S.xp, answered: a, correct: c, mastered: t[3] + t[4], streak: Store.streak(), best_streak: Store.bestStreak(), week: wk, week_answered: wa, week_correct: wc, week_xp: wx };
  }
  function absorb(remote) {
    if (!remote || !remote.state) return;
    absorbing = true;
    const localGain = Math.max(0, Store.S.xp - (st.xpBase || 0));
    const remoteSettings = remote.state.settings;
    Store.mergeState(remote.state, { xp: (remote.state.xp || 0) + localGain });
    if (remoteSettings && !st.seededSettings) { Object.assign(Store.S.settings, remoteSettings); st.seededSettings = 1; if (window.App && App.applyTheme) App.applyTheme(); }
    try {
      const cur = JSON.parse(localStorage.getItem(CHR()) || '{}') || {};
      for (const k in remote.chresume || {}) if (!cur[k] || (remote.chresume[k].ts || 0) > (cur[k].ts || 0)) cur[k] = remote.chresume[k];
      localStorage.setItem(CHR(), JSON.stringify(cur));
    } catch (e) { }
    absorbing = false;
  }

  async function sync(why = '') {
    if (!window.Account || !Account.me()) return false;
    if (!navigator.onLine) { lastErr = 'Offline — will sync when you are back online'; keep(); return false; }
    if (busy) return busy;
    busy = (async () => {
      st.state = 'syncing'; keep();
      try {
        const g = await Account.api('/progress');
        if (!g.data) st.rev = 0;
        else if (g.rev !== st.rev) { absorb(await decode(g.data)); st.rev = g.rev; }
        for (let attempt = 0; attempt < 3; attempt++) {
          const p = await Account.api('/progress', { method: 'PUT', body: { baseRev: st.rev || 0, data: await encode(snapshot()), stats: stats() } });
          if (p.conflict) { if (p.data) absorb(await decode(p.data)); st.rev = p.rev; continue; }
          st.rev = p.rev; break;
        }
        st.xpBase = Store.S.xp; st.at = Date.now(); st.dirty = false; st.state = 'ok'; lastErr = '';
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
  function schedule(ms = 12000) { st.dirty = true; clearTimeout(timer); timer = setTimeout(() => sync('change'), ms); }
  function info() { return { at: st.at || 0, state: st.state || 'idle', error: lastErr, dirty: !!st.dirty }; }
  function start() {
    load();
    window.__onSave = () => { if (!absorbing) schedule(); };
    sync('start');
    document.addEventListener('visibilitychange', () => { if (document.hidden) { if (st.dirty) sync('hide'); } else sync('show'); });
    addEventListener('online', () => sync('online'));
    setInterval(() => { if (!document.hidden) sync('tick'); }, 4 * 60000);
  }
  window.Sync = { start, sync, info, onChange: f => listeners.push(f), stats };
})();
