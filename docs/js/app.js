/* TOP SCORE — core: router, bookshelf, book & chapter pages, study hub, stats, settings, backup, achievements. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const strip = s => String(s).replace(/<[^>]+>/g, '');
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };
  const L = i => 'ABCDEFGHIJKL'[i];
  const { Q, CH } = Store;
  const S = () => Store.S;
  const view = () => $('#view');
  const pct = v => Math.round((v || 0) * 100) + '%';

  // ---------- book helpers ----------
  const bookId = () => Books.current();
  const book = (bid = bookId()) => Books.get(bid) || Books.get('ts');
  const chKeys = (bid = bookId()) => (Store.BK[bid] ? Store.BK[bid].chs : []);
  const bookOfCh = key => Books.get(CH[key] ? CH[key].bid : 'ts');
  function chTitle(key) {
    const c = CH[key]; if (!c) return String(key);
    return `${c.bid === 'ts' ? '' : esc(book(c.bid).short) + ' · '}${c.n}. ${strip(c.t)}`;
  }
  const chShort = key => { const c = CH[key]; return c ? (c.bid === 'ts' ? 'Ch ' + c.n : book(c.bid).short + ' ' + c.n) : ''; };
  const qLabel = q => `${chShort(q.ch)} · Q${q.n}`;
  const correctSet = q => Store.answers(q);
  const isRight = (q, i) => correctSet(q).includes(i);
  const optText = (q, i) => q.lab ? `Label <b>${esc(strip(q.o[i]))}</b>` : q.o[i];
  const keyText = q => q.nk ? 'No answer key printed in the book' : (q.k || correctSet(q).map(i => L(i) + '. ' + q.o[i]).join(' · '));
  const keyLetters = q => correctSet(q).map(L).join(', ');

  /* stem block: group instruction, stem text, figures, credit */
  function stemHTML(q, opts = {}) {
    const imgs = (q.img || []).map(im => `<button class="qimg" data-bid="${q.bid}" data-src="${esc(im[0])}" aria-label="Zoom figure"><img loading="lazy" src="${Books.url(q.bid, im[0])}" width="${im[1]}" height="${im[2]}" alt="Figure"></button>`).join('');
    return `${q.g ? `<div class="qgroup">${q.g}</div>` : ''}<div class="stem">${q.s || ''}${Store.multi(q) ? ' <span class="pill multi">Select all that apply</span>' : ''}${q.nk ? ' <span class="pill">Practice · no key in book</span>' : ''}</div>
      ${imgs ? `<div class="qimgs">${imgs}</div>` : ''}${q.cr && imgs && !opts.noCredit ? `<div class="credit">${esc(q.cr)}</div>` : ''}`;
  }
  /* the book's own explanation (pack books) */
  function bookExpHTML(q, open) {
    const e = q.e || [], ei = q.eimg || [];
    const refs = Array.isArray(q.r) ? q.r : [];
    if (!e.length && !ei.length && !refs.length) return '';
    return `<details class="bexp" ${open ? 'open' : ''}><summary><span>📘 ${esc(book(q.bid).short)} explains</span></summary><div class="bexp-body">
      ${e.map(p => `<p>${p}</p>`).join('')}
      ${ei.length ? `<div class="qimgs">${ei.map(im => `<button class="qimg" data-bid="${q.bid}" data-src="${esc(im[0])}"><img loading="lazy" src="${Books.url(q.bid, im[0])}" width="${im[1]}" height="${im[2]}" alt="Figure"></button>`).join('')}</div>` : ''}
      ${refs.map(r => `<div class="src">📖 ${r}</div>`).join('')}</div></details>`;
  }
  const refLine = q => (q.r && !Array.isArray(q.r)) ? `<div class="src">📖 ${esc(q.r)}</div>` : '';
  const noteLine = q => q.x ? `<div class="note">ℹ️ ${esc(q.x)}</div>` : '';
  function optsPrev(q, mine) {
    const ms = mine === undefined || mine === null ? [] : (Array.isArray(mine) ? mine : [mine]);
    return `<ol class="opts-prev">${q.o.map((o, i) => `<li class="${isRight(q, i) ? 'ok' : ''} ${ms.includes(i) && !isRight(q, i) ? 'no' : ''}"><b>${L(i)}.</b> ${optText(q, i)}${ms.includes(i) ? ' <small>← your answer</small>' : ''}</li>`).join('')}</ol>`;
  }
  function zoomImg(bid, name) {
    const m = modal(`<div class="xzoom"><img src="${Books.url(bid, name)}" alt=""></div><p class="muted small center">Tap the image to enlarge · ✕ to close</p>`, { cls: 'xzoom-modal' });
    const img = m.querySelector('.xzoom img'); img.onclick = () => img.classList.toggle('big');
  }
  document.addEventListener('click', e => { const b = e.target.closest('.qimg'); if (!b) return; e.preventDefault(); e.stopPropagation(); zoomImg(b.dataset.bid, b.dataset.src); }, true);

  // ---------- UI primitives ----------
  function toast(msg, ms = 2600) {
    const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = msg;
    $('#toasts').appendChild(t); requestAnimationFrame(() => t.classList.add('on'));
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 400); }, ms);
    return t;
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
  function ring(p, size = 54, stroke = 6, label = '') {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/><circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-off="${c * (1 - Math.max(0, Math.min(1, p)))}"/><text x="50%" y="50%" dy=".35em" text-anchor="middle">${label}</text></svg>`;
  }
  function animateRings(root = document) {
    requestAnimationFrame(() => setTimeout(() => {
      $$('.ring-fg', root).forEach(c => c.style.strokeDashoffset = c.dataset.off);
      $$('.pbar i[data-w]', root).forEach(i => i.style.width = i.dataset.w);
    }, 30));
  }
  function tierBar(t, total) {
    return `<div class="tierbar">${t.map((v, i) => v ? `<i class="t${i}" style="width:${v / (total || 1) * 100}%" title="${Store.TIERS[i]}: ${v}"></i>` : '').join('')}</div>`;
  }
  /* progress bar: seen (light) + mastered (solid) */
  const pbar = (st, cls = '') => `<div class="pbar ${cls}" title="${st.seen}/${st.total} done · mastery ${pct(st.mastery)}"><i class="seen" data-w="${st.done * 100}%"></i><i class="mast" data-w="${st.mastery * 100}%"></i></div>`;
  const fmtMs = ms => { const s = Math.round(ms / 1000); return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm'; };
  const fmtIvl = ms => { const m = ms / 60000; if (m < 60) return Math.max(1, Math.round(m)) + 'm'; const h = m / 60; if (h < 24) return Math.round(h) + 'h'; const d = h / 24; if (d < 30) return Math.round(d) + 'd'; if (d < 365) return (d / 30).toFixed(1) + 'mo'; return (d / 365).toFixed(1) + 'y'; };
  const ago = ts => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

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
    if (!Account.me() && path !== 'x') { Account.showAuth(); return; }     // guests may only use the exam page
    document.body.classList.toggle('exam-mode', path === 'x' || (path === 'examroom' && !!arg));
    document.body.classList.toggle('exam-host', path === 'examroom' && !!arg);
    const fn = routes[path || 'home'] || routes.home;
    const navKey = path === 'ch' || path === 'chapters' ? 'book' : ['duel', 'examroom', 'x'].includes(path) ? 'arena' : (path || 'home');
    $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.r === navKey));
    document.body.classList.toggle('playing', path === 'play');
    const v = view();
    if (path !== 'play') v.dataset.sid = '';
    v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
    if (path !== 'play') window.scrollTo(0, 0);
    fn(arg ? decodeURIComponent(arg) : '');
    animateRings(v);
    updateNavBook();
  }
  addEventListener('hashchange', render);
  function updateNavBook() { const a = $('.nav a[data-r="book"]'); if (a) { a.href = '#/book/' + bookId(); const s = $('small', a); if (s) s.textContent = book().short; } }

  // ---------- resume (session + chapter) ----------
  function resumeCard() {
    const r = window.Modes && Modes.resume.get(); if (!r) return '';
    return `<section class="card resume-card pop-in"><div class="rc-ic">▶️</div><div class="grow"><div class="eyebrow">Continue where you left off</div><b>${esc(r.label)}</b><div class="muted small">${esc(r.prog || '')} · ${ago(r.ts)}</div></div>
      <div class="rc-btns"><button class="btn" data-resume>Resume</button><button class="icon-btn" data-resume-x aria-label="Discard saved session">✕</button></div></section>`;
  }
  function resumeNow() { if (!Modes.resume.run()) toast('That session can no longer be resumed.'); }
  async function discardResume(el) {
    if (await confirmBox('Discard the saved session?', 'Answers you already gave stay recorded in your progress.', 'Discard', 'Keep')) { Modes.resume.clear(); el && el.remove(); toast('Saved session discarded'); }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-resume],[data-resume-x],[data-chres],[data-chres-x],[data-chnext]'); if (!b) return;
    e.preventDefault();
    if (b.hasAttribute('data-resume')) resumeNow();
    else if (b.hasAttribute('data-resume-x')) discardResume(b.closest('.resume-card'));
    else if (b.hasAttribute('data-chres')) { if (!Modes.resume.runChapter(b.dataset.chres)) toast('That chapter session can no longer be resumed.'); }
    else if (b.hasAttribute('data-chres-x')) discardChapter(b.dataset.chresX);
    else if (b.hasAttribute('data-chnext')) continueChapter(b.dataset.chnext);
  });
  async function discardChapter(key) {
    if (await confirmBox('Forget this chapter session?', 'Your answers stay recorded; only the saved position is removed.', 'Forget', 'Keep')) { Modes.resume.clearChapter(key); render(); }
  }
  /* continue a partly finished chapter: saved chapter session if any, else the unseen questions in book order */
  function continueChapter(key) {
    if (Modes.resume.chapter(key)) return Modes.resume.runChapter(key);
    const left = CH[key].keyed.filter(id => !S().cards[id]);
    if (!left.length) return Modes.start('challenge', { chapters: [key] });
    Modes.start('challenge', { chapters: [key], filter: 'new', fromChapter: key });
  }
  function chapterProgressChip(key) {
    const s = Modes.resume.chapter(key);
    if (s) return `<button class="chip go" data-chres="${esc(key)}">▶ Continue · ${esc(s.prog || '')}</button>`;
    const st = Store.chapterStats(key);
    if (st.seen > 0 && st.seen < st.total) return `<button class="chip" data-chnext="${esc(key)}">▶ ${st.total - st.seen} left</button>`;
    return '';
  }
  function chapterResumeList(bid, max = 4) {
    const all = Modes.resume.chapters().filter(x => CH[x.key] && (!bid || CH[x.key].bid === bid)).sort((a, b) => b.s.ts - a.s.ts).slice(0, max);
    if (!all.length) return '';
    return `<section class="card"><h2>📍 Chapters in progress</h2>${all.map(({ key, s }) => `
      <div class="list-item"><span class="grow"><b>${chTitle(key)}</b><br><small class="muted">${esc(s.label.split(' · ')[0])} · ${esc(s.prog || '')} · ${ago(s.ts)}</small></span>
      <button class="btn sm" data-chres="${esc(key)}">Continue</button><button class="icon-btn" data-chres-x="${esc(key)}" aria-label="Forget">✕</button></div>`).join('')}</section>`;
  }
  function resumePrompt() {
    const r = Modes.resume.get(); if (!r || location.hash.startsWith('#/play')) return;
    const m = modal(`<div class="center"><div class="intro-logo">▶️</div><h3>Resume your last session?</h3>
      <p><b>${esc(r.label)}</b></p><p class="muted small">${esc(r.prog || '')} · saved ${ago(r.ts)}</p>
      <div class="row gap center-row wrap"><button class="btn ghost" id="rsLater">Not now</button><button class="btn" id="rsGo">▶️ Resume</button></div>
      <button class="link-btn muted small" id="rsDrop">Discard it</button></div>`, { cls: 'center-modal' });
    $('#rsGo', m).onclick = () => { m.close(); resumeNow(); };
    $('#rsLater', m).onclick = () => m.close();
    $('#rsDrop', m).onclick = () => { m.close(); Modes.resume.clear(); const c = $('.resume-card'); c && c.remove(); toast('Saved session discarded'); };
  }

  // ---------- home: bookshelf ----------
  function bookTile(b, i) {
    const st = Store.bookStats(b.id), cur = b.id === bookId();
    return `<a class="book-tile ${cur ? 'cur' : ''}" href="#/book/${b.id}" style="--bc:${b.color || '#6d4cff'};--d:${i * 70}ms">
      ${(() => { const cv = Books.cover(b.id); return cv
        ? `<div class="cover has-img"><img src="${cv}" alt="${esc(b.title)} cover" loading="lazy"><span class="spine"></span>${st.due ? `<span class="b-due">${st.due} due</span>` : ''}</div>`
        : `<div class="cover"><span class="spine"></span><span class="b-ic">${b.icon || '📘'}</span><b class="b-t">${esc(b.short)}</b><small class="b-a">${esc(b.authors || '')}${b.year ? ' · ' + b.year : ''}</small>${st.due ? `<span class="b-due">${st.due} due</span>` : ''}</div>`; })()}
      <div class="b-name"><b>${esc(b.short)}</b></div>
      <div class="b-info"><div class="row between small"><b>${pct(st.done)}</b><span class="muted">${st.seen}/${st.total}</span></div>${pbar(st)}
        <div class="muted small">${b.chapters.length} chapters · mastery ${pct(st.mastery)}</div></div></a>`;
  }
  routes.home = () => {
    const st = S(), lv = Store.levelInfo(), today = Store.day(), streak = Store.streak();
    const goalPct = Math.min(1, today.a / st.settings.goal);
    const hr = new Date().getHours();
    const greet = hr < 5 ? 'Burning the midnight oil' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const books = Books.list();
    const totalQ = books.reduce((a, b) => a + Store.bookStats(b.id).total, 0);
    const b = book(), bs = Store.bookStats(b.id), due = bs.due;
    view().innerHTML = `
      ${backupBanner()}
      ${resumeCard()}
      <section class="hero card glow">
        <div class="hero-top">
          <div>
            <div class="eyebrow">${greet}${st.settings.name ? ', ' + esc(st.settings.name) : ''} 👋</div>
            <h1 class="hero-title">Your <span class="grad">board library</span></h1>
            <div class="muted small">${books.length} book${books.length > 1 ? 's' : ''} · ${totalQ.toLocaleString()} MCQs on this device</div>
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

      <section class="shelf-wrap">
        <div class="row between"><h2>📚 Bookshelf</h2><button class="link-btn" id="addBook">＋ Add book</button></div>
        <div class="shelf">${books.map(bookTile).join('')}
          <button class="book-tile add" id="addBook2"><div class="cover"><span class="b-ic">＋</span><b class="b-t">Add a book</b><small class="b-a">Load a private .tspack file</small></div></button>
        </div>
        <div class="shelf-board"></div>
      </section>

      ${chapterResumeList(null, 4)}

      <section class="grid2">
        <button class="cta card ${due ? 'pulse' : ''}" data-go="smart">
          <div class="cta-ic">🧠</div>
          <div class="grow"><b>Smart Review · ${esc(b.short)}</b><div class="muted small">${due ? `<span class="pill warn">${due} due</span> spaced-repetition queue` : 'Spaced repetition — new + due questions'}</div></div><span class="chev">›</span>
        </button>
        <button class="cta card" data-go="challenge">
          <div class="cta-ic">🎯</div>
          <div class="grow"><b>MCQ Challenge · ${esc(b.short)}</b><div class="muted small">Exam yourself, score, retry misses</div></div><span class="chev">›</span>
        </button>
      </section>

      <section class="stats-strip">
        <div class="stat card"><small>Seen (all books)</small><b data-count="${books.reduce((a, x) => a + Store.bookStats(x.id).seen, 0)}">0</b><span class="muted small">of ${totalQ.toLocaleString()}</span></div>
        <div class="stat card"><small>Known + Mastered</small><b data-count="${(t => t[3] + t[4])(Store.globalTiers())}">0</b><span class="muted small">across your shelf</span></div>
        <div class="stat card"><small>Accuracy (7d)</small><b>${acc7()}</b><span class="muted small">last 7 days</span></div>
        <div class="stat card"><small>Total XP</small><b data-count="${st.xp}">0</b><span class="muted small">${Object.keys(st.ach).length} badges</span></div>
      </section>

      <section class="card">
        <h2>🎮 Quick play · ${esc(b.short)}</h2>
        <div class="quick">
          ${[['blitz', '⚡', 'Speed Blitz'], ['survival', '❤️', 'Survival'], ['tf', '✅', 'True / False'], ['match', '🧩', 'Match Pairs'], ['boss', '🐉', 'Boss Battle'], ['knockout', '🥊', 'Knockout']].map(g => `<button class="q-tile" data-game="${g[0]}"><span>${g[1]}</span>${g[2]}</button>`).join('')}
        </div>
      </section>`;
    $$('[data-count]').forEach(el => FX.countUp(el, +el.dataset.count, 900, v => Math.round(v).toLocaleString()));
    $$('[data-go]').forEach(x => x.onclick = () => Modes.setup(x.dataset.go));
    $$('[data-game]').forEach(x => x.onclick = () => Modes.setup(x.dataset.game));
    $('#addBook').onclick = $('#addBook2').onclick = addPack;
    bindBanner();
  };
  function acc7() {
    let a = 0, c = 0; const now = Date.now();
    for (let i = 0; i < 7; i++) { const d = S().daily[Store.today(now - i * 86400000)]; if (d) { a += d.a; c += d.c; } }
    return a ? Math.round(c / a * 100) + '%' : '—';
  }
  function weakestChapters(bid, n) {
    const arr = chKeys(bid).map(k => Object.assign({ key: k }, Store.chapterStats(k))).filter(x => x.seen > 0);
    arr.sort((a, b) => ((a.acc ?? 0) + a.mastery) - ((b.acc ?? 0) + b.mastery));
    return arr.slice(0, n);
  }

  /* one file picker for every pack: book packs go on the shelf, the Greenberg pack goes to explanations */
  function addPack() {
    const inp = document.createElement('input'); inp.type = 'file';   // no accept filter: iOS greys out unknown extensions
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const busy = modal(`<div class="center"><div class="intro-logo spin">📚</div><h3>Adding ${esc(f.name)}…</h3><p class="muted small">${(f.size / 1048576).toFixed(1)} MB · stored only on this device</p></div>`, { cls: 'center-modal', close: false });
      try {
        const r = await Books.load(f);
        busy.close();
        if (r.kind === 'explain') { toast('📖 Greenberg explanation pack loaded'); FX.play('win'); FX.confetti(); render(); return; }
        Store.syncBooks(); Store.indexBook(r.book);
        Books.setCurrent(r.book.id);
        FX.play('win'); FX.confetti();
        toast(`📚 ${esc(r.book.short)} ${r.replaced ? 'updated' : 'added to your shelf'} — ${Store.BK[r.book.id].ids.length.toLocaleString()} questions`);
        go('#/book/' + r.book.id);
      } catch (e) { busy.close(); toast('⚠️ ' + esc(e.message || 'Could not load the file.'), 4000); }
    };
    inp.click();
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

  // ---------- book page ----------
  routes.chapters = () => go('#/book/' + bookId());
  routes.book = (arg) => {
    const b = Books.get(arg) || book();
    if (b.id !== bookId()) Books.setCurrent(b.id);
    const st = Store.bookStats(b.id);
    const keys = chKeys(b.id);
    const weak = weakestChapters(b.id, 3);
    const multiParts = b.parts.length > 1;
    const nextKey = keys.find(k => { const s = Store.chapterStats(k); return s.seen < s.total; });
    view().innerHTML = `
      <a class="back" href="#/">‹ Bookshelf</a>
      <section class="card glow book-hero" style="--bc:${b.color || '#6d4cff'}">
        ${Books.cover(b.id) ? `<div class="bh-cover has-img"><img src="${Books.cover(b.id)}" alt="${esc(b.title)} cover"></div>` : `<div class="bh-cover"><span class="b-ic">${b.icon || '📘'}</span></div>`}
        <div class="grow">
          <div class="eyebrow">${esc(b.authors || '')}${b.year ? ' · ' + b.year : ''}${b.builtin ? ' · built in' : ' · private pack'}</div>
          <h1>${esc(b.title)}</h1>
          <div class="bh-rings">
            <div>${ring(st.done, 74, 7, pct(st.done))}<small>done</small></div>
            <div>${ring(st.mastery, 74, 7, pct(st.mastery))}<small>mastery</small></div>
            <div class="grow">
              <div class="kv"><span>Questions</span><b>${st.total.toLocaleString()}${st.practice ? ` <small class="muted">+${st.practice} practice</small>` : ''}</b></div>
              <div class="kv"><span>Seen</span><b>${st.seen.toLocaleString()}</b></div>
              <div class="kv"><span>Accuracy</span><b>${st.acc === null ? '—' : pct(st.acc)}</b></div>
              <div class="kv"><span>Due now</span><b>${st.due}</b></div>
            </div>
          </div>
        </div>
        ${tierBar(st.tiers, st.total)}
        <div class="tier-legend">${Store.TIERS.map((t, i) => `<span><i class="t${i}"></i>${t} ${st.tiers[i]}</span>`).join('')}</div>
        <div class="row gap wrap mt">
          <button class="btn" data-bgo="smart">🧠 Smart review${st.due ? ` · ${st.due} due` : ''}</button>
          ${nextKey ? `<button class="btn ghost" data-chnext="${esc(nextKey)}">▶ Continue: ${chShort(nextKey)}</button>` : ''}
          <button class="btn ghost" data-bgo="exam">⏱️ Exam</button>
          <a class="btn ghost" href="#/stats">📊 Stats</a>
        </div>
      </section>
      ${chapterResumeList(b.id, 3)}
      ${st.skipped ? `<section class="card skip-card"><div class="grow"><b>⏭ ${st.skipped} skipped question${st.skipped > 1 ? 's' : ''}</b><div class="muted small">Left out of every mode and of this book's progress. Un-skip one from its chapter, or all at once here.</div></div><button class="btn ghost sm" id="clrSkips">Clear all skips</button></section>` : ''}
      ${weak.length ? `<section class="card"><h2>🎯 Focus next</h2>${weak.map(w => `<a class="list-item" href="#/ch/${encodeURIComponent(w.key)}"><span class="num">${CH[w.key].n}</span><span class="grow">${esc(strip(CH[w.key].t))}<br><small class="muted">${w.acc === null ? 'not started' : pct(w.acc) + ' accuracy'} · ${pct(w.mastery)} mastery</small></span><span class="chev">›</span></a>`).join('')}</section>` : ''}
      <div class="page-head"><div class="row between"><h2>Chapters</h2><span class="muted small">${keys.length} chapters</span></div>
      <input class="search" id="chFilter" placeholder="Filter chapters…" autocomplete="off"></div>
      <div id="chList">${b.parts.map((p, pi) => {
        const ks = keys.filter(k => CH[k].p === pi); if (!ks.length) return '';
        return `<section class="part" data-part="${pi}">${multiParts ? `<h3 class="part-h"><span>${esc(p.split(':')[0])}</span>${esc(p.split(':').slice(1).join(':'))}</h3>` : ''}
        <div class="ch-grid">${ks.map(k => chCard(k)).join('')}</div></section>`;
      }).join('')}</div>`;
    $$('[data-bgo]').forEach(x => x.onclick = () => Modes.setup(x.dataset.bgo));
    if ($('#clrSkips')) $('#clrSkips').onclick = async () => {
      if (await confirmBox('Clear all skips in this book?', `${st.skipped} question${st.skipped > 1 ? 's' : ''} will be asked again in every mode.`, 'Clear skips')) {
        const n = Store.clearSkips(Store.BK[b.id].ids); toast(`⏭ ${n} question${n === 1 ? '' : 's'} un-skipped`); render();
      }
    };
    $('#chFilter').oninput = e => {
      const q = e.target.value.toLowerCase().trim();
      $$('.ch-card').forEach(c => c.style.display = !q || c.dataset.t.includes(q) ? '' : 'none');
      $$('.part').forEach(p => p.style.display = $$('.ch-card', p).some(c => c.style.display !== 'none') ? '' : 'none');
    };
  };
  function chCard(k) {
    const c = CH[k], cs = Store.chapterStats(k);
    const chip = chapterProgressChip(k);
    return `<a class="ch-card card" href="#/ch/${encodeURIComponent(k)}" data-t="${esc(strip(c.t).toLowerCase())} ${c.n}">
      ${ring(cs.done, 50, 5, pct(cs.done))}
      <div class="grow"><div class="ch-t"><span class="num">${c.n}</span>${c.t}</div>
      <div class="muted small">${cs.total} MCQs${cs.practice ? ' +' + cs.practice + ' practice' : ''} · ${cs.seen} seen${cs.acc !== null ? ' · ' + pct(cs.acc) + ' acc' : ''} · mastery ${pct(cs.mastery)}${cs.due ? ` · <span class="pill warn">${cs.due} due</span>` : ''}</div>
      ${pbar(cs, 'thin')}${chip || cs.skipped ? `<div class="mt-s">${chip}${cs.skipped ? ` <span class="pill skip">⏭ ${cs.skipped} skipped</span>` : ''}</div>` : ''}</div><span class="chev">›</span></a>`;
  }

  // ---------- chapter page ----------
  routes.ch = (arg) => {
    const key = arg; const ch = CH[key]; if (!ch) return go('#/book/' + bookId());
    if (ch.bid !== bookId()) Books.setCurrent(ch.bid);
    const b = book(ch.bid), cs = Store.chapterStats(key);
    const best = S().best['challenge-' + key];
    const saved = Modes.resume.chapter(key);
    const keys = chKeys(ch.bid), idx = keys.indexOf(key);
    view().innerHTML = `
      <a class="back" href="#/book/${ch.bid}">‹ ${esc(b.short)}</a>
      <section class="card glow ch-hero" style="--bc:${b.color || '#6d4cff'}">
        <div class="eyebrow">${esc(b.parts.length > 1 ? b.parts[ch.p] : b.title)}</div>
        <h1><span class="num big">${ch.n}</span> ${ch.t}</h1>
        <div class="ch-hero-row">
          ${ring(cs.done, 84, 8, pct(cs.done))}
          <div class="grow">
            <div class="kv"><span>Questions</span><b>${cs.total}${cs.practice ? ` <small class="muted">+${cs.practice} practice</small>` : ''}</b></div>
            <div class="kv"><span>Seen</span><b>${cs.seen}</b></div>
            <div class="kv"><span>Accuracy</span><b>${cs.acc === null ? '—' : pct(cs.acc)}</b></div>
            <div class="kv"><span>Mastery</span><b>${pct(cs.mastery)}</b></div>
            <div class="kv"><span>Due now</span><b>${cs.due}</b></div>
            ${best ? `<div class="kv"><span>Best challenge</span><b>${best}%</b></div>` : ''}
          </div>
        </div>
        ${pbar(cs)}
        ${tierBar(cs.tiers, cs.total)}
        <div class="tier-legend">${Store.TIERS.map((t, i) => `<span><i class="t${i}"></i>${t} ${cs.tiers[i]}</span>`).join('')}</div>
        ${saved ? `<div class="ch-cont card"><div class="grow"><b>▶ Continue where you stopped</b><div class="muted small">${esc(saved.label.split(' · ')[0])} · ${esc(saved.prog || '')} · ${ago(saved.ts)}</div></div><button class="btn" data-chres="${esc(key)}">Continue</button><button class="icon-btn" data-chres-x="${esc(key)}" aria-label="Forget">✕</button></div>`
        : (cs.seen > 0 && cs.seen < cs.total ? `<div class="ch-cont card"><div class="grow"><b>▶ Continue this chapter</b><div class="muted small">${cs.total - cs.seen} questions you haven't answered yet</div></div><button class="btn" data-chnext="${esc(key)}">Continue</button></div>` : '')}
        <div class="row between mt">${idx > 0 ? `<a class="chip" href="#/ch/${encodeURIComponent(keys[idx - 1])}">‹ Ch ${CH[keys[idx - 1]].n}</a>` : '<span></span>'}${idx < keys.length - 1 ? `<a class="chip" href="#/ch/${encodeURIComponent(keys[idx + 1])}">Ch ${CH[keys[idx + 1]].n} ›</a>` : ''}</div>
      </section>
      <h2 class="sec-h">Study this chapter</h2>
      <div class="mode-grid">${Modes.list.filter(m => m.chapter !== false).map(m => `
        <button class="mode card" data-mode="${m.id}" style="--h:${m.hue}"><span class="m-ic">${m.ic}</span><b>${m.name}</b><small>${m.short}</small></button>`).join('')}</div>
      <h2 class="sec-h">Questions <span class="muted small">(tap to preview · ⏭ to skip / un-skip)</span>${cs.skipped ? ` <button class="chip" id="clrChSkips">Un-skip all ${cs.skipped} here</button>` : ''}</h2>
      <div class="q-list">${ch.ids.map(id => { const q = Q[id], t = Store.tier(id); return `
        <details class="q-prev"><summary><span class="tdot t${t}" title="${Store.TIERS[t]}"></span><span class="qn">Q${q.n}</span><span class="grow">${q.g && !q.s ? strip(q.g) : q.s}${q.img ? ' 🖼️' : ''}</span>${Store.isFlagged(id) ? '⭐' : ''}${Store.isSkipped(id) ? ' <span class="pill skip">⏭ skipped</span>' : ''}</summary>
        <div class="row end"><button class="skipbtn ${Store.isSkipped(id) ? 'on' : ''}" data-skip="${id}">${Store.isSkipped(id) ? '⏭ Skipped — tap to un-skip' : '⏭ Skip this question'}</button></div>
        ${stemHTML(q)}${optsPrev(q)}
        ${refLine(q)}${noteLine(q)}${bookExpHTML(q)}<div class="xp" data-q="${id}"></div></details>`; }).join('')}</div>`;
    $$('[data-mode]').forEach(x => x.onclick = () => Modes.start(x.dataset.mode, { chapters: [key], fromChapter: key }));
    $$('[data-skip]').forEach(x => x.onclick = e => { e.preventDefault(); const on = Store.toggleSkip(x.dataset.skip); x.classList.toggle('on', on); x.textContent = on ? '⏭ Skipped — tap to un-skip' : '⏭ Skip this question'; FX.play('tap'); });
    if ($('#clrChSkips')) $('#clrChSkips').onclick = () => { const n = Store.clearSkips(ch.ids); toast(`⏭ ${n} un-skipped`); render(); };
    Explain.scan(view());
  };

  // ---------- study hub & games ----------
  const bookSwitch = () => {
    const bs = Books.list(); if (bs.length < 2) return '';
    return `<div class="book-switch">${bs.map(b => `<button class="chip ${b.id === bookId() ? 'on' : ''}" data-bk="${b.id}" style="--bc:${b.color || '#6d4cff'}">${b.icon || '📘'} ${esc(b.short)}</button>`).join('')}</div>`;
  };
  function bindSwitch() { $$('[data-bk]').forEach(x => x.onclick = () => { Books.setCurrent(x.dataset.bk); render(); }); }
  routes.study = () => {
    view().innerHTML = `<div class="page-head"><h1>Study modes</h1>${bookSwitch()}<p class="muted">Built on retrieval practice, spaced repetition, interleaving and confidence calibration — the techniques with the strongest evidence for long-term retention.</p></div>
      <div class="mode-list">${Modes.list.filter(m => m.kind === 'study').map(modeRow).join('')}</div>`;
    bindModeRows(); bindSwitch();
  };
  routes.games = () => {
    view().innerHTML = `<div class="page-head"><h1>Games</h1>${bookSwitch()}<p class="muted">Same verified questions, more adrenaline. Every answer still feeds your spaced-repetition schedule.</p></div>
      <div class="mode-list">${Modes.list.filter(m => m.kind === 'game').map(modeRow).join('')}</div>`;
    bindModeRows(); bindSwitch();
  };
  function modeRow(m) {
    const best = S().best[m.id];
    return `<button class="mode-row card" data-mode="${m.id}" style="--h:${m.hue}"><span class="m-ic">${m.ic}</span><div class="grow"><b>${m.name}</b><div class="muted small">${m.desc}</div>${best ? `<span class="pill">🏆 Best: ${best}${m.bestUnit || ''}</span>` : ''}</div><span class="chev">›</span></button>`;
  }
  function bindModeRows() { $$('[data-mode]').forEach(b => b.onclick = () => Modes.setup(b.dataset.mode)); }

  // ---------- search (all books) ----------
  routes.search = (arg) => {
    const bs = Books.list();
    let scope = 'all';
    view().innerHTML = `<div class="page-head"><h1>Search</h1><input class="search" id="sq" placeholder="e.g. asterion, Simpson grade, Wartenberg…" value="${esc(arg || '')}" autocomplete="off">
      ${bs.length > 1 ? `<div class="book-switch" id="sScope"><button class="chip on" data-s="all">All books</button>${bs.map(b => `<button class="chip" data-s="${b.id}">${b.icon || '📘'} ${esc(b.short)}</button>`).join('')}</div>` : ''}</div><div id="sres"></div>`;
    const run = () => {
      const q = $('#sq').value.trim().toLowerCase();
      if (q.length < 2) { $('#sres').innerHTML = '<p class="muted center">Type at least 2 letters.</p>'; return; }
      const res = [];
      for (const id of Store.ALL) {
        const x = Q[id]; if (scope !== 'all' && x.bid !== scope) continue;
        const hay = (strip(x.s) + ' ' + strip(x.g || '') + ' ' + x.o.map(strip).join(' ')).toLowerCase();
        if (hay.includes(q)) { res.push(x); if (res.length >= 80) break; }
      }
      const hl = s => s.replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'gi'), '<mark>$1</mark>');
      $('#sres').innerHTML = `<p class="muted small">${res.length >= 80 ? '80+' : res.length} matches</p>` + res.map(x => `
        <div class="card s-item"><div class="muted small"><a href="#/ch/${encodeURIComponent(x.ch)}">${chTitle(x.ch)}</a> · Q${x.n}</div><div class="s-stem">${hl(x.s || strip(x.g || ''))}${x.img ? ' 🖼️' : ''}</div>
        <div class="s-ans">${x.nk ? '— no key in the book' : '✅ ' + correctSet(x).map(i => L(i) + '. ' + hl(optText(x, i))).join(' · ')}</div></div>`).join('');
    };
    $$('#sScope [data-s]').forEach(b => b.onclick = () => { scope = b.dataset.s; $$('#sScope [data-s]').forEach(x => x.classList.toggle('on', x === b)); run(); });
    $('#sq').oninput = run; run(); $('#sq').focus();
  };

  // ---------- stats ----------
  let statsScope = null;
  routes.stats = () => {
    const st = S(), lv = Store.levelInfo();
    const bs = Books.list();
    if (!statsScope || (statsScope !== 'all' && !Books.get(statsScope))) statsScope = bookId();
    const scope = statsScope;
    const sb = scope === 'all' ? null : book(scope);
    const ids = scope === 'all' ? Store.allKeyed() : Store.BK[scope].keyed;
    const idset = new Set(ids);
    const tiers = Store.globalTiers(ids);
    const log = st.log.filter(l => idset.has(l[1]));
    const days = Object.keys(st.daily).sort();
    const seriesT = [{ name: 'Struggling', cls: 's1' }, { name: 'Learning', cls: 's2' }, { name: 'Known', cls: 's3' }, { name: 'Mastered', cls: 's4' }];
    const totalAns = log.length, totalC = log.filter(l => l[2]).length;
    const totalTime = Object.values(st.daily).reduce((a, d) => a + (d.t || 0), 0);
    const nowR = ids.reduce((a, id) => a + FSRS.currentR(st.cards[id]), 0);
    const keys = scope === 'all' ? [] : chKeys(scope);
    view().innerHTML = `
      <div class="page-head"><h1>Statistics</h1>
      <div class="book-switch" id="stScope">${bs.length > 1 ? `<button class="chip ${scope === 'all' ? 'on' : ''}" data-s="all">📚 All books</button>` : ''}${bs.map(b => `<button class="chip ${scope === b.id ? 'on' : ''}" data-s="${b.id}">${b.icon || '📘'} ${esc(b.short)}</button>`).join('')}</div>
      <p class="muted">Knowledge growth, retention and habits — all computed on this device.</p></div>
      <section class="stats-strip">
        <div class="stat card"><small>Answers</small><b data-count="${totalAns}">0</b><span class="muted small">${totalAns ? Math.round(totalC / totalAns * 100) : 0}% correct</span></div>
        <div class="stat card"><small>Study time (all)</small><b>${fmtMs(totalTime)}</b><span class="muted small">${days.length} active days</span></div>
        <div class="stat card"><small>Best streak</small><b>${Store.bestStreak()}🔥</b><span class="muted small">current ${Store.streak()}</span></div>
        <div class="stat card"><small>Expected recall now</small><b>${Math.round(nowR).toLocaleString()}</b><span class="muted small">questions you'd likely get right today</span></div>
      </section>
      ${scope === 'all' ? `<section class="card"><h2>📚 Books</h2><div class="table-wrap"><table class="tbl"><thead><tr><th>Book</th><th>Done</th><th>Acc.</th><th>Mastery</th><th>Due</th></tr></thead><tbody>
        ${bs.map(b => { const s = Store.bookStats(b.id); return `<tr><td><a href="#/book/${b.id}">${b.icon || '📘'} ${esc(b.short)}</a></td><td>${s.seen}/${s.total}<div class="mini"><i style="width:${s.done * 100}%"></i></div></td><td>${s.acc === null ? '—' : pct(s.acc)}</td><td><div class="mini"><i style="width:${s.mastery * 100}%"></i></div></td><td>${s.due || ''}</td></tr>`; }).join('')}
      </tbody></table></div></section>` : ''}
      <section class="card"><h2>📈 Knowledge growth</h2><p class="muted small">How many of the ${ids.length.toLocaleString()} questions sit in each memory stage, day by day. Known = memory stable ≥ 4 days; Mastered ≥ 21 days.</p><div id="cGrowth"></div></section>
      <div class="grid2">
        <section class="card"><h2>🧠 Mastery breakdown</h2><div class="donut-wrap"><div id="cDonut"></div><div class="tier-legend col">${Store.TIERS.map((t, i) => `<span><i class="t${i}"></i>${t}<b>${tiers[i]}</b></span>`).join('')}</div></div></section>
        <section class="card"><h2>🗓️ Review forecast</h2><p class="muted small">Questions coming due over the next 14 days.</p><div id="cFore"></div></section>
      </div>
      <section class="card"><h2>🎯 Daily accuracy (all books)</h2><div id="cAcc"></div></section>
      <section class="card"><h2>🔥 Activity</h2><div id="cHeat" class="scroll-x"></div></section>
      <div class="grid2">
        ${sb && sb.parts.length >= 3 ? `<section class="card"><h2>🕸️ Mastery by part</h2><div id="cRadar"></div></section>` : `<section class="card"><h2>📊 Mastery by chapter</h2><div id="cChBars"></div></section>`}
        <section class="card"><h2>🎚️ Confidence calibration</h2><p class="muted small">From Confidence mode: how often you're right when you say Guess / Likely / Sure. Well-calibrated learners score ≈33% / 67% / 95%+.</p><div id="cCal"></div></section>
      </div>
      ${keys.length ? `<section class="card"><h2>📚 Chapter table</h2><div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Chapter</th><th>Seen</th><th>Acc.</th><th>Mastery</th><th>Due</th></tr></thead><tbody>
        ${keys.map(k => { const c = CH[k], cs = Store.chapterStats(k); return `<tr><td>${c.n}</td><td><a href="#/ch/${encodeURIComponent(k)}">${c.t}</a></td><td>${cs.seen}/${cs.total}<div class="mini"><i style="width:${cs.done * 100}%"></i></div></td><td>${cs.acc === null ? '—' : pct(cs.acc)}</td><td><div class="mini"><i style="width:${cs.mastery * 100}%"></i></div></td><td>${cs.due || ''}</td></tr>`; }).join('')}
      </tbody></table></div></section>` : ''}
      <section class="card"><h2>😈 Toughest questions</h2><p class="muted small">Most missed — revisit them in the Mistakes Vault.</p><div id="tough"></div></section>
      <section class="card"><h2>🏅 Achievements <span class="muted small">${Object.keys(st.ach).length}/${ACH.length}</span></h2><div class="ach-grid">${ACH.map(a => `<div class="ach ${st.ach[a.id] ? 'got' : ''}" data-tip="${esc(a.d)}${st.ach[a.id] ? '\nUnlocked ' + new Date(st.ach[a.id]).toLocaleDateString() : ''}"><span>${a.ic}</span><small>${a.n}</small></div>`).join('')}</div></section>
      <section class="card"><h2>🧾 Recent sessions</h2>${st.sessions.slice(-12).reverse().map(s => `<div class="list-item"><span class="grow"><b>${esc(s.name || s.mode)}</b><br><small class="muted">${new Date(s.ts).toLocaleString()}${s.scope ? ' · ' + s.scope : ''}</small></span><b>${s.score !== undefined ? s.score + (s.total ? '/' + s.total : '') : ''}</b></div>`).join('') || '<p class="muted">No sessions yet.</p>'}</section>
      <p class="muted small center">Level ${lv.lvl} · ${lv.rank} · ${st.xp.toLocaleString()} XP</p>`;
    $$('#stScope [data-s]').forEach(b => b.onclick = () => { statsScope = b.dataset.s; if (statsScope !== 'all') Books.setCurrent(statsScope); render(); });
    $$('[data-count]').forEach(el => FX.countUp(el, +el.dataset.count, 900, v => Math.round(v).toLocaleString()));
    // growth from daily snapshots: per-book snapshots (mb) or the Top Score snapshot (m, older versions)
    const snap = d => {
      if (!d) return null;
      const get = bid => (d.mb && d.mb[bid]) || (bid === 'ts' && d.m) || null;
      if (scope !== 'all') return get(scope);
      let acc = null;
      bs.forEach(b => { const v = get(b.id); if (v) { acc = acc || [0, 0, 0, 0, 0]; v.forEach((x, i) => acc[i] += x); } });
      return acc;
    };
    const growth = [];
    if (days.length) {
      let last = null;
      const start = new Date(days[0] + 'T00:00'), end = new Date(Store.today() + 'T00:00');
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const k = Store.today(d.getTime());
        const s = snap(st.daily[k]); if (s) last = s;
        growth.push({ d: k, vals: last ? last.slice(1) : [0, 0, 0, 0] });
      }
      growth[growth.length - 1].vals = tiers.slice(1);
    }
    Charts.stackedArea($('#cGrowth'), growth.slice(-90), seriesT, { label: 'Knowledge growth' });
    Charts.donut($('#cDonut'), tiers, [{ name: 'New', cls: 's0' }].concat(seriesT), [Math.round((tiers[3] + tiers[4]) / (ids.length || 1) * 100) + '%', 'known+']);
    const fore = []; const now = Date.now();
    for (let i = 0; i < 14; i++) fore.push({ label: i === 0 ? 'Now' : '+' + i + 'd', v: 0 });
    ids.forEach(id => { const c = st.cards[id]; if (c && c.reps) { const dd = Math.max(0, Math.ceil((c.due - now) / 86400000)); if (dd < 14) fore[dd].v++; } });
    fore.forEach((f, i) => f.tip = `${i === 0 ? 'Due now' : new Date(now + i * 86400000).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${f.v} questions`);
    Charts.bars($('#cFore'), fore, { label: 'Review forecast' });
    Charts.accuracyTrend($('#cAcc'), days.slice(-30).map(d => Object.assign({ d }, st.daily[d])));
    Charts.heatmap($('#cHeat'), st.daily, innerWidth < 600 ? 17 : 26);
    if ($('#cRadar')) {
      Charts.radar($('#cRadar'), sb.parts.map((p, pi) => {
        const chs = keys.filter(k => CH[k].p === pi); let m = 0, t = 0;
        chs.forEach(k => { const cs = Store.chapterStats(k); m += cs.mastery * cs.total; t += cs.total; });
        return { short: p.split(':')[0].replace('Part ', ''), v: t ? m / t : 0, tip: `${p}\nMastery ${Math.round((t ? m / t : 0) * 100)}%` };
      }));
    } else if ($('#cChBars')) {
      const items = (scope === 'all' ? bs.map(b => ({ label: b.short.slice(0, 6), v: Math.round(Store.bookStats(b.id).mastery * 100), tip: `${b.short}: mastery ${pct(Store.bookStats(b.id).mastery)}` }))
        : keys.slice(0, 40).map(k => ({ label: String(CH[k].n), v: Math.round(Store.chapterStats(k).mastery * 100), tip: `${chTitle(k)}\nMastery ${pct(Store.chapterStats(k).mastery)}` })));
      Charts.bars($('#cChBars'), items, { label: 'Mastery', h: 180 });
    }
    const cal = [1, 2, 3].map(k => { const ls = log.filter(l => l[5] === k); return { label: ['Guess', 'Likely', 'Sure'][k - 1], v: ls.length ? Math.round(ls.filter(l => l[2]).length / ls.length * 100) : 0, n: ls.length }; });
    if (cal.some(c => c.n)) Charts.bars($('#cCal'), cal.map(c => ({ label: c.label, v: c.v, tip: `${c.label}: ${c.v}% correct (${c.n} answers)` })), { label: 'Calibration', h: 180 });
    else $('#cCal').innerHTML = '<div class="chart-empty">🎚️ Play Confidence mode to see your calibration.</div>';
    const tough = ids.filter(id => st.cards[id] && st.cards[id].w).sort((a, b) => (st.cards[b].w - (st.cards[b].c || 0) * 0.5) - (st.cards[a].w - (st.cards[a].c || 0) * 0.5)).slice(0, 8);
    $('#tough').innerHTML = tough.map(id => `<details class="q-prev"><summary><span class="pill bad">✗${st.cards[id].w}</span><span class="grow">${Q[id].s || strip(Q[id].g || '')}</span></summary>${stemHTML(Q[id])}<div class="s-ans">✅ ${correctSet(Q[id]).map(i => L(i) + '. ' + optText(Q[id], i)).join(' · ')}</div><div class="muted small">${chTitle(Q[id].ch)}</div></details>`).join('') || '<p class="muted">Nothing missed yet. 💪</p>';
  };

  // ---------- settings ----------
  routes.settings = () => {
    const st = S(), set = st.settings;
    const kb = (Store.storageBytes() / 1024).toFixed(0);
    const packs = Books.list().filter(b => !b.builtin);
    view().innerHTML = `
      <div class="page-head"><h1>Settings</h1></div>
      ${Account.settingsHTML()}
      ${Account.libraryHTML()}
      <section class="card">
        <h2>💾 Backup &amp; restore</h2>
        <p class="muted small">Your progress is saved <b>only in this browser</b> (${kb} KB). Clearing site data, private mode or reinstalling the browser can erase it. Export a backup regularly to your phone's Files / Drive and restore it here to resume exactly where you left off. The backup holds progress for <b>every book</b> (not the book files themselves).</p>
        <div class="kv"><span>Last backup</span><b>${st.lastBackup ? new Date(st.lastBackup).toLocaleString() : 'Never'}</b></div>
        <div class="kv"><span>Answers since backup</span><b>${st.sinceBackup}</b></div>
        <div class="kv"><span>Persistent storage</span><b id="persist">checking…</b></div>
        <div class="row gap wrap mt"><button class="btn" id="exp">⬇️ Export backup</button><button class="btn ghost" id="imp">⬆️ Restore from file</button></div>
      </section>
      <section class="card">
        <h2>📚 Books on this device</h2>
        <p class="muted small">Book packs (<b>.tspack</b>) are private files you load once per device/browser. They stay <b>only on this device</b> and are never uploaded. To add a new book in the future, load its pack here (or with ＋ on the bookshelf). Loading a newer version of a pack replaces the old one and keeps your progress.</p>
        <div class="list-item"><span class="grow"><b>🏆 Top Score</b><br><small class="muted">Built in · ${Store.BK.ts.ids.length.toLocaleString()} questions</small></span></div>
        ${packs.map(b => `<div class="list-item"><span class="grow"><b>${b.icon || '📘'} ${esc(b.short)}</b><br><small class="muted">${Store.BK[b.id] ? Store.BK[b.id].ids.length.toLocaleString() : 0} questions · ${(b.size / 1048576).toFixed(1)} MB${b.built ? ' · built ' + esc(b.built) : ''}</small></span><button class="btn ghost sm" data-rmb="${b.id}">Remove</button></div>`).join('')}
        <div class="row gap wrap mt"><button class="btn" id="addPk">＋ Add book pack</button></div>
      </section>
      <section class="card" id="xpack">
        <h2>📖 Greenberg explanation pack</h2>
        <p class="muted small">For Top Score: load the explanation pack file once. It adds the verbatim Greenberg 10th ed. passages, tables and figures behind each answer. It is stored <b>only on this device</b> and never uploaded. If the browser data is cleared, just load the file again.</p>
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
        <div class="field"><span>Text size</span><div class="seg" id="fontSz">${[[0.9, 'Small'], [1, 'Normal'], [1.12, 'Large'], [1.25, 'Larger'], [1.4, 'Largest']].map(f => `<button data-v="${f[0]}" class="${(set.fontScale || 1) === f[0] ? 'on' : ''}" style="font-size:${f[0]}em">${f[1]}</button>`).join('')}</div></div>
        <div class="field"><span>Theme</span><div class="seg" id="theme">${['auto', 'light', 'dark'].map(t => `<button data-v="${t}" class="${set.theme === t ? 'on' : ''}">${t === 'auto' ? '🌗 Auto' : t === 'light' ? '☀️ Light' : '🌙 Dark'}</button>`).join('')}</div></div>
        ${toggle('sound', '🔊 Sound effects', set.sound)}
        ${toggle('haptics', '📳 Vibration feedback', set.haptics)}
        ${toggle('shuffleOpts', '🔀 Shuffle answer options (questions with “All of the above”, “Both A and B”, figure labels… are never shuffled)', set.shuffleOpts)}
        ${toggle('recallFirst', '🤔 Recall-first: hide options until you try to recall the answer (generation effect)', set.recallFirst)}
      </section>
      <section class="card">
        <h2>📲 Install as an app</h2>
        <p class="muted small">Install TOP SCORE to your home screen — it works fully offline, on phones and tablets (portrait or landscape).</p>
        <button class="btn" id="inst" ${App.installEvt ? '' : 'disabled'}>Install app</button>
        <p class="muted small mt">iPhone/iPad: open in Safari → Share → <b>Add to Home Screen</b>. Android: Chrome menu → <b>Install app</b>.</p>
      </section>
      <section class="card">
        <h2>ℹ️ About the data</h2>
        <p class="small"><b>${Account.OWNER_CREDIT}</b></p>
        <p class="muted small">Every question, key and explanation comes strictly from its book — no outside content. Top Score: <i>${esc(Books.get('ts').source)}</i>; each key was verified by matching the printed answer letter against the printed answer text and cross-checked with two independent PDF extraction engines. Book packs were extracted the same way (key letter vs. printed answer text, or the book's own answer key table). Where a book is internally inconsistent the question shows an ℹ️ note; questions printed without any key are marked <b>practice</b> and are not scored.</p>
      </section>
      <section class="card danger-zone"><h2>⚠️ Danger zone</h2><button class="btn danger" id="rst">Reset all progress</button></section>`;
    $('#exp').onclick = doExport; $('#imp').onclick = doImport;
    $('#addPk').onclick = addPack;
    $$('[data-rmb]').forEach(x => x.onclick = async () => {
      const b = Books.get(x.dataset.rmb);
      if (await confirmBox(`Remove ${esc(b.short)}?`, 'The book file is removed from this device. Your progress for it is kept — load the pack again any time to continue.', 'Remove')) {
        await Books.remove(b.id); Store.syncBooks(); toast('Book removed'); render();
      }
    });
    packUI();
    $('#nm').onchange = e => { set.name = e.target.value.trim(); Store.save(); };
    $('#goal').oninput = e => { set.goal = +e.target.value; $('#gv').textContent = set.goal; Store.save(); };
    $('#exs').oninput = e => { set.examSecs = +e.target.value; $('#ev').textContent = set.examSecs; Store.save(); };
    $$('#fontSz button').forEach(b => b.onclick = () => { set.fontScale = +b.dataset.v; Store.save(); applyTheme(); $$('#fontSz button').forEach(x => x.classList.toggle('on', x === b)); });
    Account.bindSettings(); Account.bindLibrary();
    $$('#theme button').forEach(b => b.onclick = () => { set.theme = b.dataset.v; Store.save(); applyTheme(); $$('#theme button').forEach(x => x.classList.toggle('on', x === b)); });
    $$('[data-tg]').forEach(i => i.onchange = () => { set[i.dataset.tg] = i.checked; Store.save(); FX.play('tap'); });
    $('#inst').onclick = async () => { if (App.installEvt) { App.installEvt.prompt(); await App.installEvt.userChoice; App.installEvt = null; $('#inst').disabled = true; } };
    $('#rst').onclick = async () => {
      if (await confirmBox('Reset everything?', 'This erases all progress on this device (book files stay). Export a backup first if you might want it back.', 'Erase')) { Store.reset(); Modes.resume.clear(); applyTheme(); toast('Progress reset'); go('#/'); }
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
    } else { st.textContent = 'Not loaded. Top Score answers show the key and the Greenberg page number only.'; $('#xpDel').hidden = true; }
    $('#xpLoad').onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file';
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        st.textContent = 'Loading pack… (large file, please wait)';
        try {
          const h = await Books.readHeader(f);
          if (h.kind === 'book') { const r = await Books.load(f); Store.indexBook(r.book); toast(`📚 That was a book pack — ${esc(r.book.short)} added to your shelf`); render(); return; }
          await Explain.load(f); toast('📖 Explanation pack loaded'); FX.play('win'); FX.confetti(); packUI();
        }
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
    { id: 'allseen', ic: '🌍', n: 'Whole Book', d: 'See every question of a book at least once' },
    { id: 'allch', ic: '🗺️', n: 'Explorer', d: 'Answer at least one question in every chapter of a book' },
    { id: 'shelf', ic: '📚', n: 'Librarian', d: 'Study from 3 different books' },
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
    if (t[3] + t[4] >= 100) unlock('m100'); if (t[3] + t[4] >= 1000) unlock('m1000'); if (t[4] >= 50) unlock('mast50');
    const s = Store.streak(); if (s >= 3) unlock('s3'); if (s >= 7) unlock('s7'); if (s >= 30) unlock('s30');
    const h = new Date().getHours(); if (h < 4) unlock('night'); if (h >= 4 && h < 7) unlock('early');
    if (Store.day().a >= st.settings.goal) unlock('goal');
    if (Store.levelInfo().lvl >= 10) unlock('lvl10');
    if (ctx.combo >= 15) unlock('combo15');
    if (n % 25 === 0) {
      const bs = Books.list();
      if (bs.some(b => Store.bookStats(b.id).tiers[0] === 0 && Store.bookStats(b.id).total)) unlock('allseen');
      if (bs.some(b => Store.BK[b.id] && Store.BK[b.id].chs.every(k => CH[k].ids.some(id => st.cards[id])))) unlock('allch');
      if (bs.filter(b => Store.bookStats(b.id).seen > 0).length >= 3) unlock('shelf');
    }
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
    document.documentElement.style.setProperty('--fs', S().settings.fontScale || 1);
    const t = S().settings.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    $('meta[name=theme-color]').setAttribute('content', dark ? '#0b0a14' : '#f6f5fb');
  }

  window.App = {
    $, $$, esc, strip, shuffle, L, toast, ago, modal, confirmBox, ring, animateRings, go, render, fmtMs, fmtIvl, chTitle, chShort, qLabel,
    stemHTML, bookExpHTML, optsPrev, optText, keyText, keyLetters, correctSet, isRight, refLine, noteLine, book, bookId, chKeys,
    unlock, checkAch, levelUp, doExport, needBackup, installEvt: null, addPack,
    setLeaveGuard(fn) { leaveGuard = fn; }, routes, applyTheme
  };

  // ---------- boot ----------
  document.addEventListener('DOMContentLoaded', async () => {
    applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    FX.neural($('#bg'));
    Charts.tip();
    $('#themeBtn').onclick = () => {
      const s = S().settings; const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
      s.theme = dark ? 'light' : 'dark'; Store.save(); applyTheme(); FX.play('tap');
    };
    const guestExam = !Account.me() && location.hash.startsWith('#/x/');     // exam room: guests may enter with just a name
    if (!Account.me() && !guestExam) { Account.showAuth(); return; }   // private study group: log in first
    view().innerHTML = '<div class="boot"><div class="intro-logo spin">📚</div><p class="muted">Opening your bookshelf…</p></div>';
    await Books.ready;
    Store.syncBooks();
    render();
    if (guestExam) return;
    Sync.start();
    Account.start();
    // request persistent storage on first interaction (reduces chance of eviction)
    const askPersist = () => { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); removeEventListener('pointerdown', askPersist); };
    addEventListener('pointerdown', askPersist);
    if (!S().log.length && !S().seenIntro) {
      S().seenIntro = 1; Store.save();
      setTimeout(() => modal(`<div class="intro"><div class="intro-logo">🧠</div><h2>Welcome to TOP SCORE</h2>
        <p>Your neurosurgery board library: every MCQ taken straight from its book, with the answer keys checked.</p>
        <ul class="intro-list"><li>📚 <b>Bookshelf</b>: Top Score is built in. Add other books with their private <b>.tspack</b> files (＋ on the shelf).</li><li>🧠 <b>Smart Review</b> schedules each question right before you'd forget it (FSRS).</li><li>🎯 <b>MCQ Challenge</b> exams you, scores you, then retries your misses. Chapters remember where you stopped.</li><li>💾 Progress is saved on this device. <b>Export a backup often</b> (Settings).</li></ul>
        <button class="btn block" onclick="this.closest('.modal-wrap').close()">Let's start</button></div>`, { cls: 'center-modal' }), 400);
    } else setTimeout(resumePrompt, 500);
  });
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); App.installEvt = e; });
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing; nw && nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('✨ Update ready — <a href="#" onclick="location.reload();return false">reload</a>', 8000); });
    });
  }).catch(() => { }));
})();
