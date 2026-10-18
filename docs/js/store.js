/* Local progress store: localStorage persistence, XP/levels, daily stats, backup & restore. */
(function () {
  const KEY = 'topscore.v1';
  const D = window.TS_DATA;
  const DAY = 86400000;

  // ---- question index ----
  const Q = {};          // id -> {id, ch, n, s, o, a, k, r, x, l}
  const CH = {};         // chapter number -> chapter
  D.chapters.forEach(ch => {
    CH[ch.n] = ch;
    ch.ids = ch.q.map(q => {
      const id = ch.n + '-' + q.n;
      Q[id] = Object.assign({ id, ch: ch.n }, q);
      return id;
    });
  });
  const ALL = Object.keys(Q);

  const today = (t = Date.now()) => {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  function fresh() {
    return {
      v: 1, created: Date.now(),
      settings: { name: '', goal: 40, theme: 'auto', sound: true, haptics: true, recallFirst: false, shuffleOpts: false, examSecs: 72 },
      cards: {}, log: [], daily: {}, xp: 0, ach: {}, flags: {}, sessions: [], best: {},
      lastBackup: 0, sinceBackup: 0, backupNag: 0
    };
  }
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch (e) { S = fresh(); }
  S = Object.assign(fresh(), S);
  S.settings = Object.assign(fresh().settings, S.settings);

  let saveTimer = null;
  function save(now) {
    clearTimeout(saveTimer);
    const run = () => {
      try { localStorage.setItem(KEY, JSON.stringify(S)); }
      catch (e) {
        // storage full: trim the oldest log entries and retry once
        S.log = S.log.slice(-20000);
        try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e2) { window.App && App.toast('⚠️ Storage is full — export a backup now!'); }
      }
    };
    if (now) run(); else saveTimer = setTimeout(run, 400);
  }
  window.addEventListener('pagehide', () => save(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(true); });

  // ---- mastery ----
  function tier(id) {
    const c = S.cards[id];
    if (!c || !c.reps) return 0;
    if (!c.ok) return 1;
    if (c.s < 4) return 2;
    if (c.s < 21) return 3;
    return 4;
  }
  const TIERS = ['New', 'Struggling', 'Learning', 'Known', 'Mastered'];
  function chapterStats(n) {
    const ids = CH[n].ids, t = [0, 0, 0, 0, 0];
    let due = 0, c = 0, w = 0; const now = Date.now();
    ids.forEach(id => {
      t[tier(id)]++;
      const k = S.cards[id];
      if (k && k.reps) { if (k.due <= now) due++; c += k.c || 0; w += k.w || 0; }
    });
    const mastery = (t[2] * 0.4 + t[3] * 0.75 + t[4]) / ids.length;
    return { tiers: t, due, total: ids.length, seen: ids.length - t[0], mastery, acc: c + w ? c / (c + w) : null };
  }
  function globalTiers() {
    const t = [0, 0, 0, 0, 0];
    ALL.forEach(id => t[tier(id)]++);
    return t;
  }
  const dueIds = (ids = ALL) => { const now = Date.now(); return ids.filter(id => S.cards[id] && S.cards[id].reps && S.cards[id].due <= now); };

  // ---- levels ----
  const RANKS = ['Medical Student', 'Intern', 'Junior Resident', 'Resident', 'Senior Resident', 'Chief Resident', 'Fellow', 'Registrar', 'Consultant', 'Attending Neurosurgeon', 'Associate Professor', 'Professor', 'Chair of Neurosurgery', 'Board Legend'];
  const xpFor = lvl => Math.round(120 * Math.pow(lvl, 1.55));   // xp needed to go from lvl to lvl+1
  function levelInfo(xp = S.xp) {
    let lvl = 1, rem = xp;
    while (rem >= xpFor(lvl)) { rem -= xpFor(lvl); lvl++; }
    return { lvl, into: rem, need: xpFor(lvl), rank: RANKS[Math.min(RANKS.length - 1, Math.floor((lvl - 1) / 3))] };
  }

  function day(d = today()) {
    return S.daily[d] || (S.daily[d] = { a: 0, c: 0, xp: 0, t: 0 });
  }
  function addXP(n) {
    const before = levelInfo().lvl;
    S.xp += n; day().xp += n;
    const after = levelInfo().lvl;
    if (after > before) window.App && App.levelUp(after);
    save();
  }

  /* record an answer.  grade: FSRS grade (1..4). Returns updated card */
  function answer(id, correct, opts = {}) {
    const now = Date.now();
    const old = S.cards[id] || {};
    const g = opts.grade || (correct ? 3 : 1);
    const c = FSRS.review(old, g, now);
    c.ok = correct ? 1 : 0;
    c.c = (old.c || 0) + (correct ? 1 : 0);
    c.w = (old.w || 0) + (correct ? 0 : 1);
    S.cards[id] = c;
    S.log.push([Math.round(now / 1000), id, correct ? 1 : 0, opts.mode || '', opts.ms || 0, opts.conf || 0]);
    if (S.log.length > 60000) S.log.splice(0, S.log.length - 60000);
    const dd = day();
    dd.a++; if (correct) dd.c++; dd.t += Math.min(opts.ms || 0, 300000);
    dd.m = globalTiers();
    S.sinceBackup++;
    save();
    return c;
  }
  // flashcard rating without MCQ (counts as correct unless Again)
  function rate(id, g, mode) { return answer(id, g > 1, { grade: g, mode }); }

  function streak() {
    let s = 0, t = Date.now();
    const goal = Math.max(1, Math.round(S.settings.goal / 4));    // a day counts with ≥25% of goal
    if (!(S.daily[today(t)] && S.daily[today(t)].a >= goal)) t -= DAY; // today not done yet is OK
    while (S.daily[today(t)] && S.daily[today(t)].a >= goal) { s++; t -= DAY; }
    return s;
  }
  function bestStreak() {
    const days = Object.keys(S.daily).sort(); let best = 0, cur = 0, prev = null;
    const goal = Math.max(1, Math.round(S.settings.goal / 4));
    days.forEach(d => {
      if (S.daily[d].a < goal) { cur = 0; prev = d; return; }
      const p = new Date(d); p.setDate(p.getDate() - 1);
      cur = (prev === today(p.getTime()) && cur) ? cur + 1 : 1; best = Math.max(best, cur); prev = d;
    });
    return best;
  }

  function session(rec) {
    S.sessions.push(Object.assign({ ts: Date.now() }, rec));
    if (S.sessions.length > 800) S.sessions.shift();
    save();
  }
  function setBest(key, val) {
    if (!S.best[key] || val > S.best[key]) { S.best[key] = val; save(); return true; }
    return false;
  }
  function toggleFlag(id) { if (S.flags[id]) delete S.flags[id]; else S.flags[id] = Date.now(); save(); return !!S.flags[id]; }

  // ---- backup ----
  function exportData() {
    S.lastBackup = Date.now(); S.sinceBackup = 0; save(true);
    return JSON.stringify({ app: 'TOP SCORE', format: 1, exported: new Date().toISOString(), state: S });
  }
  function importData(text, mode = 'replace') {
    const j = JSON.parse(text);
    const st = j.state || j;
    if (!st || typeof st.cards !== 'object') throw new Error('This file is not a TOP SCORE backup.');
    if (mode === 'merge') {
      for (const id in st.cards) {
        const a = S.cards[id], b = st.cards[id];
        if (!a || (b.last || 0) > (a.last || 0)) S.cards[id] = b;
      }
      for (const d in st.daily) {
        const a = S.daily[d], b = st.daily[d];
        if (!a || b.a > a.a) S.daily[d] = b;
      }
      const seen = new Set(S.log.map(l => l[0] + l[1]));
      st.log.forEach(l => { if (!seen.has(l[0] + l[1])) S.log.push(l); });
      S.log.sort((x, y) => x[0] - y[0]);
      S.xp = Math.max(S.xp, st.xp || 0);
      Object.assign(S.ach, st.ach || {}); Object.assign(S.flags, st.flags || {});
      for (const k in (st.best || {})) setBest(k, st.best[k]);
      S.sessions = S.sessions.concat(st.sessions || []).sort((a, b) => a.ts - b.ts).slice(-800);
    } else {
      S = Object.assign(fresh(), st);
      S.settings = Object.assign(fresh().settings, st.settings);
      Store.S = S;
    }
    S.lastBackup = Date.now(); S.sinceBackup = 0;
    save(true);
  }
  function reset() { S = fresh(); Store.S = S; save(true); }
  function storageBytes() { try { return (localStorage.getItem(KEY) || '').length * 2; } catch (e) { return 0; } }

  window.Store = {
    get S() { return S; }, set S(v) { S = v; },
    Q, CH, ALL, D, TIERS, RANKS, today, tier, chapterStats, globalTiers, dueIds, levelInfo, addXP, answer, rate,
    streak, bestStreak, session, setBest, toggleFlag, exportData, importData, reset, save, day, storageBytes
  };
})();
