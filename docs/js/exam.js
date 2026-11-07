/* Exam room: the examiner shows the room on a big screen (#/examroom/<id>); examinees scan the QR code
   and answer on their phones (#/x/<CODE>). The server keeps the clock and the answer keys.
   Question text never goes through the server: the big screen shows it from the examiner's own books, and a
   phone shows it only if that phone has the same book (Top Score is built in); otherwise the phone shows
   answer buttons and the examinee reads the question on the big screen.
   Strict rule on phones: once the exam runs, losing focus in any way submits the exam at once. */
(function () {
  const { $, $$, esc, toast, L } = App;
  const api = (path, opts) => Account.api(path, opts);
  const SITE = location.origin + location.pathname.replace(/index\.html$/, '');
  const joinURL = code => SITE + '#/x/' + code;
  let off = 0;                                   // server clock - local clock
  const sNow = () => Date.now() + off;
  async function timed(path, opts) { const t0 = Date.now(); const d = await api(path, opts); if (d && d.now) off = d.now - (t0 + Date.now()) / 2; return d; }
  const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const pctTxt = (a, b) => b ? Math.round(a / b * 100) + '%' : '0%';
  const paceTxt = d => d.pace === 'timer' ? `⏱️ ${d.secs} s per question` : '👆 the examiner moves on';

  /* screen wake lock: a sleeping phone would count as leaving the exam; a sleeping big screen is just annoying */
  let wl = null, wantWake = false;
  async function wake(on) {
    wantWake = on;
    try {
      if (on && !wl && 'wakeLock' in navigator && document.visibilityState === 'visible') { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => { wl = null; }); }
      if (!on && wl) { const w = wl; wl = null; w.release(); }
    } catch (e) { }
  }
  document.addEventListener('visibilitychange', () => { if (wantWake && document.visibilityState === 'visible') wake(true); });

  /* timer state for both screens: green → amber (last third) → red + pulse (last sixth / 10 s) */
  function timerState(d) {
    if (!d || d.status !== 'running') return null;
    const t = sNow();
    const auto = d.all_at ? d.all_at + 3000 - t : null;
    if (d.pace !== 'timer') return { manual: true, el: t - d.q_start, auto };
    const total = d.secs * 1000, left = Math.max(0, d.deadline - t);
    const cls = left <= Math.max(5000, Math.min(10000, total / 6)) ? 'danger' : left <= total / 3 ? 'warn' : '';
    return { left, frac: left / total, cls, auto };
  }

  // =====================================================================================
  // EXAMINER: setup
  // =====================================================================================
  const canHost = () => { const m = Account.me(); return !!(m && (m.role === 'owner' || m.examHost)); };
  const noHostHTML = '<section class="card"><h2>🖥️ Exam rooms</h2><p class="muted">Hosting exam rooms is limited to the owner and the people the owner allows. Ask the owner if you need it. You can still <b>join</b> an exam with its QR code or room code.</p><a class="btn ghost" href="#/arena/exam">‹ Back</a></section>';
  function setup(prefill) {
    if (!Account.me()) return Account.showAuth();
    if (!canHost()) { $('#view').innerHTML = noHostHTML; return; }
    const last = Object.assign({ cnt: 20, pace: 'timer', secs: 60, auto: true, guests: false }, JSON.parse(localStorage.getItem('ts.examcfg') || '{}'), prefill || {});
    const books = Books.list();
    const v = $('#view');
    v.innerHTML = `<a class="back" href="#/arena/exam">‹ Arena</a>
      <div class="page-head"><h1>🖥️ Exam room</h1><p class="muted">Open this on the big screen. Examinees scan the QR code with their phones and answer there.</p></div>
      <section class="card ex-setup">
        <label class="field"><span>Exam title</span><input id="exTitle" maxlength="80" placeholder="e.g. Friday neuro-oncology exam" value="${esc(last.title || '')}"></label>
        <label class="field"><span>Book</span><select id="exBook" class="chip">${books.map(b => `<option value="${b.id}" ${b.id === (last.book || App.bookId()) ? 'selected' : ''}>${esc(b.short)} — ${esc(b.title)}</option>`).join('')}</select></label>
        <div class="field"><span class="row between">Chapters <span class="row gap"><button class="chip sm" id="exAll">All</button><button class="chip sm" id="exNone">None</button></span></span><div class="ex-chs" id="exChs"></div></div>
        <div class="field"><span>Number of questions</span><div class="seg" id="exCnt">${[10, 15, 20, 25, 30].map(n => `<button data-v="${n}">${n}</button>`).join('')}<button data-v="0">Custom</button></div>
          <input id="exCntN" type="number" min="1" max="300" class="mt-s" placeholder="How many questions?" hidden></div>
        <div class="field"><span>Moving to the next question</span><div class="seg" id="exPace"><button data-v="timer">⏱️ Timer per question</button><button data-v="manual">👆 Examiner presses Next</button></div></div>
        <div class="field" id="exSecsF"><span>Time per question</span><div class="seg" id="exSecs">${[30, 45, 60, 90, 120].map(n => `<button data-v="${n}">${n < 60 ? n + ' s' : n / 60 + ' min'}</button>`).join('')}</div></div>
        <label class="switch-row"><span>⏩ Go to the next question 3 s after <b>everyone</b> has answered</span><input type="checkbox" id="exAuto" ${last.auto ? 'checked' : ''}><i class="switch"></i></label>
        <label class="switch-row"><span>👤 Let people without an account join (they type their name)</span><input type="checkbox" id="exGuests" ${last.guests ? 'checked' : ''}><i class="switch"></i></label>
        <div class="setup-foot"><span class="muted small" id="exInfo"></span><button class="btn big-go" id="exGo">Open the exam room 🖥️</button></div>
      </section>`;
    const st = { cnt: last.cnt, pace: last.pace, secs: last.secs, chs: new Set(last.chs || []) };
    const segs = (id, key, cb) => {
      const el = $(id);
      const draw = () => $$('button', el).forEach(b => b.classList.toggle('on', String(st[key]) === b.dataset.v || (key === 'cnt' && b.dataset.v === '0' && ![10, 15, 20, 25, 30].includes(+st.cnt))));
      $$('button', el).forEach(b => b.onclick = () => { st[key] = b.dataset.v === '0' ? 0 : (isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v); draw(); cb && cb(); });
      draw();
    };
    const pool = () => [...new Set([...st.chs].filter(k => Store.CH[k]).flatMap(k => Store.CH[k].keyed))];
    const count = () => { const n = st.cnt || +$('#exCntN').value || 0; return Math.min(n, pool().length); };
    const info = () => {
      $('#exCntN').hidden = !!st.cnt && [10, 15, 20, 25, 30].includes(+st.cnt);
      if (!$('#exCntN').hidden && !$('#exCntN').value && st.cnt) $('#exCntN').value = st.cnt;
      $('#exSecsF').style.display = st.pace === 'timer' ? '' : 'none';
      const p = pool().length, n = count();
      $('#exInfo').innerHTML = p ? `<b>${n}</b> question${n === 1 ? '' : 's'} picked at random from <b>${p}</b> in ${st.chs.size} chapter${st.chs.size === 1 ? '' : 's'}` : 'Choose at least one chapter';
      $('#exGo').disabled = !n;
    };
    const drawChs = () => {
      const bid = $('#exBook').value;
      $('#exChs').innerHTML = App.chKeys(bid).map(k => `<button class="chip ${st.chs.has(k) ? 'on' : ''}" data-k="${esc(k)}" title="${esc(App.strip(Store.CH[k].t))}">${esc(App.chShort(k))} <small>${esc(App.strip(Store.CH[k].t)).slice(0, 34)}</small></button>`).join('');
      $$('#exChs .chip').forEach(c => c.onclick = () => { st.chs.has(c.dataset.k) ? st.chs.delete(c.dataset.k) : st.chs.add(c.dataset.k); c.classList.toggle('on'); info(); });
      info();
    };
    $('#exBook').onchange = () => { st.chs = new Set(); drawChs(); };
    $('#exAll').onclick = () => { App.chKeys($('#exBook').value).forEach(k => st.chs.add(k)); drawChs(); };
    $('#exNone').onclick = () => { st.chs.clear(); drawChs(); };
    $('#exCntN').oninput = info;
    segs('#exCnt', 'cnt', info); segs('#exPace', 'pace', info); segs('#exSecs', 'secs', info);
    // keep only chapters of the chosen book
    const bid0 = $('#exBook').value; st.chs = new Set([...st.chs].filter(k => Store.CH[k] && Store.CH[k].bid === bid0));
    drawChs();
    $('#exGo').onclick = async () => {
      const bid = $('#exBook').value, n = count();
      const chs = App.chKeys(bid).filter(k => st.chs.has(k));
      const cfg = { title: $('#exTitle').value.trim() || `${Books.get(bid).short} exam`, book: bid, chs, pace: st.pace, secs: st.secs, auto: $('#exAuto').checked, guests: $('#exGuests').checked };
      localStorage.setItem('ts.examcfg', JSON.stringify(Object.assign({}, cfg, { cnt: st.cnt || n, title: $('#exTitle').value.trim() })));
      $('#exGo').disabled = true;
      try { const r = await api('/exam', { body: build(cfg, App.shuffle(pool()).slice(0, n)) }); App.go('#/examroom/' + r.id); }
      catch (e) { toast('⚠️ ' + esc(e.message)); $('#exGo').disabled = false; }
    };
  }
  /* the exam sent to the server: ids, option counts, multi flags and keys (never the question text) */
  function build(cfg, ids) {
    const bk = Books.get(cfg.book) || {};
    const chs = cfg.chs || [];
    const all = App.chKeys(cfg.book).length === chs.length;
    return {
      cfg: Object.assign({}, cfg, { ids, nopts: ids.map(id => Store.Q[id].o.length), multi: ids.map(id => Store.multi(Store.Q[id])), bookTitle: bk.short || cfg.book, chapters: all ? 'All chapters' : chs.map(App.chShort).join(', ') }),
      keys: ids.map(id => Store.answers(Store.Q[id]))
    };
  }

  // =====================================================================================
  // EXAMINER: the big screen
  // =====================================================================================
  let H = null;                                   // host state
  function stopHost() { if (H) { clearInterval(H.poll); clearInterval(H.tick); H = null; } wake(false); }
  async function host(id) {
    stopHost();
    if (!Account.me()) return Account.showAuth();
    if (!canHost()) { $('#view').innerHTML = noHostHTML; return; }
    H = { id, d: null, cur: -2, status: '', prev: {}, poll: null, tick: null, confetti: false };
    const v = $('#view');
    v.innerHTML = `<div class="exs" id="exHost"><div class="muted center" style="padding:20vh 0">Opening the exam room…</div></div>`;
    await hostPoll();
    if (!H) return;
    H.poll = setInterval(hostPoll, 1000);
    H.tick = setInterval(hostTick, 200);
    wake(true);
  }
  async function hostPoll() {
    if (!H || !$('#exHost')) return stopHost();
    let d; try { d = await timed('/exam/' + H.id); } catch (e) { if (H && !H.d) $('#exHost').innerHTML = `<p class="muted center">⚠️ ${esc(e.message)}</p><p class="center"><a class="btn" href="#/arena/exam">Back</a></p>`; return; }
    if (!H || !$('#exHost')) return;
    const first = !H.d; H.d = d;
    if (d.status === 'closed') { stopHost(); return App.go('#/arena/exam'); }
    if (d.status !== H.status || (d.status === 'running' && d.cur !== H.cur)) { H.status = d.status; H.cur = d.cur; hostDraw(); }
    else hostUpdate();
    // feed: who finished / left (not on the first load)
    if (!first) d.players.forEach(p => {
      const was = H.prev[p.id];
      if (was && was !== p.status && d.status === 'running') {
        if (p.status === 'left') feed(`⛔ <b>${esc(p.name)}</b> left the exam screen — answers submitted <small>(${esc(p.reason || '')})</small>`, 'bad');
        if (p.status === 'done') feed(`🏁 <b>${esc(p.name)}</b> has finished the exam`, 'good');
      }
      if (!was && d.status === 'lobby') FX.play('tap');
    });
    H.prev = {}; d.players.forEach(p => H.prev[p.id] = p.status);
  }
  function feed(html, cls) {
    const f = $('#exFeed'); if (!f) return;
    const el = document.createElement('div'); el.className = 'exs-feed-i ' + cls; el.innerHTML = html; f.prepend(el);
    setTimeout(() => el.classList.add('out'), 9000); setTimeout(() => el.remove(), 9600);
    FX.play(cls === 'bad' ? 'wrong' : 'tap');
  }
  const topHTML = (d, mid) => `<header class="exs-top"><div class="exs-title"><div class="eyebrow">🖥️ TOP SCORE exam room</div><h1>${esc(d.title)}</h1><p class="muted">${esc(d.bookTitle)} · ${esc(d.chapters)} · ${d.n} questions · ${paceTxt(d)}</p></div>${mid || ''}
    <div class="exs-tools"><button class="icon-btn" id="exFull" title="Full screen">⛶</button><button class="icon-btn" id="exExit" title="Leave the exam screen">✕</button></div></header>`;
  function bindTop() {
    $('#exFull').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => { }); };
    $('#exExit').onclick = async () => {
      const d = H.d;
      if (d.status === 'running' && !await App.confirmBox('Leave the exam screen?', 'The exam keeps running for the examinees. You can come back from Arena → Exam room.', 'Leave', 'Stay')) return;
      stopHost(); App.go('#/arena/exam');
    };
  }
  async function act(a, body) { try { const r = await api(`/exam/${H.id}/${a}`, { body: body || {} }); await hostPoll(); return r; } catch (e) { toast('⚠️ ' + esc(e.message)); } }

  function hostDraw() {
    const d = H.d, root = $('#exHost');
    if (d.status === 'lobby') {
      const url = joinURL(d.code);
      root.innerHTML = topHTML(d) + `
        <div class="exs-lobby">
          <section class="card exs-qr"><div class="qr-box">${qrSVG(url)}</div>
            <div class="exs-code">${d.code.split('').map(c => `<i>${c}</i>`).join('')}</div>
            <p class="muted small">Scan with the phone camera — or open <b>${esc(SITE.replace(/^https?:\/\//, ''))}</b>, Arena → Exam room → Join, and type the code.</p></section>
          <section class="card exs-people"><h2>👥 <span id="exN">0</span> in the exam</h2>
            <div class="exs-names" id="exNames"></div>
            <p class="muted small" id="exHint">Names appear here as people enter.</p>
            <button class="btn big-go block" id="exStart" disabled>▶ Start the exam</button>
            <p class="muted small center">Once the exam starts, nobody else can enter.</p></section>
        </div>`;
      bindTop();
      $('#exStart').onclick = async () => {
        const n = H.d.players.filter(p => p.status === 'in').length;
        if (!await App.confirmBox('Start the exam now?', `${n} examinee${n === 1 ? '' : 's'} will start question 1 together. Entry closes.`, '▶ Start')) return;
        $('#exStart').disabled = true; FX.play('level'); await act('start');
      };
      return hostUpdate();
    }
    if (d.status === 'running') {
      const id = d.cfg.ids[d.cur], q = Store.Q[id];
      root.innerHTML = topHTML(d, `<div class="exs-qn">Question <b>${d.cur + 1}</b> / ${d.n}</div>`) + `
        <div class="exs-run">
          <main class="card exs-q" id="exQ">${q ? `${App.stemHTML(q, { noCredit: false })}<ol class="exs-opts">${q.o.map((o, i) => `<li style="--d:${i * 60}ms"><b>${L(i)}</b><span>${App.optText(q, i)}</span></li>`).join('')}</ol>`
            : `<p class="muted">⚠️ This question (${esc(id)}) is not on this device — load the same book pack on the big screen.</p>`}</main>
          <aside class="exs-side">
            <div class="card exs-clock" id="exClock"></div>
            <div class="card"><div class="row between"><b>Answered</b><b id="exAns">0 / 0</b></div><div class="pbar exs-abar"><i class="mast" id="exAbar" style="width:0"></i></div>
              <div class="exs-plist" id="exPlist"></div></div>
            <div class="row gap wrap"><button class="btn grow" id="exNext">${d.cur + 1 >= d.n ? '🏁 Finish exam' : 'Next question ▶'}</button><button class="btn ghost" id="exEnd">End exam</button></div>
          </aside>
        </div>
        <div class="exs-banner" id="exBanner" hidden></div><div class="exs-feed" id="exFeed"></div>`;
      bindTop();
      $('#exNext').onclick = async () => { $('#exNext').disabled = true; await act('next'); };
      $('#exEnd').onclick = async () => { if (await App.confirmBox('End the exam now?', 'Everyone’s answers so far are submitted and the results are shown.', 'End exam')) act('end'); };
      FX.play('tick');
      return hostUpdate();
    }
    if (d.status === 'done') return hostResults();
  }
  function hostUpdate() {
    const d = H.d;
    if (d.status === 'lobby') {
      const ps = d.players.filter(p => p.status === 'in');
      $('#exN').textContent = ps.length;
      const box = $('#exNames'), have = new Set($$('.exs-name', box).map(x => +x.dataset.p));
      ps.forEach(p => { if (have.has(p.id)) return; const el = document.createElement('span'); el.className = 'exs-name pop-in'; el.dataset.p = p.id; el.innerHTML = `${p.user_id ? '' : '<small>guest</small> '}${esc(p.name)} <button class="exs-kick" title="Remove">✕</button>`; box.appendChild(el); });
      $$('.exs-name', box).forEach(el => { if (!ps.some(p => p.id === +el.dataset.p)) el.remove(); });
      $$('.exs-kick', box).forEach(b => b.onclick = async () => { const el = b.closest('.exs-name'); if (await App.confirmBox('Remove ' + esc(el.textContent.replace('✕', '').trim()) + '?', 'They leave the exam room.', 'Remove')) act('kick', { pid: +el.dataset.p }); });
      $('#exHint').hidden = ps.length > 0;
      $('#exStart').disabled = !ps.length;
      return;
    }
    if (d.status === 'running') {
      const ps = d.players, inP = ps.filter(p => p.status === 'in'), ans = inP.filter(p => p.answered).length;
      $('#exAns').textContent = `${ans} / ${inP.length}`;
      $('#exAbar').style.width = (inP.length ? ans / inP.length * 100 : 0) + '%';
      const t = sNow();
      $('#exPlist').innerHTML = ps.map(p => {
        const st = p.status === 'left' ? ['⛔', 'left — submitted', 'bad'] : p.status === 'done' ? ['🏁', 'finished', 'good'] : p.answered ? ['✅', 'answered', 'ok'] : t - (p.seen || 0) > 9000 ? ['📶', 'no signal', 'warn'] : ['⏳', 'thinking', ''];
        return `<div class="exs-p ${st[2]}"><span>${st[0]}</span><b>${esc(p.name)}</b><small>${st[1]}</small></div>`;
      }).join('');
      hostTick();
    }
  }
  function hostTick() {
    if (!H || !H.d || H.d.status !== 'running') return;
    const c = $('#exClock'); if (!c) return;
    const ts = timerState(H.d);
    if (ts.manual) c.innerHTML = `<div class="exs-elapsed"><small>Time on this question</small><b>${mmss(ts.el)}</b></div>`;
    else {
      const R = 70, C = 2 * Math.PI * R;
      c.className = 'card exs-clock ' + ts.cls;
      c.innerHTML = `<svg viewBox="0 0 160 160" class="exs-ring"><circle cx="80" cy="80" r="${R}" class="bg"/><circle cx="80" cy="80" r="${R}" class="fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - ts.frac)}"/></svg><div class="exs-sec">${Math.ceil(ts.left / 1000)}<small>seconds</small></div>`;
      const s = Math.ceil(ts.left / 1000);
      if (ts.cls === 'danger' && s !== H.lastBeep && s > 0) { H.lastBeep = s; FX.play('tick'); }
    }
    const b = $('#exBanner');
    if (ts.auto !== null && ts.auto > 0) { b.hidden = false; b.innerHTML = `✅ Everyone has answered — next question in <b>${Math.ceil(ts.auto / 1000)}</b>… <small>Examinees can still take an answer back.</small>`; }
    else b.hidden = true;
  }
  function hostResults() {
    const d = H.d, root = $('#exHost'), B = d.board || [];
    const medal = r => ['🥇', '🥈', '🥉'][r - 1] || r;
    const status = p => p.status === 'left' ? `<span class="pill bad">⛔ left the exam screen${p.reason ? ' · ' + esc(p.reason) : ''}</span>` : p.reason === 'finished early' ? '<span class="pill">🏁 finished early</span>' : '';
    const pod = [B[1], B[0], B[2]].filter(Boolean);
    root.innerHTML = topHTML(d, '<div class="exs-qn">🏆 Results</div>') + `
      ${B.length ? `<div class="exs-podium">${pod.map(p => `<div class="exs-pod r${p.rank}"><div class="exs-pod-n">${esc(p.name)}</div><div class="exs-pod-s">${p.score}<small>/${d.n}</small></div><div class="exs-pod-b">${medal(p.rank)}</div></div>`).join('')}</div>` : '<p class="muted center">Nobody took part.</p>'}
      <section class="card exs-board">${B.map((p, i) => `<div class="lb-row" style="--d:${i * 60}ms"><span class="lb-rank">${medal(p.rank)}</span><span class="grow"><b>${esc(p.name)}</b> ${status(p)}<br><small class="muted">${p.answered}/${d.n} answered · ${App.fmtMs(p.ms)} answering</small></span><b class="lb-v">${p.score}/${d.n} <small>${pctTxt(p.score, d.n)}</small></b></div>`).join('')}</section>
      <div class="row gap wrap center-row exs-actions">
        <button class="btn ghost" id="exRev">📋 Review the questions</button>
        <button class="btn" id="exRe1">🔁 Retake (same questions)</button>
        <button class="btn" id="exRe2">🎲 Retake with new questions</button>
        <button class="btn ghost" id="exClose">✖ End the exam screen</button></div>
      <div id="exReview" hidden></div>`;
    bindTop();
    if (!H.confetti && B.length) { H.confetti = true; FX.confetti(220); FX.play('level'); }
    $('#exRev').onclick = () => { const r = $('#exReview'); r.hidden = !r.hidden; if (!r.hidden && !r.innerHTML) r.innerHTML = reviewHTML(d); if (!r.hidden) r.scrollIntoView({ behavior: 'smooth' }); };
    $('#exRe1').onclick = async () => { const r = await act('retake'); if (r && r.id) App.go('#/examroom/' + r.id); };
    $('#exRe2').onclick = async () => {
      const used = new Set(d.cfg.ids);
      const pool = [...new Set((d.cfg.chs || []).filter(k => Store.CH[k]).flatMap(k => Store.CH[k].keyed))];
      if (!pool.length) return toast('⚠️ The chapters of this exam are not on this device');
      const fresh = App.shuffle(pool.filter(x => !used.has(x))), old = App.shuffle(pool.filter(x => used.has(x)));
      const ids = fresh.concat(old).slice(0, d.n);
      const cfg = { title: d.title, book: d.cfg.book, chs: d.cfg.chs, pace: d.cfg.pace, secs: d.cfg.secs, auto: d.cfg.auto, guests: d.cfg.guests };
      const r = await act('retake', build(cfg, ids)); if (r && r.id) App.go('#/examroom/' + r.id);
    };
    $('#exClose').onclick = async () => { if (await App.confirmBox('End the exam screen?', 'The room closes. Results stay with each examinee until they leave the page.', 'End it')) { await act('close'); stopHost(); App.go('#/arena/exam'); } };
  }
  function reviewHTML(d) {
    const players = (d.board || []).length;
    return d.cfg.ids.map((id, i) => {
      const q = Store.Q[id], key = d.keys[i] || [];
      const rows = d.answers.filter(a => a.q === i), cnt = Array(d.cfg.nopts[i]).fill(0);
      let ok = 0; rows.forEach(a => { const c = JSON.parse(a.choice); c.forEach(x => cnt[x]++); if (c.length === key.length && key.every(k => c.includes(k))) ok++; });
      return `<section class="card exs-rev"><div class="row between"><b>Question ${i + 1}</b><span class="pill ${ok / (players || 1) >= .5 ? 'good' : 'bad'}">${ok}/${players} correct</span></div>
        ${q ? `<div class="exs-rev-stem">${App.stemHTML(q)}</div>` : ''}
        <div class="exs-dist">${cnt.map((c, k) => `<div class="exs-dist-r ${key.includes(k) ? 'key' : ''}"><b>${L(k)}</b><span class="grow">${q ? App.optText(q, k) : ''}</span><i style="--w:${players ? c / players * 100 : 0}%"></i><small>${c}</small></div>`).join('')}</div>
        ${q ? App.refLine(q) : ''}</section>`;
    }).join('');
  }
  function qrSVG(text) {
    try { const qr = qrcode(0, 'M'); qr.addData(text); qr.make(); return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); }
    catch (e) { return `<p>${esc(text)}</p>`; }
  }

  // =====================================================================================
  // EXAMINEE: phone
  // =====================================================================================
  let P = null;
  const PKEY = code => 'ts.exam.' + code;
  function stopPlay() { if (P) { clearTimeout(P.poll); clearInterval(P.tick); } disarm(); wake(false); P = null; }
  async function play(code) {
    stopPlay();
    code = String(code || '').toUpperCase();
    document.body.classList.remove('authing'); document.body.classList.add('exam-mode');
    P = { code, s: JSON.parse(sessionStorage.getItem(PKEY(code)) || 'null'), d: null, view: '', cur: -2, sel: new Set(), busy: false, recorded: false };
    $('#view').innerHTML = `<div class="exp" id="exPlay"><div class="muted center" style="padding:20vh 0">Opening the exam…</div></div>`;
    if (P.s) return playPoll();
    let info; try { info = await timed('/exam/info?code=' + encodeURIComponent(code)); } catch (e) { return playMsg('⚠️ ' + esc(e.message), true); }
    if (!P) return;
    if (info.status !== 'lobby') return playMsg(`<h2>⛔ Entry is closed</h2><p class="muted">“${esc(info.title)}” has already ${info.status === 'running' ? 'started' : 'ended'} — nobody can enter after the start.</p>`, true);
    const me = Account.me();
    $('#exPlay').innerHTML = `<section class="card glow exp-join">
      <div class="eyebrow">TOP SCORE exam</div><h1>${esc(info.title)}</h1>
      <p class="muted">${esc(info.bookTitle)} · ${info.n} questions · ${paceTxt(info)}</p>
      <div class="exp-rules"><h3>⚠️ Strict exam rules</h3><ul>
        <li>Once the exam starts, <b>stay on this screen</b>. Switching apps, pulling down notifications, locking the phone, split screen, going back or reloading <b>submits your exam at once</b>.</li>
        <li>Turn on <b>Do Not Disturb</b> now — a call or pop-up could end your exam.</li>
        <li>Your answer counts as soon as you tap it. Tap it again to take it back while the question is still open.</li>
        <li>Your detailed review appears when the whole exam is over.</li></ul></div>
      ${me ? `<p>Entering as <b>${esc(me.display)}</b></p>` : info.guests ? `<label class="field"><span>Your name (shown on the big screen)</span><input id="exName" maxlength="30" autocomplete="name" value="${esc(localStorage.getItem('ts.examname') || '')}"></label>` : ''}
      ${me || info.guests ? `<label class="check-row"><input type="checkbox" id="exAgree"> I understand: leaving the screen submits my exam.</label>
        <button class="btn big-go block" id="exEnter" disabled>Enter the exam</button>` : `<p class="muted">This exam is for TOP SCORE accounts.</p><button class="btn block" id="exLogin">Log in to join</button>`}
    </section>`;
    const ag = $('#exAgree'); if (ag) ag.onchange = () => { $('#exEnter').disabled = !ag.checked; };
    const lg = $('#exLogin'); if (lg) lg.onclick = () => { sessionStorage.setItem('ts.after', '#/x/' + code); Account.showAuth(); };
    const en = $('#exEnter'); if (en) en.onclick = async () => {
      const name = me ? '' : ($('#exName').value || '').trim();
      if (!me && name.length < 2) return toast('Please type your name');
      if (!me) localStorage.setItem('ts.examname', name);
      en.disabled = true;
      goFull();
      try {
        const r = await api('/exam/join', { body: { code, name } });
        P.s = { t: r.token, name: r.name }; sessionStorage.setItem(PKEY(code), JSON.stringify(P.s));
        FX.play('level'); FX.buzz(40); playPoll();
      } catch (e) { toast('⚠️ ' + esc(e.message)); en.disabled = false; }
    };
  }
  function goFull() { try { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => { }); } catch (e) { } }
  function playMsg(html, back) {
    if (!$('#exPlay')) return;
    $('#exPlay').innerHTML = `<section class="card exp-join">${html}${back ? `<p class="mt"><a class="btn" href="${Account.me() ? '#/' : '#/x/'}">OK</a></p>` : ''}</section>`;
  }
  async function playPoll() {
    if (!P || !$('#exPlay')) return stopPlay();
    clearTimeout(P.poll);
    let d;
    try { d = await timed('/exam/play?t=' + encodeURIComponent(P.s.t)); }
    catch (e) {
      if (/not in this exam/i.test(e.message)) { sessionStorage.removeItem(PKEY(P.code)); return playMsg('⛔ You are not in this exam any more.', true); }
      if (P) { const n = $('#expNet'); if (n) n.hidden = false; P.poll = setTimeout(playPoll, 1500); }
      return;
    }
    if (!P || !$('#exPlay')) return;
    const n = $('#expNet'); if (n) n.hidden = true;
    P.d = d;
    const me = d.me;
    if (me.status === 'kicked') { sessionStorage.removeItem(PKEY(P.code)); disarm(); return playMsg(`<h2>You left the exam room</h2><p class="muted">${esc(me.reason || '')}</p>`, true); }
    if (d.status === 'lobby') { if (P.view !== 'lobby') playLobby(); else updLobby(); }
    else if (d.status === 'running' && me.status === 'in') {
      if (P.view !== 'run' || P.cur !== d.cur) playQuestion(); else updQuestion();
      arm();
    } else playResults();
    const wait = d.status === 'running' && me.status === 'in' ? 1000 : d.status === 'lobby' ? 1500 : (d.status === 'done' || d.status === 'closed') ? 5000 : 2500;
    P.poll = setTimeout(playPoll, wait);
  }
  function playLobby() {
    P.view = 'lobby';
    $('#exPlay').innerHTML = `<section class="card glow exp-join exp-wait">
      <div class="exp-pulse">⏳</div><h2>You’re in, ${esc(P.s.name)}!</h2>
      <p class="muted">Waiting for the examiner to start “${esc(P.d.title)}”. Look at the big screen.</p>
      <div class="exs-names small" id="expNames"></div>
      <p class="muted small">Keep this screen open. When the exam starts, <b>leaving this screen submits your exam</b>.</p>
      <div class="row gap center-row wrap"><button class="btn ghost sm" id="expFull">⛶ Full screen</button><button class="btn ghost sm" id="expOut">Leave the room</button></div>
      <p class="warn-t small" id="expNet" hidden>📶 Connection problem — retrying…</p></section>`;
    $('#expFull').onclick = goFull;
    $('#expOut').onclick = async () => { if (!await App.confirmBox('Leave the exam room?', 'You can enter again only before the exam starts.', 'Leave')) return; try { await api('/exam/leave-lobby', { body: { t: P.s.t } }); } catch (e) { } sessionStorage.removeItem(PKEY(P.code)); const c = P.code; stopPlay(); App.go(Account.me() ? '#/arena/exam' : '#/x/' + c); };
    wake(true);
    updLobby();
  }
  function updLobby() { const el = $('#expNames'); if (el) el.innerHTML = (P.d.lobby || []).map(n => `<span class="exs-name ${n === P.s.name ? 'me' : ''}">${esc(n)}</span>`).join(''); }

  function playQuestion() {
    const d = P.d, q = Store.Q[d.q.id];
    if (P.cur !== d.cur) { P.sel = new Set(d.mine || []); P.cur = d.cur; if (P.view === 'run') { FX.play('tick'); FX.buzz(30); } }
    P.view = 'run';
    const n = d.q.nopts;
    $('#exPlay').innerHTML = `
      <div class="exp-top"><span class="exp-qn">Q <b>${d.cur + 1}</b>/${d.n}</span><div class="exp-bar"><i id="expBar"></i></div><b class="exp-t" id="expT"></b></div>
      <div class="exp-q">${q ? `<div class="qcard">${App.stemHTML(q)}</div>` : `<div class="exp-look">👀 Read <b>question ${d.cur + 1}</b> on the big screen</div>`}
        ${d.q.multi ? '<p class="pill multi">Select all that apply, then press Submit</p>' : ''}
        <div class="exp-opts ${q ? '' : 'letters'}">${Array.from({ length: n }, (_, i) => `<button class="opt exp-o" data-i="${i}" style="--d:${i * 50}ms"><span class="ol">${L(i)}</span>${q ? `<span class="ot">${App.optText(q, i)}</span>` : ''}</button>`).join('')}</div>
        ${d.q.multi ? '<button class="btn block mt" id="expSub">Submit answer</button>' : ''}
        <p class="exp-state" id="expState"></p>
        <p class="warn-t small" id="expNet" hidden>📶 Connection problem — retrying…</p>
      </div>
      <div class="exp-foot"><span class="muted small">${esc(P.s.name)} · ⚠️ stay on this screen</span><button class="btn ghost sm" id="expFin">Finish &amp; submit</button></div>
      <div class="exs-banner exp-banner" id="expBanner" hidden></div>`;
    $$('.exp-o').forEach(b => b.onclick = () => choose(+b.dataset.i));
    const sub = $('#expSub'); if (sub) sub.onclick = () => submitMulti();
    $('#expFin').onclick = finish;
    clearInterval(P.tick); P.tick = setInterval(playTick, 200);
    wake(true);
    updQuestion();
  }
  function updQuestion() {
    const d = P.d; if (!P || P.busy) return;
    const sent = d.mine;
    if (!d.q.multi) P.sel = new Set(sent || []);
    else if (sent) P.sel = new Set(sent);
    $$('.exp-o').forEach(b => { const i = +b.dataset.i; b.classList.toggle('picked', P.sel.has(i)); b.classList.toggle('sent', !!sent && sent.includes(i)); });
    const sub = $('#expSub'); if (sub) { sub.disabled = !P.sel.size || !!sent; sub.textContent = sent ? '✅ Submitted' : 'Submit answer'; }
    $('#expState').innerHTML = sent ? `✅ Answer sent${d.q.multi ? '' : ` (<b>${sent.map(L).join(', ')}</b>)`} — tap ${d.q.multi ? 'any option' : 'it again'} to take it back` : (d.q.multi ? 'Choose every correct option, then Submit.' : 'Tap your answer.');
    playTick();
  }
  async function send(choice) {
    P.busy = true;
    try { await api('/exam/answer', { body: { t: P.s.t, q: P.cur, choice } }); P.d.mine = choice; FX.buzz(15); }
    catch (e) { toast('⚠️ ' + esc(e.message)); }
    P.busy = false; updQuestion();
  }
  function choose(i) {
    if (!P || P.busy) return;
    const d = P.d;
    if (!d.q.multi) { const same = d.mine && d.mine.length === 1 && d.mine[0] === i; P.sel = new Set(same ? [] : [i]); updSel(); return send(same ? null : [i]); }
    if (d.mine) { P.sel = new Set(d.mine); P.sel.has(i) ? P.sel.delete(i) : P.sel.add(i); updSel(); return send(null); }   // editing takes the submitted answer back
    P.sel.has(i) ? P.sel.delete(i) : P.sel.add(i); updSel();
    const sub = $('#expSub'); if (sub) sub.disabled = !P.sel.size;
  }
  function updSel() { $$('.exp-o').forEach(b => b.classList.toggle('picked', P.sel.has(+b.dataset.i))); }
  function submitMulti() { if (P.sel.size) send([...P.sel].sort((a, b) => a - b)); }
  function playTick() {
    if (!P || !P.d || P.view !== 'run') return;
    const ts = timerState(P.d); if (!ts) return;
    const t = $('#expT'), bar = $('#expBar'), top = $('.exp-top');
    if (ts.manual) { t.textContent = mmss(ts.el); bar.style.width = '100%'; top.className = 'exp-top manual'; }
    else { t.textContent = mmss(ts.left); bar.style.width = (ts.frac * 100) + '%'; top.className = 'exp-top ' + ts.cls; }
    const b = $('#expBanner');
    if (ts.auto !== null && ts.auto > 0) { b.hidden = false; b.innerHTML = `✅ Everyone has answered — next question in <b>${Math.ceil(ts.auto / 1000)}</b>…<br><small>Tap your answer to take it back.</small>`; }
    else b.hidden = true;
  }
  async function finish() {
    if (!await App.confirmBox('Finish and submit your exam?', 'You cannot come back to the questions. Unanswered questions count as wrong.', 'Submit my exam', 'Keep going')) return;
    disarm();
    try { await api('/exam/finish', { body: { t: P.s.t, reason: 'finished early' } }); } catch (e) { }
    FX.play('level'); playPoll();
  }
  function playResults() {
    const d = P.d, me = d.me, r = d.result || { score: 0, n: d.n, answered: 0 };
    disarm(); clearInterval(P.tick);
    const over = d.status === 'done' || d.status === 'closed';
    const key = JSON.stringify([over, me.status, r.score, !!d.next_code]);
    if (P.view === 'res' && P.resKey === key) return;
    P.view = 'res'; P.resKey = key; wake(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    const head = me.status === 'left' ? `<div class="exp-big bad">⛔</div><h2>Your exam was submitted</h2><p class="muted">You left the exam screen (${esc(me.reason || 'left the app')}). Your answers up to that moment count.</p>`
      : me.reason === 'finished early' ? `<div class="exp-big">🏁</div><h2>You finished the exam</h2>` : `<div class="exp-big">🏁</div><h2>The exam is over</h2>`;
    const rows = over && r.review ? r.review.map((x, i) => {
      const q = Store.Q[x.id];
      return `<details class="exp-rev ${x.ok ? 'ok' : x.mine ? 'no' : 'skip'}" ${x.ok ? '' : 'open'}><summary><span>${x.ok ? '✅' : x.mine ? '❌' : '⚪'}</span><b>Q${i + 1}</b><small>your answer: <b>${x.mine ? x.mine.map(L).join(', ') : 'none'}</b> · key: <b>${x.key.map(L).join(', ')}</b>${x.ms ? ` · ${Math.round(x.ms / 1000)} s` : ''}</small></summary>
        ${q ? `<div class="qcard">${App.stemHTML(q)}${App.optsPrev(q, x.mine && (Store.multi(q) ? x.mine : x.mine[0]))}${App.refLine(q)}</div>` : '<p class="muted small">This question’s text is not on this device.</p>'}</details>`;
    }).join('') : '';
    $('#exPlay').innerHTML = `<section class="card glow exp-join exp-res">${head}
      <div class="exp-score"><b>${r.score}</b><span>/ ${r.n}</span></div><p class="muted">${pctTxt(r.score, r.n)} · ${r.answered} answered</p>
      ${over ? (r.rank ? `<div class="exp-rank">🏆 Rank <b>${r.rank}</b> of ${r.of}</div>` : '') : '<p class="muted small">⏳ The exam is still running for others. Your rank and the review with the answer keys appear here when it ends.</p>'}
      ${d.next_code ? `<a class="btn big-go block" href="#/x/${d.next_code}">🔁 Join the retake</a>` : ''}
      ${over && d.board ? `<div class="exp-board">${d.board.map(p => `<div class="lb-row ${p.me ? 'me' : ''}"><span class="lb-rank">${['🥇', '🥈', '🥉'][p.rank - 1] || p.rank}</span><span class="grow"><b>${esc(p.name)}</b>${p.status === 'left' ? ' <small class="bad-t">⛔ left</small>' : ''}</span><b>${p.score}/${r.n}</b></div>`).join('')}</div>` : ''}
      ${rows ? `<h3 class="mt">Your detailed results</h3>${revSummary(r.review)}<div class="exp-revs">${rows}</div>` : ''}
      <a class="btn ghost block mt" href="${Account.me() ? '#/' : '#/x/'}" id="expDone">${Account.me() ? 'Back to my bookshelf' : 'Close'}</a></section>`;
    if (over && !P.recorded && Account.me() && r.review) {       // count the exam in the examinee's own progress (questions they have)
      P.recorded = true;
      const k = 'ts.examrec.' + P.code;
      if (!localStorage.getItem(k)) { localStorage.setItem(k, '1'); r.review.forEach(x => { if (x.mine && Store.Q[x.id]) Store.answer(x.id, x.ok, { mode: 'x' }); }); }
    }
    if (over && r.rank === 1 && me.status !== 'left') FX.confetti(160);
  }

  function revSummary(rv) {
    const ok = rv.filter(x => x.ok).length, none = rv.filter(x => !x.mine).length, bad = rv.length - ok - none;
    const ms = rv.filter(x => x.ms), avg = ms.length ? Math.round(ms.reduce((a, x) => a + x.ms, 0) / ms.length / 1000) : 0;
    return `<div class="exp-sum"><span class="good">✅ <b>${ok}</b> correct</span><span class="bad">❌ <b>${bad}</b> wrong</span><span>⚪ <b>${none}</b> unanswered</span>${avg ? `<span>⏱️ <b>${avg} s</b> average</span>` : ''}</div>
      <p class="muted small">Wrong and unanswered questions are open below with the book’s answer key.</p>`;
  }

  /* ---------- strict anti-cheat guard (exam room phones + strict Exam Simulator) ----------
     Anything that takes the screen away from the exam ends it. Several independent signals, because phones
     report these events differently: page hidden, window focus lost (event AND polled every 150 ms),
     JavaScript paused (the app went to the background), page frozen / closed / reloaded, leaving full screen,
     the window shrinking (split screen, pop-up / floating window), leaving the exam page. */
  const Guard = (() => {
    let on = false, cb = null, base = null, wasFull = false, hadFocus = false, last = 0, iv = null, settle = 0, okHash = null;
    const h = {};
    function fire(reason) { if (!on) return; const f = cb; stop(); try { f && f(reason); } catch (e) { console.warn(e); } }
    function start(onLose, opts = {}) {
      stop();
      on = true; cb = onLose; okHash = opts.hash || null;
      base = { w: innerWidth, h: innerHeight }; wasFull = !!document.fullscreenElement; hadFocus = document.hasFocus(); last = Date.now(); settle = Date.now() + (opts.settle || 0);
      h.vis = () => { if (document.visibilityState !== 'visible') fire('left the app or the screen turned off'); };
      h.blur = () => { if (Date.now() > settle) fire('something else took the screen (notification panel, call, another app)'); };
      h.hide = () => fire('closed, reloaded or left the page');
      h.freeze = () => fire('the app was sent to the background');
      h.full = () => {
        if (document.fullscreenElement) { wasFull = true; settle = Date.now() + 1000; setTimeout(() => { base = { w: innerWidth, h: innerHeight }; }, 900); return; }
        if (wasFull) fire('left full screen');
      };
      h.size = () => {
        if (Date.now() < settle) { base = { w: innerWidth, h: innerHeight }; return; }
        const w = innerWidth, hh = innerHeight;
        const rotated = Math.abs(w - base.h) <= base.h * 0.2 && Math.abs(hh - base.w) <= base.w * 0.2;
        if (rotated) { base = { w, h: hh }; return; }
        if (Math.abs(w - base.w) > base.w * 0.08 || hh < base.h * 0.85) fire('split screen or pop-up window');
      };
      h.hash = () => { if (okHash && !okHash(location.hash)) fire('left the exam page'); };
      h.ctx = e => e.preventDefault();
      document.addEventListener('visibilitychange', h.vis); addEventListener('blur', h.blur); addEventListener('pagehide', h.hide);
      document.addEventListener('freeze', h.freeze); document.addEventListener('fullscreenchange', h.full);
      addEventListener('resize', h.size); addEventListener('hashchange', h.hash); document.addEventListener('contextmenu', h.ctx);
      iv = setInterval(() => {
        const t = Date.now();
        if (t - last > 2500) return fire('the app was paused (sent to the background)');
        last = t;
        if (document.visibilityState !== 'visible') return fire('left the app or the screen turned off');
        if (document.hasFocus()) hadFocus = true;
        else if (hadFocus && t > settle) fire('something else took the screen (notification panel, call, another app)');
      }, 150);
      document.body.classList.add('exam-locked');
    }
    function stop() {
      if (!on) return; on = false; clearInterval(iv);
      document.removeEventListener('visibilitychange', h.vis); removeEventListener('blur', h.blur); removeEventListener('pagehide', h.hide);
      document.removeEventListener('freeze', h.freeze); document.removeEventListener('fullscreenchange', h.full);
      removeEventListener('resize', h.size); removeEventListener('hashchange', h.hash); document.removeEventListener('contextmenu', h.ctx);
      document.body.classList.remove('exam-locked');
    }
    return { start, stop, on: () => on };
  })();
  const disarm = () => Guard.stop();
  const arm = () => { if (!Guard.on()) Guard.start(lose, { hash: x => x.startsWith('#/x/') }); };
  function lose(reason) {
    if (!P || !P.s) return;
    const payload = JSON.stringify({ t: P.s.t, left: true, reason });
    const url = Account.API + '/exam/finish';
    let ok = false; try { ok = navigator.sendBeacon && navigator.sendBeacon(url, new Blob([payload], { type: 'text/plain' })); } catch (e) { }
    if (!ok) fetch(url, { method: 'POST', body: payload, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => { });
    FX.buzz([200, 80, 200]);
    if (P.d) { P.d.me = { status: 'left', reason, name: P.s.name }; playResults(); }
    setTimeout(() => P && playPoll(), 1200);
  }

  // =====================================================================================
  // Arena tab: host / join / my rooms
  // =====================================================================================
  async function arenaTab(el) {
    const host = canHost();
    el.innerHTML = `
      ${host ? '' : '<!--'}<section class="card exam-hero"><div class="row gap"><span class="exam-hero-ic">🖥️</span><div class="grow"><h2>Host an exam on a big screen</h2>
        <p class="muted small">Pick a book, chapters and the number of questions. A QR code appears on the screen; examinees scan it and answer on their phones, with a live timer and a leaderboard at the end.</p></div></div>
        <a class="btn big-go" href="#/examroom">🖥️ Open the exam room</a></section>${host ? '' : '-->'}
      <section class="card"><h2>📱 Join an exam</h2><p class="muted small">Scan the QR code on the big screen, or type its code.</p>
        <div class="row gap"><input id="exJoinC" maxlength="6" placeholder="CODE" class="exam-code-in" autocapitalize="characters"><button class="btn" id="exJoinGo">Join</button></div></section>
      ${host ? '<section class="card"><h2>Your exam rooms</h2><div id="exMine" class="muted small">Loading…</div></section>' : '<p class="muted small center">Hosting exam rooms is limited to the owner and the people the owner allows.</p>'}`;
    $('#exJoinGo').onclick = () => { const c = $('#exJoinC').value.trim().toUpperCase(); if (c.length >= 4) App.go('#/x/' + c); };
    $('#exJoinC').onkeydown = e => { if (e.key === 'Enter') $('#exJoinGo').click(); };
    if (!host) return;
    try {
      const { exams } = await api('/exam/mine');
      const st = { lobby: '🟢 waiting for examinees', running: '🔴 running', done: '🏁 finished' };
      $('#exMine').innerHTML = exams.map(x => `<a class="list-item" href="#/examroom/${x.id}"><span class="lb-rank">🖥️</span><span class="grow"><b>${esc(x.title)}</b><br><small class="muted">${st[x.status] || x.status} · ${x.n} questions · code ${x.code} · ${App.ago(x.created)}</small></span><span class="chev">›</span></a>`).join('') || 'No open rooms.';
    } catch (e) { $('#exMine').textContent = '⚠️ ' + e.message; }
  }

  App.routes.examroom = arg => { stopPlay(); if (arg) host(+arg); else { stopHost(); setup(); } };
  App.routes.x = arg => { stopHost(); if (!arg) { if (Account.me()) return App.go('#/arena/exam'); return Account.showAuth(); } play(arg); };
  addEventListener('hashchange', () => { const h = location.hash; if (!h.startsWith('#/examroom/')) stopHost(); if (!h.startsWith('#/x/')) { if (P && !Guard.on()) stopPlay(); } });
  window.Exam = { arenaTab, setup, stopHost, stopPlay, Guard };
})();
