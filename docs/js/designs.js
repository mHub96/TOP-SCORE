/* TOP SCORE — study designs that belong to one book only. A pack opts in with design:'guided' or design:'case';
   every other book keeps the normal book page, chapter page and study modes.
   guided (Approaches Atlas): a step-by-step show of each approach, nothing is tested.
   case (Case Review): questions in book order, Show answer below each, then a confidence rating that drives revision. */
(function () {
  const { $, esc, ring, toast, routes } = App;
  const { Q, CH } = Store;
  const S = () => Store.S;
  const view = () => $('#view');
  const enc = encodeURIComponent;
  const pct = x => Math.round(x * 100) + '%';
  const chOf = (b, key) => b.chapters.find(c => Store.chKey(b.id, c.n) === key) || {};
  const bookOfKey = key => CH[key] ? Books.get(CH[key].bid) : null;

  function fig(b, f, hideCaption) {
    const [name, w, h, cap] = f;
    return `<figure class="ds-fig"><button class="qimg" data-bid="${b.id}" data-src="${esc(name)}" aria-label="Enlarge figure"><img src="${Books.url(b.id, name)}" width="${w}" height="${h}" alt="Figure"></button>${!cap ? '' : hideCaption ? `<details class="ds-cap"><summary>Show caption</summary>${cap}</details>` : `<figcaption>${cap}</figcaption>`}</figure>`;
  }
  const hero = (b, side) => `<a class="back" href="#/">‹ Bookshelf</a>
    <section class="card glow book-hero" style="--bc:${b.color || '#6d4cff'}">
      ${Books.cover(b.id) ? `<div class="bh-cover has-img"><img src="${Books.cover(b.id)}" alt="${esc(b.title)} cover"></div>` : ''}
      <div class="grow"><div class="eyebrow">${esc(b.authors || '')}${b.year ? ' · ' + b.year : ''}</div><h1>${esc(b.title)}</h1>${side}</div>
    </section>`;
  function bindSearch(b) {
    $('#dsFind').oninput = e => {
      const q = e.target.value.toLowerCase().trim(), box = $('#dsHits'), r = q.length > 1 ? App.noteHits(b, q, 1e5) : { total: 0, hits: [], terms: [] };
      box.innerHTML = q.length > 1 ? `<p class="muted small">${r.total} section${r.total === 1 ? '' : 's'} found</p>` + r.hits.slice(0, 15).map(n => App.noteHitHTML(n, r.terms)).join('') : '';
      const keys = new Set(r.hits.map(h => h.key));
      document.querySelectorAll('#dsList .ch-card').forEach(c => c.style.display = !q || c.dataset.t.includes(q) || keys.has(c.dataset.key) ? '' : 'none');
      document.querySelectorAll('#dsList .part').forEach(p => p.style.display = [...p.querySelectorAll('.ch-card')].some(c => c.style.display !== 'none') ? '' : 'none');
    };
  }
  const listBy = (b, card) => `<div id="dsList">${b.parts.map((p, pi) => {
    const ks = App.chKeys(b.id).filter(k => CH[k].p === pi); if (!ks.length) return '';
    return `<section class="part"><h3 class="part-h"><span>${esc(p.split(':')[0])}</span>${esc(p.split(':').slice(1).join(':'))}</h3><div class="ch-grid">${ks.map(card).join('')}</div></section>`;
  }).join('')}</div>`;
  const prevNext = (keys, i, word) => `<div class="row between mt">${i > 0 ? `<a class="chip" href="#/ch/${enc(keys[i - 1])}">‹ ${word} ${CH[keys[i - 1]].n}</a>` : '<span></span>'}${i < keys.length - 1 ? `<a class="chip" href="#/ch/${enc(keys[i + 1])}">${word} ${CH[keys[i + 1]].n} ›</a>` : '<span></span>'}</div>`;

  // ================= guided: step-by-step show =================
  const gState = key => (S().guide || {})[key] || { at: 0, max: -1, fin: 0, ts: 0 };
  function gSave(key, patch) { S().guide = S().guide || {}; S().guide[key] = Object.assign({}, gState(key), patch, { ts: Date.now() }); Store.save(); }
  const gSteps = (b, key) => chOf(b, key).steps || [];
  function guidedTotals(b) {
    let total = 0, seen = 0;
    App.chKeys(b.id).forEach(k => { const n = gSteps(b, k).length, g = gState(k); total += n; seen += g.fin ? n : Math.min(n, g.max + 1); });
    return { total, seen, done: total ? seen / total : 0 };
  }
  function guidedBook(b) {
    const t = guidedTotals(b), keys = App.chKeys(b.id), next = keys.find(k => !gState(k).fin);
    const nextG = next ? gState(next) : null;
    view().innerHTML = hero(b, `<div class="bh-rings"><div>${ring(t.done, 74, 7, pct(t.done))}<small>studied</small></div><div class="grow"><div class="kv"><span>Approaches</span><b>${keys.length}</b></div><div class="kv"><span>Steps seen</span><b>${t.seen} / ${t.total}</b></div></div></div>
        ${next ? `<div class="row gap wrap mt"><a class="btn" href="#/guide/${enc(next)}~${Math.max(0, nextG.at)}">▶ ${nextG.max >= 0 ? 'Continue' : 'Start'}: ${esc(App.strip(CH[next].t))}</a></div>` : ''}`) + `
      <div class="page-head"><input class="search" id="dsFind" placeholder="${esc(b.searchHint || 'Search…')}" autocomplete="off"></div><div id="dsHits"></div>
      ${listBy(b, k => {
        const g = gState(k), n = gSteps(b, k).length, c = chOf(b, k), dn = g.fin ? n : Math.min(n, g.max + 1);
        return `<a class="ch-card card" href="#/ch/${enc(k)}" data-key="${esc(k)}" data-t="${esc(App.strip(CH[k].t).toLowerCase())} ${CH[k].n}">${ring(n ? dn / n : 0, 50, 5, pct(n ? dn / n : 0))}<div class="grow"><div class="ch-t"><span class="num">${CH[k].n}</span>${CH[k].t}</div><div class="muted small">${n} steps${c.video ? ' · 🎬 video' : ''}${g.fin ? ' · ✓ done' : ''}</div></div><span class="chev">›</span></a>`;
      })}`;
    bindSearch(b);
  }
  function guidedChapter(b, key) {
    const steps = gSteps(b, key), g = gState(key), keys = App.chKeys(b.id), i = keys.indexOf(key), n = steps.length, c = CH[key];
    view().innerHTML = `<a class="back" href="#/book/${b.id}">‹ ${esc(b.short)}</a>
      <section class="card glow ch-hero" style="--bc:${b.color || '#6d4cff'}">
        <div class="eyebrow">${esc(b.parts[c.p] || '')}</div><h1><span class="num big">${c.n}</span> ${c.t}</h1>
        <div class="row gap wrap mt"><a class="btn" href="#/guide/${enc(key)}~${g.fin ? 0 : Math.max(0, g.at)}">▶ ${g.fin ? 'Go through again' : g.max >= 0 ? `Continue · step ${g.at + 1}` : 'Start step by step'}</a></div>
        ${prevNext(keys, i, 'Ch')}
      </section>
      <h2 class="sec-h">Steps</h2>
      <div class="ds-outline card">${steps.map((s, k) => `<a class="list-item" href="#/guide/${enc(key)}~${k}"><span class="num">${k + 1}</span><span class="grow">${esc(s.h)}${s.figs && s.figs.length ? ` <small class="muted">🖼️ ${s.figs.length}</small>` : ''}</span>${g.fin || k <= g.max ? '<span class="ds-tick">✓</span>' : ''}</a>`).join('')}</div>`;
  }
  let guideKeys = null;
  routes.guide = (arg) => {
    const [key, at] = String(arg).split('~'), b = bookOfKey(key);
    if (!b || b.design !== 'guided') return App.go('#/');
    if (b.id !== App.bookId()) Books.setCurrent(b.id);
    const steps = gSteps(b, key), keys = App.chKeys(b.id), ci = keys.indexOf(key), n = steps.length;
    if (!n) return App.go('#/ch/' + enc(key));
    const i = Math.min(n - 1, Math.max(0, parseInt(at, 10) || 0)), s = steps[i], g = gState(key), c = chOf(b, key);
    gSave(key, { at: i, max: Math.max(g.max, i) });
    let media = '';
    if (s.video) {
      const v = c.video, src = v.file ? Books.file(b.id, 'video/' + v.file) : '', poster = v.poster ? Books.url(b.id, v.poster) : '';
      // the video inside the pack when this copy has it; otherwise the publisher's own player, streamed
      const link = `<a class="btn" href="${esc(v.url)}" target="_blank" rel="noopener">▶ Watch on the publisher's site</a>`;
      if (src) media = `<video class="ds-video" src="${src}" ${poster ? `poster="${poster}"` : ''} controls playsinline preload="metadata"></video>`;
      else if (v.watch && navigator.onLine !== false) media = `<iframe class="ds-video" src="${esc(v.watch)}" title="${esc(v.label || 'Video')}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe><p class="ds-stream muted small">Streaming from the publisher · <a href="${esc(v.url)}" target="_blank" rel="noopener">open in a new tab</a></p>`;
      else if (v.watch) media = `<p class="muted">📴 This copy of the book streams its videos, so this one needs an internet connection.</p>`;
      else media = link;
      media += `<p class="ds-vcap">${v.caption}</p>`;
    }
    const next = i < n - 1 ? `#/guide/${enc(key)}~${i + 1}` : '';
    view().innerHTML = `<a class="back" href="#/ch/${enc(key)}">‹ ${c.t}</a>
      <div class="ds-top"><div class="row between small"><b>Step ${i + 1} of ${n}</b>${s.sec ? `<span class="muted">${esc(s.sec)}</span>` : ''}</div><div class="ds-bar"><i style="width:${(i + 1) / n * 100}%"></i></div></div>
      <article class="card ds-step"><h1>${esc(s.h)}</h1>${media}${s.html || ''}${(s.figs || []).map(f => fig(b, f)).join('')}${s.pg ? `<div class="src">📖 ${esc(b.short)}, p. ${s.pg}</div>` : ''}</article>
      <div class="ds-nav">${i > 0 ? `<a class="btn ghost" href="#/guide/${enc(key)}~${i - 1}">‹ Back</a>` : '<span></span>'}${next ? `<a class="btn" href="${next}">Next ›</a>` : `<button class="btn" id="dsFin">Finish ✓</button>`}</div>`;
    window.scrollTo(0, 0);
    const fin = $('#dsFin');
    if (fin) fin.onclick = () => { gSave(key, { fin: 1, at: 0 }); toast('✓ ' + App.strip(c.t) + ' finished'); App.go(ci < keys.length - 1 ? '#/ch/' + enc(keys[ci + 1]) : '#/book/' + b.id); };
    guideKeys = { back: i > 0 ? `#/guide/${enc(key)}~${i - 1}` : '', next };
  };
  addEventListener('keydown', e => {
    if (!location.hash.startsWith('#/guide/') || !guideKeys || e.target.matches('input,textarea,select,video')) return;
    const h = e.key === 'ArrowRight' ? guideKeys.next : e.key === 'ArrowLeft' ? guideKeys.back : '';
    if (h) location.hash = h;
  });
  let tx = null;
  addEventListener('touchstart', e => { tx = location.hash.startsWith('#/guide/') && e.touches.length === 1 && !e.target.closest('video,.tw') ? [e.touches[0].clientX, e.touches[0].clientY] : null; }, { passive: true });
  addEventListener('touchend', e => {
    if (!tx || !guideKeys || document.querySelector('.modal-wrap')) return;
    const t = e.changedTouches[0], dx = t.clientX - tx[0], dy = t.clientY - tx[1]; tx = null;
    if (Math.abs(dx) < 80 || Math.abs(dy) > 60) return;
    const h = dx < 0 ? guideKeys.next : guideKeys.back; if (h) location.hash = h;
  }, { passive: true });

  // ================= case: question, Show answer, confidence =================
  const CONF = [[1, 'Not confident'], [2, 'Slightly confident'], [3, 'Mostly confident'], [4, 'Fully confident']];
  const confOf = id => (S().cards[id] || {}).cf || 0;
  const isWeak = id => confOf(id) === 1 || confOf(id) === 2;
  const weakIn = ids => ids.filter(isWeak);
  const caseIds = key => CH[key] ? CH[key].ids : [];
  const allIds = b => Store.BK[b.id].ids;
  const pill = g => g ? `<span class="ds-pill c${g}">${CONF[g - 1][1]}</span>` : '';
  function rate(id, g) {
    Store.rate(id, g, 'case');
    S().cards[id].cf = g;                     // stored on the question's card, so it syncs between devices with it
    Store.save(); App.checkAch({});
  }
  const confRow = (id, mine) => `<div class="ds-conf"><div class="small muted">How confident were you in your answer?</div><div class="ds-confs">${CONF.map(([g, t]) => `<button class="c${g} ${mine === g ? 'on' : ''}" data-rate="${g}" data-id="${esc(id)}">${t}</button>`).join('')}</div></div>`;
  const answerHTML = (b, q) => `<div class="ds-answer">${q.o[0]}${(q.ef || []).map(f => fig(b, f)).join('')}<div class="src">📖 ${esc(q.r)}</div></div>`;

  /* what the reader has been told up to this question */
  function storyBefore(c, pos, from) {
    let h = '';
    c.q.forEach((x, k) => { if (k + 1 >= from && k + 1 <= pos) { if (x.u) h += `<div class="ds-update">${x.u}</div>`; } });
    return h;
  }
  function figsBefore(b, c, pos, from) {
    let h = '';
    c.q.forEach((x, k) => { if (k + 1 >= from && k + 1 <= pos) (x.nf || []).forEach(f => h += fig(b, f, true)); });
    return h;
  }
  function caseBook(b) {
    const ids = allIds(b), keys = App.chKeys(b.id), rated = ids.filter(confOf).length, weak = weakIn(ids).length;
    const next = keys.find(k => caseIds(k).some(id => !confOf(id)));
    view().innerHTML = hero(b, `<div class="bh-rings"><div>${ring(ids.length ? rated / ids.length : 0, 74, 7, pct(ids.length ? rated / ids.length : 0))}<small>answered</small></div><div class="grow"><div class="kv"><span>Cases</span><b>${keys.length}</b></div><div class="kv"><span>Questions</span><b>${ids.length.toLocaleString()}</b></div><div class="kv"><span>Weak points</span><b>${weak}</b></div></div></div>
      <div class="row gap wrap mt">${next ? `<a class="btn" href="#/ch/${enc(next)}">▶ Continue: Case ${CH[next].n}</a>` : ''}${weak ? `<a class="btn ghost" href="#/revise/${b.id}">🎯 Revise weak points · ${weak}</a>` : ''}</div>`) + `
      <div class="page-head"><input class="search" id="dsFind" placeholder="${esc(b.searchHint || 'Search…')}" autocomplete="off"></div><div id="dsHits"></div>
      ${listBy(b, k => {
        const qs = caseIds(k), r = qs.filter(confOf).length, w = weakIn(qs).length;
        return `<a class="ch-card card" href="#/ch/${enc(k)}" data-key="${esc(k)}" data-t="${esc(App.strip(CH[k].t).toLowerCase())} ${CH[k].n}">${ring(qs.length ? r / qs.length : 0, 50, 5, pct(qs.length ? r / qs.length : 0))}<div class="grow"><div class="ch-t"><span class="num">${CH[k].n}</span>${CH[k].t}</div><div class="muted small">${r} of ${qs.length} questions${w ? ` · <span class="pill warn">${w} weak</span>` : ''}</div></div><span class="chev">›</span></a>`;
      })}`;
    bindSearch(b);
  }

  let sess = null;
  function caseStart(b, key, mode) {
    const all = caseIds(key), weak = weakIn(all);
    const list = mode === 'weak' ? weak : all;
    sess = { key, mode, list, done: {}, open: {}, b };
    if (mode === 'resume') all.forEach(id => { if (confOf(id)) sess.done[id] = 1; });
    return sess;
  }
  function blockHTML(id, current) {
    const { b, key, list, mode, done, open } = sess, q = Q[id], c = chOf(b, key), i = list.indexOf(id);
    const prev = i > 0 ? Q[list[i - 1]].pos : 0, g = confOf(id);
    const story = storyBefore(c, q.pos, mode === 'weak' ? prev + 1 : q.pos), figs = figsBefore(b, c, q.pos, mode === 'weak' ? prev + 1 : q.pos);
    let foot;
    if (done[id]) foot = `<details class="ds-seen"><summary>Answer ${pill(g)}</summary>${answerHTML(b, q)}${confRow(id, g)}</details>`;
    else if (open[id]) foot = answerHTML(b, q) + confRow(id, g);
    else foot = current ? `<button class="btn ds-show" data-show="${esc(id)}">Show answer</button>` : '';
    return `<article class="card ds-q" id="b-${esc(id)}">${story}${figs}<div class="ds-qt"><span class="num">${q.n}</span><div class="grow">${q.s}</div></div>${foot}</article>`;
  }
  const nextOf = () => sess.list.find(id => !sess.done[id]);
  function drawCase() {
    const cur = nextOf(), upto = cur ? sess.list.indexOf(cur) : sess.list.length - 1;
    $('#dsQs').innerHTML = sess.list.slice(0, upto + 1).map(id => blockHTML(id, id === cur)).join('');
    drawFoot();
  }
  function drawFoot() {
    const { key, b, list, done } = sess, ids = caseIds(key), weak = weakIn(ids).length, n = list.filter(id => done[id]).length, keys = App.chKeys(b.id), i = keys.indexOf(key);
    $('#dsProg').innerHTML = `<div class="row between small"><b>${sess.mode === 'weak' ? 'Weak points' : 'Questions'}: ${n} of ${list.length}</b>${weak ? `<span class="muted">${weak} weak</span>` : ''}</div><div class="ds-bar"><i style="width:${list.length ? n / list.length * 100 : 0}%"></i></div>`;
    const finished = !nextOf();
    $('#dsEnd').innerHTML = finished ? `<section class="card ds-end"><h2>${sess.mode === 'weak' ? 'Weak points revised' : 'Case finished'}</h2>
      ${chOf(b, key).trailing ? chOf(b, key).trailing : ''}
      <div class="ds-tally">${CONF.map(([g, t]) => `<div>${pill(g)}<b>${ids.filter(id => confOf(id) === g).length}</b></div>`).join('')}</div>
      <div class="row gap wrap mt">${weak ? `<button class="btn" data-again="weak">🎯 Revise weak points · ${weak}</button>` : ''}<button class="btn ghost" data-again="all">↻ Restudy the whole case</button>${i < keys.length - 1 ? `<a class="btn ghost" href="#/ch/${enc(keys[i + 1])}">Next case ›</a>` : ''}</div></section>` : '';
  }
  function casePage(b, key) {
    const c = chOf(b, key), keys = App.chKeys(b.id), i = keys.indexOf(key), ch = CH[key];
    const anyDone = caseIds(key).some(confOf);
    sess = caseStart(b, key, anyDone ? 'resume' : 'all');
    view().innerHTML = `<a class="back" href="#/book/${b.id}">‹ ${esc(b.short)}</a>
      <header class="page-head"><div class="eyebrow">${esc(b.parts[ch.p] || '')}</div><h1><span class="num big">${ch.n}</span> ${ch.t}</h1>${c.by ? `<div class="muted small">${esc(c.by)}</div>` : ''}</header>
      <section class="card ds-pres"><h2>Clinical Presentation</h2>${c.pres || ''}${(c.pf || []).map(f => fig(b, f, true)).join('')}</section>
      <div class="ds-top" id="dsProg"></div>
      <div id="dsQs"></div><div id="dsEnd"></div>${prevNext(keys, i, 'Case')}`;
    drawCase();
    $('#dsQs').onclick = e => caseClick(e, false);
    $('#dsEnd').onclick = e => { const a = e.target.closest('[data-again]'); if (!a) return; sess = caseStart(b, key, a.dataset.again); drawCase(); $('#dsProg').scrollIntoView({ block: 'start' }); };
    window.scrollTo(0, 0);
  }
  function caseClick(e) {
    const s = e.target.closest('[data-show]'), r = e.target.closest('[data-rate]');
    if (s) {
      const id = s.dataset.show; sess.open[id] = 1;
      document.getElementById('b-' + id).outerHTML = blockHTML(id, true);
    } else if (r) {
      const id = r.dataset.id, was = sess.done[id], nextBefore = nextOf(); rate(id, +r.dataset.rate); sess.done[id] = 1;
      const el = document.getElementById('b-' + id); el.outerHTML = blockHTML(id, false);
      if (!was) {
        const n = nextOf();
        if (n && n !== nextBefore) {
          $('#dsQs').insertAdjacentHTML('beforeend', blockHTML(n, true));
          document.getElementById('b-' + n).scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        drawFoot();
        if (!n) $('#dsEnd').scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else drawFoot();
    }
  }

  /* book-wide revision: weakest questions first, each with the part of its case needed to answer it */
  let rv = null;
  routes.revise = (arg) => {
    const b = Books.get(arg); if (!b || b.design !== 'case') return App.go('#/');
    if (b.id !== App.bookId()) Books.setCurrent(b.id);
    const order = weakIn(allIds(b)).sort((x, y) => confOf(x) - confOf(y) || ((S().cards[x].last || 0) - (S().cards[y].last || 0)));
    rv = { b, order, i: 0, open: false };
    drawRevise();
  };
  function drawRevise() {
    const { b, order, i, open } = rv;
    if (i >= order.length) {
      const left = weakIn(allIds(b)).length;
      view().innerHTML = `<a class="back" href="#/book/${b.id}">‹ ${esc(b.short)}</a><section class="card ds-end"><h2>${order.length ? 'Revision finished' : 'No weak points'}</h2><p class="muted">${left ? `${left} question${left === 1 ? ' is' : 's are'} still rated weak.` : 'Nothing is rated weak right now.'}</p><div class="row gap wrap mt">${left ? `<a class="btn" href="#/revise/${b.id}?${Date.now()}">🎯 Go again · ${left}</a>` : ''}<a class="btn ghost" href="#/book/${b.id}">Back to the cases</a></div></section>`;
      window.scrollTo(0, 0); return;
    }
    const id = order[i], q = Q[id], c = chOf(b, q.ch), ch = CH[q.ch];
    view().innerHTML = `<a class="back" href="#/book/${b.id}">‹ ${esc(b.short)}</a>
      <div class="ds-top"><div class="row between small"><b>Weak points: ${i + 1} of ${order.length}</b>${pill(confOf(id))}</div><div class="ds-bar"><i style="width:${(i + 1) / order.length * 100}%"></i></div></div>
      <header class="page-head"><a class="muted small" href="#/ch/${enc(q.ch)}">Case ${ch.n}</a><h1>${ch.t}</h1></header>
      <section class="card ds-pres"><h2>Clinical Presentation</h2>${c.pres || ''}${(c.pf || []).map(f => fig(b, f, true)).join('')}</section>
      <article class="card ds-q">${storyBefore(c, q.pos, 1)}${figsBefore(b, c, q.pos, 1)}<div class="ds-qt"><span class="num">${q.n}</span><div class="grow">${q.s}</div></div>
        ${open ? answerHTML(b, q) + confRow(id, 0) : '<button class="btn ds-show" id="rvShow">Show answer</button>'}</article>`;
    window.scrollTo(0, 0);
    const sh = $('#rvShow');
    if (sh) sh.onclick = () => { rv.open = true; const y = window.scrollY; drawRevise(); window.scrollTo(0, y); };
    view().querySelectorAll('[data-rate]').forEach(x => x.onclick = () => { rate(id, +x.dataset.rate); rv.i++; rv.open = false; drawRevise(); });
  }

  // ================= hook the two designs into the site, only for books that declare one =================
  const base = { book: routes.book, ch: routes.ch, study: routes.study };
  routes.book = arg => {
    const b = Books.get(arg) || App.book();
    if (!b.design) return base.book(arg);
    if (b.id !== App.bookId()) Books.setCurrent(b.id);
    return b.design === 'guided' ? guidedBook(b) : caseBook(b);
  };
  routes.ch = arg => {
    const b = bookOfKey(arg);
    if (!b || !b.design) return base.ch(arg);
    if (b.id !== App.bookId()) Books.setCurrent(b.id);
    return b.design === 'guided' ? guidedChapter(b, arg) : casePage(b, arg);
  };
  routes.study = () => {
    base.study();
    const b = App.book();
    if (b.design) view().insertAdjacentHTML('beforeend', `<a class="card ds-go" href="#/book/${b.id}"><b>${esc(b.short)} has its own study design</b><div class="muted small">${b.design === 'guided' ? 'Step-by-step show of each approach.' : 'Questions, Show answer, then rate your confidence.'}</div></a>`);
  };
  const setup = Modes.setup, start = Modes.start;
  const designOf = (m, o) => { const k = o && o.chapters && o.chapters[0], b = k && CH[k] ? Books.get(CH[k].bid) : App.book(); return b && b.design ? b : null; };
  Modes.setup = (m, o) => { const b = designOf(m, o); if (b) return App.go('#/book/' + b.id); return setup(m, o); };
  Modes.start = (m, o) => { const b = designOf(m, o); if (b) return App.go('#/book/' + b.id); return start(m, o); };

  window.Designs = {
    tileStats(b) {
      if (b.design !== 'guided') return null;
      const t = guidedTotals(b);
      return Object.assign(Store.statsOf([]), { total: t.total, seen: t.seen, done: t.done, mastery: t.done });
    }
  };
})();
