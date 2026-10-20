/* TOP SCORE — core: router, home, chapters, study hub, stats, settings, backup, achievements. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const strip = s => String(s).replace(/<[^>]+>/g, '');
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };
  const L = i => 'ABCDEFGHIJKL'[i];
  const { Q, CH, ALL, D } = Store;
  const S = () => Store.S;
  const view = () => $('#view');
  const PART_SHORT = D.parts.map(p => p.split(':')[0].replace('Part ', ''));

  // ---------- UI primitives ----------
  function toast(msg, ms = 2600) {
    const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = msg;
    $('#toasts').appendChild(t); requestAnimationFrame(() => t.classList.add('on'));
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 400); }, ms);
  }
  function modal(html, opts = {}) {
    const m = document.createElement('div'); m.className = 'modal-wrap';
    m.innerHTML = `<div class="modal ${opts.cls || ''}" role="dialog" aria-modal="true">${opts.close === false ? '' : '<button class="icon-btn modal-x" aria-label="Close">✕</button>'}${html}</div>`;
    document.body.appendChild(m);
    requestAnimationFrame(() => m.classList.add('on'));
    const close = () => { m.classList.remove('on'); setTimeout(() => m.remove(), 300); opts.onClose && opts.onClose(); };
    m.addEventListener('click', e => { if (e.target === m && opts.close !== false) close(); });
    const x = $('.modal-x', m); if (x) x.onclick = close;
    m.close = close;
    return m;
  }
  function confirmBox(title, text, yes = 'Yes', no = 'Cancel') {
    return new Promise(res => {
      const m = modal(`<h3>${title}</h3><p class="muted">${text}</p><div class="row end gap"><button class="btn ghost" data-r="0">${no}</button><button class="btn" data-r="1">${yes}</button></div>`, { onClose: () => res(false) });
      $$('[data-r]', m).forEach(b => b.onclick = () => { res(b.dataset.r === '1'); m.close(); });
    });
  }
  function ring(pct, size = 54, stroke = 6, label = '') {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/><circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${c * (1 - Math.max(0, Math.min(1, pct)))}"/><text x="50%" y="50%" dy=".35em" text-anchor="middle">${label}</text></svg>`;
  }
  function animateRings(root = document) {
    requestAnimationFrame(() => setTimeout(() => $$('.ring-fg', root).forEach(c => c.style.strokeDashoffset = c.dataset.off), 30));
  }
  function tierBar(t, total) {
    return `<div class="tierbar">${t.map((v, i) => v ? `<i class="t${i}" style="width:${v / total * 100}%" title="${Store.TIERS[i]}: ${v}"></i>` : '').join('')}</div>`;
  }
  const fmtMs = ms => { const s = Math.round(ms / 1000); return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm'; };
  const fmtIvl = ms => { const m = ms / 60000; if (m < 60) return Math.max(1, Math.round(m)) + 'm'; const h = m / 60; if (h < 24) return Math.round(h) + 'h'; const d = h / 24; if (d < 30) return Math.round(d) + 'd'; if (d < 365) return (d / 30).toFixed(1) + 'mo'; return (d / 365).toFixed(1) + 'y'; };
  const chTitle = n => `${n}. ${strip(CH[n].t)}`;

  // ---------- router ----------
  const routes = {};
  let leaveGuard = null;
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  async function render() {
    const h = location.hash.slice(1) || '/';
    if (leaveGuard && !h.startsWith('/play')) {
      const ok = await leaveGuard();
      if (!ok) { history.replaceState(null, '', '#/play'); return; }
      leaveGuard = null;
    }
    const segs = h.split('/').filter(Boolean), path = segs[0] || '', arg = segs.slice(1).join('/');
    const fn = routes[path || 'home'] || routes.home;
    $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.r === (path || 'home') || (a.dataset.r === 'chapters' && path === 'ch')));
    document.body.classList.toggle('playing', path === 'play');
    const v = view();
    if (path !== 'play') v.dataset.sid = '';
    v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
    if (path !== 'play') window.scrollTo(0, 0);
    fn(arg ? decodeURIComponent(arg) : '');
    animateRings(v);
  }
  addEventListener('hashchange', render);

  // ---------- home ----------
  routes.home = () => {
    const st = S(), lv = Store.levelInfo(), today = Store.day(), streak = Store.streak();
    const tiers = Store.globalTiers(), due = Store.dueIds().length;
    const goalPct = Math.min(1, today.a / st.settings.goal);
    const hr = new Date().getHours();
    const greet = hr < 5 ? 'Burning the midnight oil' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const mastered = tiers[3] + tiers[4], seen = ALL.length - tiers[0];
    const weak = weakestChapters(3);
    view().innerHTML = `
      ${backupBanner()}
      <section class="hero card glow">
        <div class="hero-top">
          <div>
            <div class="eyebrow">${greet}${st.settings.name ? ', ' + esc(st.settings.name) : ''} 👋</div>
            <h1 class="hero-title">Top Score <span class="grad">Neurosurgery</span></h1>
            <div class="muted small">${ALL.length.toLocaleString()} verified board MCQs · ${D.chapters.length} chapters · ${D.parts.length} parts</div>
          </div>
          <div class="goal-ring" title="Daily goal">${ring(goalPct, 92, 9, '')}<div class="goal-in"><b>${today.a}</b><span>/${st.settings.goal}</span><small>today</small></div></div>
        </div>
        <div class="lvl">
          <div class="lvl-badge">${lv.lvl}</div>
          <div class="grow">
            <div class="row between"><b>${lv.rank}</b><span class="muted small">${lv.into} / ${lv.need} XP</span></div>
            <div class="xpbar"><i style="width:${lv.into / lv.need * 100}%"></i></div>
          </div>
          <div class="streak ${streak ? 'hot' : ''}" title="Day streak"><span class="flame">🔥</span><b>${streak}</b><small>day${streak === 1 ? '' : 's'}</small></div>
        </div>
      </section>

      <section class="grid2">
        <button class="cta card ${due ? 'pulse' : ''}" data-go="smart">
          <div class="cta-ic">🧠</div>
          <div class="grow"><b>Smart Review</b><div class="muted small">${due ? `<span class="pill warn">${due} due</span> spaced-repetition queue` : 'Spaced repetition — new + due questions'}</div></div><span class="chev">›</span>
        </button>
        <button class="cta card" data-go="challenge">
          <div class="cta-ic">🎯</div>
          <div class="grow"><b>MCQ Challenge</b><div class="muted small">Exam yourself, score, retry misses</div></div><span class="chev">›</span>
        </button>
      </section>

      <section class="stats-strip">
        <div class="stat card"><small>Seen</small><b data-count="${seen}">0</b><span class="muted small">of ${ALL.length}</span></div>
        <div class="stat card"><small>Known + Mastered</small><b data-count="${mastered}">0</b><span class="muted small">${Math.round(mastered / ALL.length * 100)}% of bank</span></div>
        <div class="stat card"><small>Accuracy (7d)</small><b>${acc7()}</b><span class="muted small">last 7 days</span></div>
        <div class="stat card"><small>Total XP</small><b data-count="${st.xp}">0</b><span class="muted small">${Object.keys(st.ach).length} badges</span></div>
      </section>

      <section class="card">
        <div class="row between"><h2>🧩 Brain map</h2><a class="link" href="#/chapters">All chapters ›</a></div>
        <p class="muted small">Each tile is a chapter — colour shows mastery. Tap one to study it.</p>
        <div class="brainmap">${D.chapters.map(ch => { const cs = Store.chapterStats(ch.n); return `<a href="#/ch/${ch.n}" class="bm m${Math.min(5, Math.ceil(cs.mastery * 5))}" data-tip="${esc(chTitle(ch.n))}\nMastery ${Math.round(cs.mastery * 100)}% · ${cs.seen}/${cs.total} seen${cs.due ? ' · ' + cs.due + ' due' : ''}">${ch.n}</a>`; }).join('')}</div>
        <div class="bm-legend"><span><i class="bm m0"></i>untouched</span><span><i class="bm m1"></i></span><span><i class="bm m3"></i></span><span><i class="bm m5"></i>mastered</span></div>
      </section>

      ${weak.length ? `<section class="card"><h2>🎯 Focus next</h2><p class="muted small">Your weakest chapters (by accuracy and mastery).</p>
        ${weak.map(w => `<a class="list-item" href="#/ch/${w.n}"><span class="num">${w.n}</span><span class="grow">${esc(strip(CH[w.n].t))}<br><small class="muted">${w.acc === null ? 'not started' : Math.round(w.acc * 100) + '% accuracy'} · ${Math.round(w.mastery * 100)}% mastery</small></span><span class="chev">›</span></a>`).join('')}</section>` : ''}

      <section class="card">
        <h2>🎮 Quick play</h2>
        <div class="quick">
          ${[['blitz', '⚡', 'Speed Blitz'], ['survival', '❤️', 'Survival'], ['tf', '✅', 'True / False'], ['match', '🧩', 'Match Pairs'], ['boss', '🐉', 'Boss Battle'], ['knockout', '🥊', 'Knockout']].map(g => `<button class="q-tile" data-game="${g[0]}"><span>${g[1]}</span>${g[2]}</button>`).join('')}
        </div>
      </section>`;
    $$('[data-count]').forEach(el => FX.countUp(el, +el.dataset.count, 900, v => Math.round(v).toLocaleString()));
    $$('[data-go]').forEach(b => b.onclick = () => Modes.setup(b.dataset.go));
    $$('[data-game]').forEach(b => b.onclick = () => Modes.setup(b.dataset.game));
    bindBanner();
  };
  function acc7() {
    let a = 0, c = 0; const now = Date.now();
    for (let i = 0; i < 7; i++) { const d = S().daily[Store.today(now - i * 86400000)]; if (d) { a += d.a; c += d.c; } }
    return a ? Math.round(c / a * 100) + '%' : '—';
  }
  function weakestChapters(n) {
    const arr = D.chapters.map(ch => Object.assign({ n: ch.n }, Store.chapterStats(ch.n))).filter(x => x.seen > 0);
    arr.sort((a, b) => ((a.acc ?? 0) + a.mastery) - ((b.acc ?? 0) + b.mastery));
    return arr.slice(0, n);
  }

  // ---------- backup reminder ----------
  function needBackup() {
    const st = S(); const days = (Date.now() - (st.lastBackup || st.created)) / 86400000;
    if (st.sinceBackup >= 25 && (!st.lastBackup || days >= 2)) return true;
    if (st.sinceBackup >= 150) return true;
    return false;
  }
  function backupBanner() {
    if (!needBackup()) return '';
    const st = S();
    return `<div class="banner card"><span class="b-ic">💾</span><div class="grow"><b>Save your progress to your phone</b><div class="small muted">${st.sinceBackup} answers since your ${st.lastBackup ? 'last backup (' + new Date(st.lastBackup).toLocaleDateString() + ')' : 'first session'}. Progress lives only in this browser — if its data is cleared, it's gone. Export a backup file now; you can restore it any time.</div></div><button class="btn sm" id="bkNow">Back up</button></div>`;
  }
  function bindBanner() { const b = $('#bkNow'); if (b) b.onclick = () => doExport(); }
  async function doExport() {
    const data = Store.exportData();
    const name = `topscore-backup-${Store.today()}.json`;
    const file = new File([data], name, { type: 'application/json' });
    let shared = false;
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) {
      try { await navigator.share({ files: [file], title: 'TOP SCORE backup' }); shared = true; } catch (e) { if (e.name === 'AbortError') { toast('Backup cancelled'); return; } }
    }
    if (!shared) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    unlock('backup');
    toast('💾 Backup saved — keep the file somewhere safe (Files / Drive).');
    if (location.hash === '' || location.hash === '#/') render();
  }
  function doImport() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const text = await f.text();
      const m = modal(`<h3>Restore backup</h3><p class="muted">File: <b>${esc(f.name)}</b></p>
        <p class="small muted"><b>Replace</b> makes this device identical to the backup. <b>Merge</b> keeps the newest result for every question from both.</p>
        <div class="row end gap"><button class="btn ghost" data-m="merge">Merge</button><button class="btn" data-m="replace">Replace</button></div>`);
      $$('[data-m]', m).forEach(b => b.onclick = () => {
        try { Store.importData(text, b.dataset.m); toast('✅ Progress restored'); m.close(); applyTheme(); render(); }
        catch (e) { toast('⚠️ ' + esc(e.message)); }
      });
    };
    inp.click();
  }

  // ---------- chapters ----------
  routes.chapters = () => {
    view().innerHTML = `
      <div class="page-head"><h1>Chapters</h1><p class="muted">Every chapter is studied separately. Tap one for its modes.</p>
      <input class="search" id="chFilter" placeholder="Filter chapters…" autocomplete="off"></div>
      <div id="chList">${D.parts.map((p, pi) => `
        <section class="part" data-part="${pi}"><h3 class="part-h"><span>${esc(p.split(':')[0])}</span>${esc(p.split(':').slice(1).join(':'))}</h3>
        ${D.chapters.filter(c => c.p === pi).map(c => { const cs = Store.chapterStats(c.n); return `
          <a class="ch-card card" href="#/ch/${c.n}" data-t="${esc(strip(c.t).toLowerCase())} ${c.n}">
            ${ring(cs.mastery, 50, 5, Math.round(cs.mastery * 100) + '%')}
            <div class="grow"><div class="ch-t"><span class="num">${c.n}</span>${c.t}</div>
            <div class="muted small">${cs.total} MCQs · ${cs.seen} seen${cs.acc !== null ? ' · ' + Math.round(cs.acc * 100) + '% acc' : ''}${cs.due ? ` · <span class="pill warn">${cs.due} due</span>` : ''}</div>
            ${tierBar(cs.tiers, cs.total)}</div><span class="chev">›</span></a>`; }).join('')}</section>`).join('')}</div>`;
    $('#chFilter').oninput = e => {
      const q = e.target.value.toLowerCase().trim();
      $$('.ch-card').forEach(c => c.style.display = !q || c.dataset.t.includes(q) ? '' : 'none');
      $$('.part').forEach(p => p.style.display = $$('.ch-card', p).some(c => c.style.display !== 'none') ? '' : 'none');
    };
  };

  routes.ch = (arg) => {
    const n = +arg; const ch = CH[n]; if (!ch) return go('#/chapters');
    const cs = Store.chapterStats(n);
    const best = S().best['challenge-' + n];
    view().innerHTML = `
      <a class="back" href="#/chapters">‹ Chapters</a>
      <section class="card glow ch-hero">
        <div class="eyebrow">${esc(D.parts[ch.p])}</div>
        <h1><span class="num big">${n}</span> ${ch.t}</h1>
        <div class="ch-hero-row">
          ${ring(cs.mastery, 84, 8, Math.round(cs.mastery * 100) + '%')}
          <div class="grow">
            <div class="kv"><span>Questions</span><b>${cs.total}</b></div>
            <div class="kv"><span>Seen</span><b>${cs.seen}</b></div>
            <div class="kv"><span>Accuracy</span><b>${cs.acc === null ? '—' : Math.round(cs.acc * 100) + '%'}</b></div>
            <div class="kv"><span>Due now</span><b>${cs.due}</b></div>
            ${best ? `<div class="kv"><span>Best challenge</span><b>${best}%</b></div>` : ''}
          </div>
        </div>
        ${tierBar(cs.tiers, cs.total)}
        <div class="tier-legend">${Store.TIERS.map((t, i) => `<span><i class="t${i}"></i>${t} ${cs.tiers[i]}</span>`).join('')}</div>
      </section>
      <h2 class="sec-h">Study this chapter</h2>
      <div class="mode-grid">${Modes.list.filter(m => m.chapter !== false).map(m => `
        <button class="mode card" data-mode="${m.id}" style="--h:${m.hue}"><span class="m-ic">${m.ic}</span><b>${m.name}</b><small>${m.short}</small></button>`).join('')}</div>
      <h2 class="sec-h">Questions <span class="muted small">(tap to preview)</span></h2>
      <div class="q-list">${ch.ids.map(id => { const q = Q[id], t = Store.tier(id); return `
        <details class="q-prev"><summary><span class="tdot t${t}" title="${Store.TIERS[t]}"></span><span class="qn">Q${q.n}</span><span class="grow">${q.s}</span>${S().flags[id] ? '⭐' : ''}</summary>
        <ol class="opts-prev">${q.o.map((o, i) => `<li class="${i === q.a ? 'ok' : ''}"><b>${L(i)}.</b> ${o}</li>`).join('')}</ol>
        <div class="src">${q.r ? '📖 ' + esc(q.r) : ''}</div>${q.x ? `<div class="note">ℹ️ ${esc(q.x)}</div>` : ''}</details>`; }).join('')}</div>`;
    $$('[data-mode]').forEach(b => b.onclick = () => Modes.start(b.dataset.mode, { chapters: [n], fromChapter: n }));
  };

  // ---------- study hub & games ----------
  routes.study = () => {
    view().innerHTML = `<div class="page-head"><h1>Study modes</h1><p class="muted">Built on retrieval practice, spaced repetition, interleaving and confidence calibration — the techniques with the strongest evidence for long-term retention.</p></div>
      <div class="mode-list">${Modes.list.filter(m => m.kind === 'study').map(modeRow).join('')}</div>`;
    bindModeRows();
  };
  routes.games = () => {
    view().innerHTML = `<div class="page-head"><h1>Games</h1><p class="muted">Same verified questions, more adrenaline. Every answer still feeds your spaced-repetition schedule.</p></div>
      <div class="mode-list">${Modes.list.filter(m => m.kind === 'game').map(modeRow).join('')}</div>`;
    bindModeRows();
  };
  function modeRow(m) {
    const best = S().best[m.id];
    return `<button class="mode-row card" data-mode="${m.id}" style="--h:${m.hue}"><span class="m-ic">${m.ic}</span><div class="grow"><b>${m.name}</b><div class="muted small">${m.desc}</div>${best ? `<span class="pill">🏆 Best: ${best}${m.bestUnit || ''}</span>` : ''}</div><span class="chev">›</span></button>`;
  }
  function bindModeRows() { $$('[data-mode]').forEach(b => b.onclick = () => Modes.setup(b.dataset.mode)); }

  // ---------- search ----------
  routes.search = (arg) => {
    view().innerHTML = `<div class="page-head"><h1>Search the bank</h1><input class="search" id="sq" placeholder="e.g. asterion, Simpson grade, Wartenberg…" value="${esc(arg || '')}" autocomplete="off"></div><div id="sres"></div>`;
    const run = () => {
      const q = $('#sq').value.trim().toLowerCase();
      if (q.length < 2) { $('#sres').innerHTML = '<p class="muted center">Type at least 2 letters.</p>'; return; }
      const res = [];
      for (const id of ALL) {
        const x = Q[id]; const hay = (strip(x.s) + ' ' + x.o.map(strip).join(' ')).toLowerCase();
        if (hay.includes(q)) { res.push(x); if (res.length >= 60) break; }
      }
      const hl = s => s.replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'gi'), '<mark>$1</mark>');
      $('#sres').innerHTML = `<p class="muted small">${res.length >= 60 ? '60+' : res.length} matches</p>` + res.map(x => `
        <div class="card s-item"><div class="muted small"><a href="#/ch/${x.ch}">${esc(chTitle(x.ch))}</a> · Q${x.n}</div><div class="s-stem">${hl(x.s)}</div>
        <div class="s-ans">✅ ${L(x.a)}. ${hl(x.o[x.a])}</div></div>`).join('');
    };
    $('#sq').oninput = run; run(); $('#sq').focus();
  };

  // ---------- stats ----------
  routes.stats = () => {
    const st = S(), tiers = Store.globalTiers(), lv = Store.levelInfo();
    const days = Object.keys(st.daily).sort();
    const seriesT = [{ name: 'Struggling', cls: 's1' }, { name: 'Learning', cls: 's2' }, { name: 'Known', cls: 's3' }, { name: 'Mastered', cls: 's4' }];
    const totalAns = st.log.length, totalC = st.log.filter(l => l[2]).length;
    const totalTime = Object.values(st.daily).reduce((a, d) => a + (d.t || 0), 0);
    const nowR = ALL.reduce((a, id) => a + FSRS.currentR(st.cards[id]), 0);
    view().innerHTML = `
      <div class="page-head"><h1>Statistics</h1><p class="muted">Your knowledge growth, retention and habits — all computed on this device.</p></div>
      <section class="stats-strip">
        <div class="stat card"><small>Answers</small><b data-count="${totalAns}">0</b><span class="muted small">${totalAns ? Math.round(totalC / totalAns * 100) : 0}% correct</span></div>
        <div class="stat card"><small>Study time</small><b>${fmtMs(totalTime)}</b><span class="muted small">${days.length} active days</span></div>
        <div class="stat card"><small>Best streak</small><b>${Store.bestStreak()}🔥</b><span class="muted small">current ${Store.streak()}</span></div>
        <div class="stat card"><small>Expected recall now</small><b>${Math.round(nowR)}</b><span class="muted small">questions you'd likely get right today</span></div>
      </section>
      <section class="card"><h2>📈 Knowledge growth</h2><p class="muted small">How many of the ${ALL.length} questions sit in each memory stage, day by day. Known = memory stable ≥ 4 days; Mastered ≥ 21 days.</p><div id="cGrowth"></div></section>
      <div class="grid2">
        <section class="card"><h2>🧠 Mastery breakdown</h2><div class="donut-wrap"><div id="cDonut"></div><div class="tier-legend col">${Store.TIERS.map((t, i) => `<span><i class="t${i}"></i>${t}<b>${tiers[i]}</b></span>`).join('')}</div></div></section>
        <section class="card"><h2>🗓️ Review forecast</h2><p class="muted small">Questions coming due over the next 14 days.</p><div id="cFore"></div></section>
      </div>
      <section class="card"><h2>🎯 Daily accuracy</h2><div id="cAcc"></div></section>
      <section class="card"><h2>🔥 Activity</h2><div id="cHeat" class="scroll-x"></div></section>
      <div class="grid2">
        <section class="card"><h2>🕸️ Mastery by part</h2><div id="cRadar"></div></section>
        <section class="card"><h2>🎚️ Confidence calibration</h2><p class="muted small">From Confidence mode: how often you're right when you say Guess / Likely / Sure. Well-calibrated learners score ≈33% / 67% / 95%+.</p><div id="cCal"></div></section>
      </div>
      <section class="card"><h2>📚 Chapter table</h2><div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Chapter</th><th>Seen</th><th>Acc.</th><th>Mastery</th><th>Due</th></tr></thead><tbody>
        ${D.chapters.map(c => { const cs = Store.chapterStats(c.n); return `<tr><td>${c.n}</td><td><a href="#/ch/${c.n}">${c.t}</a></td><td>${cs.seen}/${cs.total}</td><td>${cs.acc === null ? '—' : Math.round(cs.acc * 100) + '%'}</td><td><div class="mini"><i style="width:${cs.mastery * 100}%"></i></div></td><td>${cs.due || ''}</td></tr>`; }).join('')}
      </tbody></table></div></section>
      <section class="card"><h2>😈 Toughest questions</h2><p class="muted small">Most missed — revisit them in the Mistakes Vault.</p><div id="tough"></div></section>
      <section class="card"><h2>🏅 Achievements <span class="muted small">${Object.keys(st.ach).length}/${ACH.length}</span></h2><div class="ach-grid">${ACH.map(a => `<div class="ach ${st.ach[a.id] ? 'got' : ''}" data-tip="${esc(a.d)}${st.ach[a.id] ? '\nUnlocked ' + new Date(st.ach[a.id]).toLocaleDateString() : ''}"><span>${a.ic}</span><small>${a.n}</small></div>`).join('')}</div></section>
      <section class="card"><h2>🧾 Recent sessions</h2>${st.sessions.slice(-12).reverse().map(s => `<div class="list-item"><span class="grow"><b>${esc(s.name || s.mode)}</b><br><small class="muted">${new Date(s.ts).toLocaleString()}${s.scope ? ' · ' + esc(s.scope) : ''}</small></span><b>${s.score !== undefined ? s.score + (s.total ? '/' + s.total : '') : ''}</b></div>`).join('') || '<p class="muted">No sessions yet.</p>'}</section>
      <p class="muted small center">Level ${lv.lvl} · ${lv.rank} · ${st.xp.toLocaleString()} XP</p>`;
    $$('[data-count]').forEach(el => FX.countUp(el, +el.dataset.count, 900, v => Math.round(v).toLocaleString()));
    // growth: fill gaps between snapshot days
    const growth = [];
    if (days.length) {
      let last = [ALL.length, 0, 0, 0, 0];
      const start = new Date(days[0] + 'T00:00'), end = new Date(Store.today() + 'T00:00');
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const k = Store.today(d.getTime());
        if (st.daily[k] && st.daily[k].m) last = st.daily[k].m;
        growth.push({ d: k, vals: last.slice(1) });
      }
      growth[growth.length - 1].vals = tiers.slice(1);
    }
    Charts.stackedArea($('#cGrowth'), growth.slice(-90), seriesT, { label: 'Knowledge growth' });
    Charts.donut($('#cDonut'), tiers, [{ name: 'New', cls: 's0' }].concat(seriesT), [Math.round((tiers[3] + tiers[4]) / ALL.length * 100) + '%', 'known+']);
    const fore = []; const now = Date.now();
    for (let i = 0; i < 14; i++) fore.push({ label: i === 0 ? 'Now' : '+' + i + 'd', v: 0 });
    ALL.forEach(id => { const c = st.cards[id]; if (c && c.reps) { const dd = Math.max(0, Math.ceil((c.due - now) / 86400000)); if (dd < 14) fore[dd].v++; } });
    fore.forEach((f, i) => f.tip = `${i === 0 ? 'Due now' : new Date(now + i * 86400000).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${f.v} questions`);
    Charts.bars($('#cFore'), fore, { label: 'Review forecast' });
    Charts.accuracyTrend($('#cAcc'), days.slice(-30).map(d => Object.assign({ d }, st.daily[d])));
    Charts.heatmap($('#cHeat'), st.daily, innerWidth < 600 ? 17 : 26);
    Charts.radar($('#cRadar'), D.parts.map((p, pi) => {
      const chs = D.chapters.filter(c => c.p === pi); let m = 0, t = 0;
      chs.forEach(c => { const cs = Store.chapterStats(c.n); m += cs.mastery * cs.total; t += cs.total; });
      return { short: PART_SHORT[pi], v: m / t, tip: `${p}\nMastery ${Math.round(m / t * 100)}%` };
    }));
    const cal = [1, 2, 3].map(k => { const ls = st.log.filter(l => l[5] === k); return { label: ['Guess', 'Likely', 'Sure'][k - 1], v: ls.length ? Math.round(ls.filter(l => l[2]).length / ls.length * 100) : 0, n: ls.length }; });
    if (cal.some(c => c.n)) Charts.bars($('#cCal'), cal.map(c => ({ label: c.label, v: c.v, tip: `${c.label}: ${c.v}% correct (${c.n} answers)` })), { label: 'Calibration', h: 180 });
    else $('#cCal').innerHTML = '<div class="chart-empty">🎚️ Play Confidence mode to see your calibration.</div>';
    const tough = ALL.filter(id => st.cards[id] && st.cards[id].w).sort((a, b) => (st.cards[b].w - (st.cards[b].c || 0) * 0.5) - (st.cards[a].w - (st.cards[a].c || 0) * 0.5)).slice(0, 8);
    $('#tough').innerHTML = tough.map(id => `<details class="q-prev"><summary><span class="pill bad">✗${st.cards[id].w}</span><span class="grow">${Q[id].s}</span></summary><div class="s-ans">✅ ${L(Q[id].a)}. ${Q[id].o[Q[id].a]}</div><div class="muted small">${esc(chTitle(Q[id].ch))}</div></details>`).join('') || '<p class="muted">Nothing missed yet. 💪</p>';
  };

  // ---------- settings ----------
  routes.settings = () => {
    const st = S(), set = st.settings;
    const kb = (Store.storageBytes() / 1024).toFixed(0);
    view().innerHTML = `
      <div class="page-head"><h1>Settings</h1></div>
      <section class="card">
        <h2>💾 Backup &amp; restore</h2>
        <p class="muted small">Your progress is saved <b>only in this browser</b> (${kb} KB). Clearing site data, private mode or reinstalling the browser can erase it. Export a backup regularly to your phone's Files / Drive and restore it here to resume exactly where you left off.</p>
        <div class="kv"><span>Last backup</span><b>${st.lastBackup ? new Date(st.lastBackup).toLocaleString() : 'Never'}</b></div>
        <div class="kv"><span>Answers since backup</span><b>${st.sinceBackup}</b></div>
        <div class="kv"><span>Persistent storage</span><b id="persist">checking…</b></div>
        <div class="row gap wrap mt"><button class="btn" id="exp">⬇️ Export backup</button><button class="btn ghost" id="imp">⬆️ Restore from file</button></div>
      </section>
      <section class="card" id="xpack">
        <h2>📖 Greenberg explanation pack</h2>
        <p class="muted small">Load the explanation pack file (<b>.tspack</b>) once. It adds the verbatim Greenberg 10th ed. passages, tables and figures behind each answer. It is stored <b>only on this device</b> and never uploaded. If the browser data is cleared, just load the file again.</p>
        <div id="xpStatus" class="muted small">Checking…</div>
        <div class="row gap wrap mt"><button class="btn" id="xpLoad">📂 Load pack file</button><button class="btn ghost" id="xpDel" hidden>Remove pack</button></div>
      </section>
      <section class="card">
        <h2>👤 Profile &amp; goals</h2>
        <label class="field"><span>Your name</span><input id="nm" value="${esc(set.name)}" placeholder="Doctor…"></label>
        <label class="field"><span>Daily goal: <b id="gv">${set.goal}</b> questions</span><input type="range" id="goal" min="10" max="200" step="5" value="${set.goal}"></label>
        <label class="field"><span>Exam simulator: <b id="ev">${set.examSecs}</b> seconds / question</span><input type="range" id="exs" min="30" max="150" step="6" value="${set.examSecs}"></label>
      </section>
      <section class="card">
        <h2>🎛️ Experience</h2>
        <div class="field"><span>Theme</span><div class="seg" id="theme">${['auto', 'light', 'dark'].map(t => `<button data-v="${t}" class="${set.theme === t ? 'on' : ''}">${t === 'auto' ? '🌗 Auto' : t === 'light' ? '☀️ Light' : '🌙 Dark'}</button>`).join('')}</div></div>
        ${toggle('sound', '🔊 Sound effects', set.sound)}
        ${toggle('haptics', '📳 Vibration feedback', set.haptics)}
        ${toggle('shuffleOpts', '🔀 Shuffle answer options (questions with “All of the above”, “Both A and B”… are never shuffled)', set.shuffleOpts)}
        ${toggle('recallFirst', '🤔 Recall-first: hide options until you try to recall the answer (generation effect)', set.recallFirst)}
      </section>
      <section class="card">
        <h2>📲 Install as an app</h2>
        <p class="muted small">Install TOP SCORE to your home screen — it works fully offline.</p>
        <button class="btn" id="inst" ${App.installEvt ? '' : 'disabled'}>Install app</button>
        <p class="muted small mt">iPhone/iPad: open in Safari → Share → <b>Add to Home Screen</b>. Android: Chrome menu → <b>Install app</b>.</p>
      </section>
      <section class="card">
        <h2>ℹ️ About the data</h2>
        <p class="muted small">All ${ALL.length} questions and answer keys come strictly from <i>${esc(D.source)}</i>. Each key was verified by matching the printed answer letter against the printed answer text, and cross-checked with two independent PDF extraction engines. Where the book itself is internally inconsistent, the question shows an ℹ️ note explaining which option is used.</p>
      </section>
      <section class="card danger-zone"><h2>⚠️ Danger zone</h2><button class="btn danger" id="rst">Reset all progress</button></section>`;
    $('#exp').onclick = doExport; $('#imp').onclick = doImport;
    packUI();
    $('#nm').onchange = e => { set.name = e.target.value.trim(); Store.save(); };
    $('#goal').oninput = e => { set.goal = +e.target.value; $('#gv').textContent = set.goal; Store.save(); };
    $('#exs').oninput = e => { set.examSecs = +e.target.value; $('#ev').textContent = set.examSecs; Store.save(); };
    $$('#theme button').forEach(b => b.onclick = () => { set.theme = b.dataset.v; Store.save(); applyTheme(); $$('#theme button').forEach(x => x.classList.toggle('on', x === b)); });
    $$('[data-tg]').forEach(i => i.onchange = () => { set[i.dataset.tg] = i.checked; Store.save(); FX.play('tap'); });
    $('#inst').onclick = async () => { if (App.installEvt) { App.installEvt.prompt(); await App.installEvt.userChoice; App.installEvt = null; $('#inst').disabled = true; } };
    $('#rst').onclick = async () => {
      if (await confirmBox('Reset everything?', 'This erases all progress on this device. Export a backup first if you might want it back.', 'Erase')) { Store.reset(); applyTheme(); toast('Progress reset'); go('#/'); }
    };
    if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(p => $('#persist').textContent = p ? 'Granted ✅' : 'Not granted (backup advised)');
    else $('#persist').textContent = 'Unsupported';
  };
  async function packUI() {
    await Explain.ready;
    const i = Explain.info(), st = $('#xpStatus'); if (!st) return;
    if (i) {
      const c = i.counts || {};
      st.innerHTML = `<div class="kv"><span>Status</span><b>Loaded ✅</b></div><div class="kv"><span>Verified explanations</span><b>${c.V || 0}</b></div><div class="kv"><span>Related reading</span><b>${c.R || 0}</b></div><div class="kv"><span>Differs from key</span><b>${c.C || 0}</b></div><div class="kv"><span>Figures &amp; tables</span><b>${c.images || 0}</b></div><div class="kv"><span>Size</span><b>${(i.size / 1048576).toFixed(1)} MB</b></div><div class="kv"><span>Built</span><b>${esc(i.built || '')}</b></div>`;
      $('#xpDel').hidden = false; $('#xpLoad').textContent = '📂 Replace pack file';
    } else { st.textContent = 'Not loaded. Answers show the key and the Greenberg page number only.'; $('#xpDel').hidden = true; }
    $('#xpLoad').onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file';
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        st.textContent = 'Loading pack… (large file, please wait)';
        try { await Explain.load(f); toast('📖 Explanation pack loaded'); FX.play('win'); FX.confetti(); packUI(); }
        catch (e) { st.textContent = '⚠️ ' + (e.message || 'Could not load the file.'); }
      };
      inp.click();
    };
    $('#xpDel').onclick = async () => { if (await confirmBox('Remove the explanation pack?', 'Your progress is not affected. You can load the file again any time.', 'Remove')) { await Explain.remove(); toast('Pack removed'); packUI(); } };
  }
  const toggle = (k, label, on) => `<label class="switch-row"><span>${label}</span><input type="checkbox" data-tg="${k}" ${on ? 'checked' : ''}><i class="switch"></i></label>`;

  // ---------- achievements ----------
  const ACH = [
    { id: 'first', ic: '🌱', n: 'First Step', d: 'Answer your first question' },
    { id: 'a100', ic: '💯', n: 'Century', d: 'Answer 100 questions' },
    { id: 'a500', ic: '📚', n: 'Bookworm', d: 'Answer 500 questions' },
    { id: 'a2000', ic: '🏛️', n: 'Marathoner', d: 'Answer 2,000 questions' },
    { id: 'allseen', ic: '🌍', n: 'Whole Book', d: 'See every question in the book at least once' },
    { id: 'allch', ic: '🗺️', n: 'Explorer', d: 'Answer at least one question in every chapter' },
    { id: 'm100', ic: '🧠', n: 'Neural Pathways', d: 'Reach Known/Mastered on 100 questions' },
    { id: 'm1000', ic: '🧬', n: 'Long-Term Potentiation', d: 'Reach Known/Mastered on 1,000 questions' },
    { id: 'mast50', ic: '💎', n: 'Diamond Memory', d: 'Fully master 50 questions (stable ≥ 21 days)' },
    { id: 's3', ic: '🔥', n: 'On Fire', d: '3-day streak' },
    { id: 's7', ic: '📆', n: 'Week Warrior', d: '7-day streak' },
    { id: 's30', ic: '🏆', n: 'Unstoppable', d: '30-day streak' },
    { id: 'perfect', ic: '✨', n: 'Flawless', d: 'Score 100% on a full-chapter MCQ Challenge' },
    { id: 'exam80', ic: '🎓', n: 'Board Ready', d: 'Score ≥ 80% on an Exam Simulation of 50+ questions' },
    { id: 'combo15', ic: '⚡', n: 'Combo Master', d: 'Hit a 15× combo' },
    { id: 'blitz20', ic: '🚀', n: 'Speed Demon', d: '20 correct in one Speed Blitz' },
    { id: 'surv25', ic: '❤️‍🔥', n: 'Survivor', d: 'Survive 25 questions in Survival' },
    { id: 'boss', ic: '🐉', n: 'Dragon Slayer', d: 'Defeat a chapter boss' },
    { id: 'match', ic: '🧩', n: 'Matchmaker', d: 'Clear a Match Pairs board without mistakes' },
    { id: 'ko', ic: '🥊', n: 'Knockout Artist', d: 'Win a Knockout round with no knock-downs' },
    { id: 'calib', ic: '🎚️', n: 'Self-Aware', d: 'Answer 20 “Sure” questions in Confidence mode with ≥ 90% accuracy' },
    { id: 'night', ic: '🦉', n: 'Night Owl', d: 'Study after midnight' },
    { id: 'early', ic: '🌅', n: 'Early Bird', d: 'Study before 7 AM' },
    { id: 'goal', ic: '🎯', n: 'Goal Getter', d: 'Hit your daily goal' },
    { id: 'lvl10', ic: '👑', n: 'Rising Star', d: 'Reach level 10' },
    { id: 'backup', ic: '💾', n: 'Safe Keeper', d: 'Export your first backup' }
  ];
  function unlock(id) {
    const st = S(); if (st.ach[id]) return;
    const a = ACH.find(x => x.id === id); if (!a) return;
    st.ach[id] = Date.now(); Store.save();
    toast(`<span class="ach-toast"><span>${a.ic}</span><span><b>Achievement unlocked</b><br>${a.n}</span></span>`, 3600);
    FX.play('level'); FX.buzz([30, 40, 30]);
  }
  function checkAch(ctx = {}) {
    const st = S(), n = st.log.length;
    if (n >= 1) unlock('first'); if (n >= 100) unlock('a100'); if (n >= 500) unlock('a500'); if (n >= 2000) unlock('a2000');
    const t = Store.globalTiers();
    if (t[0] === 0) unlock('allseen');
    if (t[3] + t[4] >= 100) unlock('m100'); if (t[3] + t[4] >= 1000) unlock('m1000'); if (t[4] >= 50) unlock('mast50');
    const s = Store.streak(); if (s >= 3) unlock('s3'); if (s >= 7) unlock('s7'); if (s >= 30) unlock('s30');
    const h = new Date().getHours(); if (h < 4) unlock('night'); if (h >= 4 && h < 7) unlock('early');
    if (Store.day().a >= st.settings.goal) unlock('goal');
    if (Store.levelInfo().lvl >= 10) unlock('lvl10');
    if (ctx.combo >= 15) unlock('combo15');
    if (n % 25 === 0 && D.chapters.every(c => c.ids.some(id => st.cards[id]))) unlock('allch');
    if (ctx.calib) { const sure = st.log.filter(l => l[5] === 3); if (sure.length >= 20 && sure.filter(l => l[2]).length / sure.length >= 0.9) unlock('calib'); }
  }

  // ---------- level up / theme / install ----------
  function levelUp(lvl) {
    const lv = Store.levelInfo();
    setTimeout(() => {
      FX.confetti(200); FX.play('level'); FX.buzz([40, 60, 40, 60, 80]);
      modal(`<div class="lvlup"><div class="lvl-badge xl">${lvl}</div><h2>Level up!</h2><p>You are now <b>${lv.rank}</b>.</p><button class="btn" onclick="this.closest('.modal-wrap').close()">Keep going</button></div>`, { cls: 'center-modal' });
    }, 500);
  }
  function applyTheme() {
    const t = S().settings.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    $('meta[name=theme-color]').setAttribute('content', dark ? '#0b0a14' : '#f6f5fb');
  }

  window.App = {
    $, $$, esc, strip, shuffle, L, toast, modal, confirmBox, ring, animateRings, go, render, fmtMs, fmtIvl, chTitle,
    unlock, checkAch, levelUp, doExport, needBackup, installEvt: null,
    setLeaveGuard(fn) { leaveGuard = fn; }, routes, applyTheme
  };

  // ---------- boot ----------
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    FX.neural($('#bg'));
    Charts.tip();
    $('#themeBtn').onclick = () => {
      const s = S().settings; const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
      s.theme = dark ? 'light' : 'dark'; Store.save(); applyTheme(); FX.play('tap');
    };
    render();
    // request persistent storage on first interaction (reduces chance of eviction)
    const askPersist = () => { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); removeEventListener('pointerdown', askPersist); };
    addEventListener('pointerdown', askPersist);
    if (!S().log.length && !S().seenIntro) {
      S().seenIntro = 1; Store.save();
      setTimeout(() => modal(`<div class="intro"><div class="intro-logo">🧠</div><h2>Welcome to TOP SCORE</h2>
        <p>${ALL.length.toLocaleString()} board-style MCQs, taken straight from the book with every answer key verified.</p>
        <ul class="intro-list"><li>🧠 <b>Smart Review</b> schedules each question right before you'd forget it (FSRS).</li><li>🎯 <b>MCQ Challenge</b> exams you, scores you, then retries your misses.</li><li>🎮 <b>Games</b>: Blitz, Survival, Boss battles and more.</li><li>💾 Progress is saved on this device. <b>Export a backup often</b> (Settings) so a cleared browser can't erase it.</li></ul>
        <button class="btn block" onclick="this.closest('.modal-wrap').close()">Let's start</button></div>`, { cls: 'center-modal' }), 400);
    }
  });
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); App.installEvt = e; });
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing; nw && nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('✨ Update ready — <a href="#" onclick="location.reload();return false">reload</a>', 8000); });
    });
  }).catch(() => { }));
})();
