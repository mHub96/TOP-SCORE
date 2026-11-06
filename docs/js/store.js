/* Local progress store: localStorage persistence, XP/levels, daily stats, backup & restore.
   Questions of every book on the shelf are indexed here.
   Ids: Top Score "ch-n" (unchanged from v1, so old progress keeps working); pack books "book:ch-k".
   Chapter keys: Top Score "n"; pack books "book:n". */
(function () {
  const KEY = 'topscore.v1';
  const DAY = 86400000;

  // ---- question index (all books) ----
  const Q = {};          // id -> question {id, ch, bid, n, s, o, a, k, ...}
  const CH = {};         // chapter key -> chapter {key, bid, n, t, p, ids}
  const ALL = [];        // every question id
  const BK = {};         // book id -> {ids, keyed, chs:[keys]}
  const chKey = (bid, n) => bid === 'ts' ? String(n) : bid + ':' + n;

  function indexBook(b) {
    if (BK[b.id]) unindexBook(b.id);
    const rec = BK[b.id] = { ids: [], keyed: [], chs: [] };
    b.chapters.forEach(c => {
      const key = chKey(b.id, c.n);
      const ch = CH[key] = { key, bid: b.id, n: c.n, t: c.t, p: c.p || 0, ids: [], keyed: [] };
      c.q.forEach((q, k) => {
        const id = b.id === 'ts' ? c.n + '-' + q.n : b.id + ':' + c.n + '-' + (k + 1);
        Q[id] = Object.assign({ id, ch: key, bid: b.id, pos: k + 1 }, q);
        ch.ids.push(id); rec.ids.push(id); ALL.push(id);
        if (isKeyed(Q[id])) { ch.keyed.push(id); rec.keyed.push(id); }
      });
      rec.chs.push(key);
    });
  }
  function unindexBook(bid) {
    const rec = BK[bid]; if (!rec) return;
    rec.ids.forEach(id => delete Q[id]);
    rec.chs.forEach(k => delete CH[k]);
    const set = new Set(rec.ids);
    for (let i = ALL.length - 1; i >= 0; i--) if (set.has(ALL[i])) ALL.splice(i, 1);
    delete BK[bid];
  }
  const isKeyed = q => !q.nk && q.a !== undefined && q.a !== null && !(Array.isArray(q.a) && !q.a.length);
  const keyed = id => Q[id] && isKeyed(Q[id]);
  const answers = q => Array.isArray(q.a) ? q.a : (q.a === undefined || q.a === null ? [] : [q.a]);
  const multi = q => Array.isArray(q.a) && q.a.length > 1;
  function syncBooks() { Books.list().forEach(b => { if (!BK[b.id]) indexBook(b); }); Object.keys(BK).forEach(id => { if (!Books.get(id)) unindexBook(id); }); }
  Books.list().forEach(indexBook);

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
  function statsOf(ids) {
    const t = [0, 0, 0, 0, 0];
    let due = 0, c = 0, w = 0; const now = Date.now();
    ids.forEach(id => {
      t[tier(id)]++;
      const k = S.cards[id];
      if (k && k.reps) { if (k.due <= now) due++; c += k.c || 0; w += k.w || 0; }
    });
    const n = ids.length || 1;
    const mastery = (t[2] * 0.4 + t[3] * 0.75 + t[4]) / n;
    return { tiers: t, due, total: ids.length, seen: ids.length - t[0], mastery, acc: c + w ? c / (c + w) : null, done: (ids.length - t[0]) / n };
  }
  // chapter/book stats count only keyed questions (practice-only items have no key to score)
  function chapterStats(key) { const ch = CH[key]; if (!ch) return statsOf([]); const s = statsOf(ch.keyed); s.practice = ch.ids.length - ch.keyed.length; return s; }
  function bookStats(bid) { const b = BK[bid]; if (!b) return statsOf([]); const s = statsOf(b.keyed); s.practice = b.ids.length - b.keyed.length; s.chapters = b.chs.length; return s; }
  function globalTiers(ids) {
    const t = [0, 0, 0, 0, 0];
    (ids || allKeyed()).forEach(id => t[tier(id)]++);
    return t;
  }
  const allKeyed = () => ALL.filter(keyed);
  const dueIds = (ids = ALL) => { const now = Date.now(); return ids.filter(id => S.cards[id] && S.cards[id].reps && S.cards[id].due <= now); };
  // last time the user answered anything in a book (for shelf ordering / "recent")
  function lastTouched(bid) {
    for (let i = S.log.length - 1; i >= 0; i--) { const id = S.log[i][1]; if (Q[id] && Q[id].bid === bid) return S.log[i][0] * 1000; }
    return 0;
  }

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
    if (!keyed(id)) return S.cards[id] || {};
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
    dd.m = globalTiers(BK.ts ? BK.ts.keyed : []);           // Top Score snapshot (kept for v1 charts)
    dd.mb = dd.mb || {}; const b = Q[id].bid; dd.mb[b] = globalTiers(BK[b].keyed);
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
    let chr = null; try { chr = JSON.parse(localStorage.getItem('topscore.chresume') || 'null'); } catch (e) { }
    return JSON.stringify({ app: 'TOP SCORE', format: 1, exported: new Date().toISOString(), state: S, chresume: chr });
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
    if (j.chresume && typeof j.chresume === 'object') {
      try {
        const cur = mode === 'merge' ? (JSON.parse(localStorage.getItem('topscore.chresume') || '{}') || {}) : {};
        for (const k in j.chresume) if (!cur[k] || (j.chresume[k].ts || 0) > (cur[k].ts || 0)) cur[k] = j.chresume[k];
        localStorage.setItem('topscore.chresume', JSON.stringify(cur));
      } catch (e) { }
    }
    S.lastBackup = Date.now(); S.sinceBackup = 0;
    save(true);
  }
  function reset() { S = fresh(); Store.S = S; try { localStorage.removeItem('topscore.chresume'); } catch (e) { } save(true); }
  function storageBytes() { try { return (localStorage.getItem(KEY) || '').length * 2; } catch (e) { return 0; } }

  window.Store = {
    get S() { return S; }, set S(v) { S = v; },
    Q, CH, ALL, BK, TIERS, RANKS, chKey, indexBook, unindexBook, syncBooks, keyed, isKeyed, answers, multi, allKeyed,
    today, tier, statsOf, chapterStats, bookStats, globalTiers, dueIds, lastTouched, levelInfo, addXP, answer, rate,
    streak, bestStreak, session, setBest, toggleFlag, exportData, importData, reset, save, day, storageBytes
  };
})();
