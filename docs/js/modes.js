/* TOP SCORE — study modes & games. */
(function () {
  const { $, $$, esc, strip, shuffle, L, toast, modal, confirmBox, ring, animateRings, fmtMs, fmtIvl, chTitle } = App;
  const { Q, CH, ALL, D } = Store;
  const S = () => Store.S;
  const view = () => $('#view');

  const list = [
    { id: 'smart', kind: 'study', ic: '🧠', hue: 265, name: 'Smart Review', short: 'Spaced repetition', desc: 'FSRS spaced repetition: due questions first, then new ones. The most efficient way to remember all of them long-term.' },
    { id: 'challenge', kind: 'study', ic: '🎯', hue: 200, name: 'MCQ Challenge', short: 'Exam all, retry misses', desc: 'Anki-style exam: go through every question in the selection, get your score, then retry just the ones you missed — or all again.' },
    { id: 'learn', kind: 'study', ic: '📖', hue: 160, name: 'Learn', short: 'Read Q + key', desc: 'Read questions with the verified key highlighted. Toggle “cover answers” to self-test as you read.' },
    { id: 'flash', kind: 'study', ic: '🃏', hue: 320, name: 'Flashcards', short: 'Flip & rate', desc: 'Question on the front, verified answer on the back. Rate Again / Hard / Good / Easy (or swipe) and FSRS schedules it.' },
    { id: 'shuffle', kind: 'study', ic: '🔀', hue: 30, name: 'Shuffle Mix', short: 'Interleaved', desc: 'Random questions mixed across your chosen chapters with shuffled options — interleaving builds exam-style flexibility.' },
    { id: 'confidence', kind: 'study', ic: '🎚️', hue: 45, name: 'Confidence Mode', short: 'Bet on certainty', desc: 'Pick an answer, then bet Guess / Likely / Sure. Certainty-based scoring rewards knowing what you know (and exposes lucky guesses).' },
    { id: 'exam', kind: 'study', ic: '⏱️', hue: 0, name: 'Exam Simulator', short: 'Timed, no feedback', desc: 'Board-style timed block. Flag questions, jump around, submit — then a full review with your answers vs the keys.' },
    { id: 'mistakes', kind: 'study', ic: '❌', hue: 350, name: 'Mistakes Vault', short: 'Fix weak spots', desc: 'Only questions you got wrong last time (or still struggle with). Clear the vault!', chapter: true },
    { id: 'flagged', kind: 'study', ic: '⭐', hue: 50, name: 'Starred', short: 'Your bookmarks', desc: 'Practise the questions you starred with ☆ during any session.' },
    { id: 'blitz', kind: 'game', ic: '⚡', hue: 50, name: 'Speed Blitz', short: '60-second sprint', desc: '60 seconds on the clock. Correct answers build a combo multiplier; mistakes cost 3 seconds.', bestUnit: ' pts' },
    { id: 'survival', kind: 'game', ic: '❤️', hue: 350, name: 'Survival', short: '3 lives', desc: 'Endless questions, three lives. How far can you go?', bestUnit: ' correct' },
    { id: 'boss', kind: 'game', ic: '🐉', hue: 280, name: 'Boss Battle', short: 'Defeat the chapter', desc: 'Each chapter is a boss. Correct answers strike (streaks crit!), wrong answers or timeouts hit you back.' },
    { id: 'tf', kind: 'game', ic: '✅', hue: 140, name: 'True or False', short: 'Swipe judge', desc: 'A question and a proposed answer: is it the book key? Swipe right for True, left for False. Fast and addictive.', bestUnit: ' pts' },
    { id: 'match', kind: 'game', ic: '🧩', hue: 190, name: 'Match Pairs', short: 'Link Q ↔ A', desc: 'Match each question to its correct answer on a board of five. Beat the clock with zero mistakes.', bestUnit: ' pts' },
    { id: 'knockout', kind: 'game', ic: '🥊', hue: 15, name: 'Knockout', short: 'Eliminate wrong', desc: 'Tap the WRONG options to knock them out one by one. Hit the correct one and you\'re knocked down. Trains elimination skills.', bestUnit: ' pts' }
  ];
  const M = id => list.find(m => m.id === id);
  let SID = 0;

  // ---------- scope / setup sheet ----------
  function setup(modeId, preset = {}) {
    const m = M(modeId);
    const sel = new Set(preset.chapters || []);
    let filter = modeId === 'mistakes' ? 'mistakes' : modeId === 'flagged' ? 'flagged' : 'all';
    const counts = { challenge: 0, exam: 50, smart: 30, flash: 30, shuffle: 25, confidence: 20, blitz: 0, survival: 0, boss: 0, tf: 20, match: 0, knockout: 10, mistakes: 0, flagged: 0, learn: 0 };
    let count = counts[modeId];
    const needsOne = modeId === 'boss' || modeId === 'learn';
    const showCount = ['exam', 'smart', 'flash', 'shuffle', 'confidence', 'tf', 'knockout'].includes(modeId);
    const sh = modal(`
      <div class="setup">
        <div class="setup-h" style="--h:${m.hue}"><span class="m-ic">${m.ic}</span><div><h3>${m.name}</h3><p class="muted small">${m.desc}</p></div></div>
        <div class="field"><span>Chapters ${needsOne ? '<small class="muted">(choose one)</small>' : ''}</span>
          <div class="row gap wrap">${needsOne ? '' : '<button class="chip" id="selAll">All chapters</button><button class="chip" id="selNone">Clear</button>'}<select id="partSel" class="chip"><option value="">Add a part…</option>${D.parts.map((p, i) => `<option value="${i}">${esc(p)}</option>`).join('')}</select></div>
          <input class="search sm" id="chSearch" placeholder="Find chapter…">
          <div class="ch-pick" id="chPick">${D.chapters.map(c => `<label class="ck" data-t="${esc(strip(c.t).toLowerCase())} ${c.n}"><input type="${needsOne ? 'radio' : 'checkbox'}" name="chp" value="${c.n}" ${sel.has(c.n) ? 'checked' : ''}><span><b>${c.n}</b> ${c.t} <small class="muted">${c.q.length}</small></span></label>`).join('')}</div>
        </div>
        ${needsOne ? '' : `<div class="field"><span>Questions</span><div class="seg" id="flt">${[['all', 'All'], ['new', 'New'], ['due', 'Due'], ['mistakes', 'Mistakes'], ['flagged', 'Starred']].map(f => `<button data-v="${f[0]}" class="${filter === f[0] ? 'on' : ''}">${f[1]}</button>`).join('')}</div></div>`}
        ${showCount ? `<label class="field"><span>Number of questions: <b id="cv">${count}</b></span><input type="range" id="cnt" min="5" max="200" step="5" value="${count}"></label>` : ''}
        <div class="setup-foot"><span class="muted small" id="avail"></span><button class="btn" id="go">Start ${m.ic}</button></div>
      </div>`, { cls: 'sheet' });
    const pick = () => $$('#chPick input:checked', sh).map(i => +i.value);
    const pool = () => {
      let chs = pick(); if (!chs.length && !needsOne) chs = D.chapters.map(c => c.n);
      let ids = [].concat(...chs.map(n => CH[n].ids));
      return filterIds(ids, filter);
    };
    const upd = () => {
      const p = pool(), chs = pick();
      $('#avail', sh).textContent = (needsOne && !chs.length) ? 'Pick a chapter' : `${p.length} questions · ${chs.length ? chs.length + ' chapter' + (chs.length > 1 ? 's' : '') : 'all chapters'}`;
      $('#go', sh).disabled = !p.length;
    };
    $$('#chPick input', sh).forEach(i => i.onchange = upd);
    if ($('#selAll', sh)) { $('#selAll', sh).onclick = () => { $$('#chPick input', sh).forEach(i => i.checked = true); upd(); }; $('#selNone', sh).onclick = () => { $$('#chPick input', sh).forEach(i => i.checked = false); upd(); }; }
    $('#partSel', sh).onchange = e => { if (e.target.value === '') return; const p = +e.target.value; $$('#chPick input', sh).forEach(i => { if (CH[+i.value].p === p) { i.checked = true; } else if (needsOne) i.checked = false; }); if (needsOne) { const f = $$('#chPick input', sh).find(i => CH[+i.value].p === p); $$('#chPick input', sh).forEach(i => i.checked = i === f); } e.target.value = ''; upd(); };
    $('#chSearch', sh).oninput = e => { const q = e.target.value.toLowerCase(); $$('#chPick .ck', sh).forEach(c => c.style.display = c.dataset.t.includes(q) ? '' : 'none'); };
    $$('#flt button', sh).forEach(b => b.onclick = () => { filter = b.dataset.v; $$('#flt button', sh).forEach(x => x.classList.toggle('on', x === b)); upd(); });
    if ($('#cnt', sh)) $('#cnt', sh).oninput = e => { count = +e.target.value; $('#cv', sh).textContent = count; };
    $('#go', sh).onclick = () => { const chs = pick(); sh.close(); start(modeId, { chapters: chs.length ? chs : null, filter, count }); };
    upd();
  }
  function filterIds(ids, f) {
    const st = S(), now = Date.now();
    if (f === 'new') return ids.filter(id => !st.cards[id]);
    if (f === 'due') return ids.filter(id => st.cards[id] && st.cards[id].due <= now);
    if (f === 'mistakes') return ids.filter(id => st.cards[id] && (!st.cards[id].ok || (st.cards[id].w && Store.tier(id) <= 1)));
    if (f === 'flagged') return ids.filter(id => st.flags[id]);
    return ids;
  }
  const scopeName = chs => !chs || chs.length === D.chapters.length ? 'All chapters' : chs.length === 1 ? chTitle(chs[0]) : chs.length + ' chapters';

  // ---------- start ----------
  function start(modeId, o = {}) {
    const chs = o.chapters && o.chapters.length ? o.chapters : null;
    let ids = chs ? [].concat(...chs.map(n => CH[n].ids)) : ALL.slice();
    const filter = o.filter || (modeId === 'mistakes' ? 'mistakes' : modeId === 'flagged' ? 'flagged' : 'all');
    ids = filterIds(ids, filter);
    if (o.fromChapter && (modeId === 'boss' || modeId === 'learn')) ids = CH[o.fromChapter].ids.slice();
    if (!ids.length) { toast(filter === 'mistakes' ? '🎉 No mistakes to fix here!' : filter === 'flagged' ? 'No starred questions yet — tap ☆ during a quiz.' : 'No questions match.'); return; }
    const scope = scopeName(chs);
    const n = o.count;
    const ctx = { modeId, scope, chapters: chs };
    switch (modeId) {
      case 'learn': return learn(chs ? chs[0] : o.fromChapter || 1);
      case 'smart': return quiz(Object.assign(ctx, { title: 'Smart Review', ids: smartQueue(ids, n || 30), feedback: 'instant', fsrs: true }));
      case 'challenge': return quiz(Object.assign(ctx, { title: 'MCQ Challenge', ids: ids.slice(), feedback: 'instant', challenge: true, ordered: !!chs && chs.length === 1 }));
      case 'mistakes': case 'flagged': return quiz(Object.assign(ctx, { title: M(modeId).name, ids: shuffle(ids), feedback: 'instant', challenge: true }));
      case 'shuffle': return quiz(Object.assign(ctx, { title: 'Shuffle Mix', ids: shuffle(ids).slice(0, n || 25), feedback: 'instant', challenge: true, forceShuffle: true }));
      case 'confidence': return quiz(Object.assign(ctx, { title: 'Confidence Mode', ids: shuffle(ids).slice(0, n || 20), feedback: 'instant', confidence: true }));
      case 'exam': return exam(Object.assign(ctx, { ids: shuffle(ids).slice(0, n || 50) }));
      case 'flash': return flash(Object.assign(ctx, { ids: smartQueue(ids, n || 30) }));
      case 'blitz': return quiz(Object.assign(ctx, { title: 'Speed Blitz', ids: shuffle(ids), feedback: 'flash', timeLimit: 60, blitz: true }));
      case 'survival': return quiz(Object.assign(ctx, { title: 'Survival', ids: shuffle(ids), feedback: 'instant', lives: 3, survival: true }));
      case 'boss': return quiz(Object.assign(ctx, { title: 'Boss Battle', ids: shuffle(ids), feedback: 'instant', boss: true, perQ: 40 }));
      case 'tf': return truefalse(Object.assign(ctx, { ids: shuffle(ids).slice(0, n || 20) }));
      case 'match': return match(Object.assign(ctx, { ids }));
      case 'knockout': return knockout(Object.assign(ctx, { ids: shuffle(ids).slice(0, n || 10) }));
    }
  }
  function smartQueue(ids, n) {
    const st = S(), now = Date.now();
    const due = ids.filter(id => st.cards[id] && st.cards[id].due <= now).sort((a, b) => FSRS.currentR(st.cards[a]) - FSRS.currentR(st.cards[b]));
    const fresh = ids.filter(id => !st.cards[id]);
    let q = due.slice(0, n);
    if (q.length < n) q = q.concat(fresh.slice(0, n - q.length));  // new cards in book order
    if (q.length < n) { // nothing due/new: practise the least-stable ones
      const rest = ids.filter(id => !q.includes(id)).sort((a, b) => FSRS.currentR(st.cards[a]) - FSRS.currentR(st.cards[b]));
      q = q.concat(rest.slice(0, n - q.length));
    }
    return q;
  }
  function optOrder(q, force) {
    const idx = q.o.map((_, i) => i);
    if (q.l || !(S().settings.shuffleOpts || force)) return idx;
    return shuffle(idx);
  }
  function enterPlay(guard = true) {
    history.pushState(null, '', '#/play');
    document.body.classList.add('playing');
    App.setLeaveGuard(guard ? () => confirmBox('Leave this session?', 'Your answers so far are saved, but this session will end.', 'Leave', 'Stay') : null);
    window.scrollTo(0, 0);
  }
  function exitPlay(hash = '#/') { App.setLeaveGuard(null); stopKeys(); location.hash = hash; }
  let keyHandler = null;
  function keys(fn) { stopKeys(); keyHandler = e => { if (e.target.matches('input,textarea,select')) return; fn(e); }; addEventListener('keydown', keyHandler); }
  function stopKeys() { if (keyHandler) removeEventListener('keydown', keyHandler); keyHandler = null; }
  const backHash = ctx => ctx.chapters && ctx.chapters.length === 1 ? '#/ch/' + ctx.chapters[0] : (M(ctx.modeId).kind === 'game' ? '#/games' : '#/study');

  const BOSSES = ['🐉', '👹', '🦑', '🐙', '🦂', '🕷️', '🧟', '👾', '🦖', '🐍'];
  const BOSS_NAMES = ['Hydra', 'Leviathan', 'Chimera', 'Golem', 'Wraith', 'Kraken', 'Minotaur', 'Basilisk', 'Gorgon', 'Behemoth'];

  // ---------- generic MCQ runner ----------
  function quiz(cfg) {
    enterPlay();
    const st = S();
    const R = { i: 0, score: 0, correct: 0, wrong: 0, combo: 0, maxCombo: 0, lives: cfg.lives || 0, answers: [], xp: 0, t0: Date.now(), cbm: 0 };
    if (cfg.boss) {
      const n = cfg.chapters ? cfg.chapters[0] : 1;
      R.bossMax = R.bossHp = Math.max(5, Math.ceil(cfg.ids.length * 0.7)) * 10;
      R.hp = 5; R.bossIc = BOSSES[n % BOSSES.length]; R.bossName = 'The ' + strip(CH[n].t).split(/[,:—(]/)[0].trim() + ' ' + BOSS_NAMES[n % BOSS_NAMES.length];
    }
    let timerInt = null, qStart = 0, locked = false, order = [], deadline = cfg.timeLimit ? Date.now() + cfg.timeLimit * 1000 : 0, qDeadline = 0;
    const total = cfg.ids.length;
    const endless = cfg.blitz || cfg.survival || cfg.boss;
    let pool = cfg.ids.slice();

    function frame() {
      view().innerHTML = `
        <div class="play">
          <div class="play-top">
            <button class="icon-btn" id="quit" aria-label="Quit">✕</button>
            <div class="grow">
              <div class="row between small"><b>${esc(cfg.title)}</b><span class="muted" id="ctr"></span></div>
              <div class="prog"><i id="prog"></i></div>
            </div>
            <div class="hud" id="hud"></div>
          </div>
          ${cfg.boss ? `<div class="boss card" id="boss"><div class="boss-ic" id="bossIc">${R.bossIc}</div><div class="grow"><b>${esc(R.bossName)}</b><div class="hpbar boss-hp"><i id="bossHp"></i></div><div class="row between small"><span id="you"></span><span class="muted" id="bossTxt"></span></div></div></div>` : ''}
          <div id="qbox"></div>
        </div>`;
      $('#quit').onclick = () => App.go(backHash(cfg));
    }
    function hud() {
      const parts = [];
      if (cfg.timeLimit) parts.push(`<span class="hud-t" id="tleft">⏱ ${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s</span>`);
      if (cfg.perQ) parts.push(`<span class="hud-t" id="qleft">⏱ ${Math.max(0, Math.ceil((qDeadline - Date.now()) / 1000))}</span>`);
      if (cfg.lives) parts.push(`<span class="hearts">${'❤️'.repeat(R.lives)}${'🖤'.repeat(Math.max(0, cfg.lives - R.lives))}</span>`);
      if (cfg.blitz) parts.push(`<span class="hud-s">${R.score}</span>`);
      if (R.combo >= 2) parts.push(`<span class="combo pop">${R.combo}×</span>`);
      $('#hud').innerHTML = parts.join('');
      const done = R.i;
      $('#ctr').textContent = endless ? `${R.correct} ✓ · ${R.wrong} ✗` : `${Math.min(done + 1, total)} / ${total}`;
      $('#prog').style.width = (cfg.blitz ? Math.max(0, (deadline - Date.now()) / (cfg.timeLimit * 1000)) * 100 : cfg.boss ? (1 - R.bossHp / R.bossMax) * 100 : done / total * 100) + '%';
      if (cfg.boss) {
        $('#bossHp').style.width = (R.bossHp / R.bossMax * 100) + '%';
        $('#bossTxt').textContent = `${R.bossHp} / ${R.bossMax} HP`;
        $('#you').innerHTML = 'You ' + '💚'.repeat(R.hp) + '🖤'.repeat(5 - R.hp);
      }
    }
    function next() {
      locked = false;
      if (cfg.timeLimit && Date.now() >= deadline) return finish();
      if (endless && R.i >= pool.length) pool = pool.concat(shuffle(cfg.ids));
      if (!endless && R.i >= total) return finish();
      const id = pool[R.i]; const q = Q[id];
      order = optOrder(q, cfg.forceShuffle || cfg.blitz || cfg.survival);
      const rf = st.settings.recallFirst && !cfg.blitz && !cfg.timeLimit;
      const flagged = !!st.flags[id];
      $('#qbox').innerHTML = `
        <article class="qcard card slide-in">
          <div class="q-meta"><a class="tag" href="#/ch/${q.ch}" tabindex="-1">Ch ${q.ch} · Q${q.n}</a><span class="tag t${Store.tier(id)}">${Store.TIERS[Store.tier(id)]}</span><button class="star ${flagged ? 'on' : ''}" id="star" aria-label="Star question">${flagged ? '★' : '☆'}</button></div>
          <div class="stem">${q.s}</div>
          ${rf ? `<button class="btn ghost block" id="reveal">🤔 I've thought of my answer — show options</button>` : ''}
          <div class="opts ${rf ? 'hidden' : ''}" id="opts">${order.map((oi, k) => `<button class="opt" data-oi="${oi}" style="--d:${k * 40}ms"><span class="ol">${L(k)}</span><span class="ot">${q.o[oi]}</span></button>`).join('')}</div>
          ${cfg.confidence ? `<div class="conf hidden" id="conf"><div class="muted small center">How sure are you?</div><div class="conf-row"><button data-c="1">🤷 Guess</button><button data-c="2">🙂 Likely</button><button data-c="3">😎 Sure</button></div></div>` : ''}
          <div id="fb"></div>
        </article>`;
      $('#star').onclick = () => { const on = Store.toggleFlag(id); $('#star').textContent = on ? '★' : '☆'; $('#star').classList.toggle('on', on); FX.play('tap'); };
      if (rf) $('#reveal').onclick = () => { $('#opts').classList.remove('hidden'); $('#reveal').remove(); };
      let picked = null;
      $$('.opt').forEach(b => b.onclick = () => {
        if (locked) return;
        if (cfg.confidence) {
          picked = +b.dataset.oi; $$('.opt').forEach(x => x.classList.toggle('sel', x === b)); $('#conf').classList.remove('hidden'); FX.play('tap'); return;
        }
        choose(id, +b.dataset.oi, b);
      });
      if (cfg.confidence) $$('#conf [data-c]').forEach(c => c.onclick = () => { if (picked === null || locked) return; choose(id, picked, $(`.opt[data-oi="${picked}"]`), +c.dataset.c); });
      qStart = Date.now();
      if (cfg.perQ) qDeadline = Date.now() + cfg.perQ * 1000;
      hud();
    }
    function choose(id, oi, btn, conf) {
      if (locked) return; locked = true;
      const q = Q[id], ok = oi === q.a, ms = Date.now() - qStart;
      let grade = ok ? 3 : 1;
      if (conf) grade = ok ? [0, 2, 3, 4][conf] : 1;
      Store.answer(id, ok, { mode: cfg.modeId, ms, conf, grade });
      R.answers.push({ id, oi, ok, conf });
      R.i++;
      let gain = 0;
      if (ok) {
        R.correct++; R.combo++; R.maxCombo = Math.max(R.maxCombo, R.combo);
        gain = 10 + Math.min(10, R.combo - 1) * 2;
        if (cfg.blitz) { const mult = 1 + Math.floor(R.combo / 3); R.score += 100 * mult; }
        if (cfg.boss) { const dmg = R.combo >= 3 ? 15 : 10; R.bossHp = Math.max(0, R.bossHp - dmg); hitBoss(dmg, R.combo >= 3); }
        FX.play(R.combo >= 3 && R.combo % 3 === 0 ? 'combo' : 'correct', R.combo); FX.buzz(15);
        btn && btn.classList.add('right'); FX.burst(btn, '#34d399');
        if (R.combo >= 3 && R.combo % 3 === 0) FX.floatText(btn, `${R.combo}× combo!`, 'combo-txt');
      } else {
        R.wrong++; R.combo = 0;
        if (cfg.blitz) deadline -= 3000;
        if (cfg.lives) R.lives--;
        if (cfg.boss) { R.hp--; const bb = $('#boss'); if (bb) { bb.classList.remove('hurt'); void bb.offsetWidth; bb.classList.add('hurt'); setTimeout(() => bb.classList.remove('hurt'), 700); } }
        FX.play('wrong'); FX.buzz([40, 30, 40]);
        btn && btn.classList.add('wrong');
        $('.qcard').classList.add('shake');
      }
      if (conf) R.cbm += ok ? [0, 1, 2, 3][conf] : [0, 0, -2, -6][conf];
      if (gain) { R.xp += gain; Store.addXP(gain); FX.floatText(btn, '+' + gain + ' XP'); }
      $$('.opt').forEach(b => { b.disabled = true; if (+b.dataset.oi === q.a) b.classList.add('right'); });
      App.checkAch({ combo: R.maxCombo, calib: !!conf });
      hud();
      const over = (cfg.lives && R.lives <= 0) || (cfg.boss && (R.hp <= 0 || R.bossHp <= 0));
      if (cfg.feedback === 'flash') { setTimeout(() => over ? finish() : next(), ok ? 380 : 900); return; }
      const keyNote = order.join() !== q.o.map((_, i) => i).join() ? ' <span class="muted">(original lettering)</span>' : '';
      $('#fb').innerHTML = `
        <div class="fb ${ok ? 'good' : 'bad'} pop-in">
          <div class="fb-h">${ok ? pickOne(['Correct! 🎉', 'Nailed it! ✨', 'Excellent! 🧠', 'Spot on! 🎯']) : 'Not quite 😬'}${conf ? ` <span class="pill">${ok ? '+' : ''}${ok ? [0, 1, 2, 3][conf] : [0, 0, -2, -6][conf]} pts</span>` : ''}</div>
          <div class="fb-key">Book key: <b>${q.k}</b>${keyNote}</div>
          ${q.r ? `<div class="src">📖 ${esc(q.r)}</div>` : ''}
          ${q.x ? `<div class="note">ℹ️ ${esc(q.x)}</div>` : ''}
          ${cfg.fsrs ? `<div class="muted small">Next review: ${fmtIvl(S().cards[id].due - Date.now())}</div>` : ''}
          <button class="btn block" id="nextBtn">${over ? 'See results' : 'Next ›'}</button>
        </div>`;
      $('#nextBtn').onclick = () => over ? finish() : next();
      $('#nextBtn').focus({ preventScroll: true });
      $('#fb').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function hitBoss(dmg, crit) {
      const b = $('#bossIc'); if (!b) return;
      b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit'); FX.play('hit');
      FX.floatText(b, (crit ? 'CRIT −' : '−') + dmg, crit ? 'crit-txt' : 'dmg-txt');
    }
    function tick() {
      if (cfg.timeLimit) {
        const left = deadline - Date.now();
        const el = $('#tleft'); if (el) { el.textContent = '⏱ ' + Math.max(0, Math.ceil(left / 1000)) + 's'; el.classList.toggle('low', left < 10000); }
        if ($('#prog')) $('#prog').style.width = Math.max(0, left / (cfg.timeLimit * 1000)) * 100 + '%';
        if (left <= 0 && !R.done) { finish(); }
      }
      if (cfg.perQ && !locked) {
        const left = qDeadline - Date.now(); const el = $('#qleft');
        if (el) { el.textContent = '⏱ ' + Math.max(0, Math.ceil(left / 1000)); el.classList.toggle('low', left < 8000); }
        if (left < 5000 && left > 4800) FX.play('tick');
        if (left <= 0) { const id = pool[R.i]; choose(id, -1, null); toast('⏰ Time\'s up!'); }
      }
    }
    function pickOne(a) { return a[Math.floor(Math.random() * a.length)]; }
    keys(e => {
      const k = e.key.toLowerCase();
      if (/^[1-9]$/.test(k) || /^[a-i]$/.test(k)) {
        const i = /^[1-9]$/.test(k) ? +k - 1 : k.charCodeAt(0) - 97;
        const b = $$('.opt')[i]; if (b && !b.disabled && !$('#opts').classList.contains('hidden')) b.click();
      } else if ((k === 'enter' || k === ' ') && $('#nextBtn')) { e.preventDefault(); $('#nextBtn').click(); }
      else if (k === 's' && $('#star')) $('#star').click();
    });

    function finish() {
      if (R.done) return; R.done = true;
      clearInterval(timerInt); stopKeys(); App.setLeaveGuard(null);
      const answered = R.answers.length;
      const pct = answered ? Math.round(R.correct / answered * 100) : 0;
      const missed = [...new Set(R.answers.filter(a => !a.ok).map(a => a.id))];
      let headline = '', sub = '', best = false, bestKey = cfg.modeId, bestVal = null;
      if (cfg.blitz) { bestVal = R.score; headline = R.score + ' pts'; sub = `${R.correct} correct in 60 seconds · best combo ${R.maxCombo}×`; if (R.correct >= 20) App.unlock('blitz20'); }
      else if (cfg.survival) { bestVal = R.correct; headline = R.correct + ' survived'; sub = `Best combo ${R.maxCombo}×`; if (R.correct >= 25) App.unlock('surv25'); }
      else if (cfg.boss) {
        const win = R.bossHp <= 0;
        headline = win ? 'Victory! 🏆' : 'Defeated 💀'; sub = win ? `${esc(R.bossName)} has fallen.` : `${esc(R.bossName)} had ${R.bossHp} HP left. Train and return!`;
        if (win) { App.unlock('boss'); Store.addXP(100); R.xp += 100; }
        bestKey = 'boss-' + (cfg.chapters ? cfg.chapters[0] : 0); bestVal = win ? 1 : null;
      } else {
        headline = pct + '%'; sub = `${R.correct} of ${answered} correct${R.maxCombo > 2 ? ` · best combo ${R.maxCombo}×` : ''}`;
        if (cfg.challenge && cfg.chapters && cfg.chapters.length === 1 && answered === CH[cfg.chapters[0]].ids.length && !cfg.retry) {
          bestKey = 'challenge-' + cfg.chapters[0]; bestVal = pct; if (pct === 100) App.unlock('perfect');
        }
        if (cfg.confidence) { sub += ` · certainty score ${R.cbm} / ${answered * 3}`; bestVal = R.cbm; }
      }
      if (bestVal !== null) best = Store.setBest(bestKey, bestVal);
      Store.session({ mode: cfg.modeId, name: cfg.title, scope: cfg.scope, score: cfg.blitz ? R.score : R.correct, total: endless ? undefined : answered });
      const great = cfg.boss ? R.bossHp <= 0 : (pct >= 80 || (cfg.blitz && R.correct >= 10) || (cfg.survival && R.correct >= 10));
      if (great) { FX.confetti(); FX.play('win'); } else FX.play(pct >= 50 ? 'correct' : 'lose');
      const chBreak = {};
      R.answers.forEach(a => { const c = Q[a.id].ch; chBreak[c] = chBreak[c] || [0, 0]; chBreak[c][1]++; if (a.ok) chBreak[c][0]++; });
      view().innerHTML = `
        <div class="results">
          <div class="card glow res-hero">
            <div class="res-ring">${ring(cfg.boss ? (R.bossHp <= 0 ? 1 : 1 - R.bossHp / R.bossMax) : pct / 100, 150, 12, '')}<div class="res-in"><b>${headline}</b></div></div>
            <h2>${verdict(pct, cfg)}</h2>
            <p class="muted">${sub}</p>
            ${best ? '<div class="pill gold">🏆 New personal best!</div>' : ''}
            <div class="res-stats"><div><b>+${R.xp}</b><small>XP</small></div><div><b>${fmtMs(Date.now() - R.t0)}</b><small>time</small></div><div><b>${R.correct}</b><small>correct</small></div><div><b>${R.wrong}</b><small>wrong</small></div></div>
          </div>
          <div class="res-actions">
            ${missed.length && !endless ? `<button class="btn" id="retryMiss">🔁 Retry the ${missed.length} I missed</button>` : ''}
            ${!endless ? `<button class="btn ${missed.length ? 'ghost' : ''}" id="retryAll">↻ Exam me on all ${total} again</button>` : `<button class="btn" id="again">↻ Play again</button>`}
            <button class="btn ghost" id="review">📋 Review answers</button>
            <button class="btn ghost" id="done">Done</button>
          </div>
          ${Object.keys(chBreak).length > 1 ? `<div class="card"><h3>By chapter</h3>${Object.entries(chBreak).sort((a, b) => a[1][0] / a[1][1] - b[1][0] / b[1][1]).map(([c, v]) => `<div class="list-item"><span class="grow small">${esc(chTitle(+c))}</span><b>${v[0]}/${v[1]}</b></div>`).join('')}</div>` : ''}
          <div id="revList"></div>
        </div>`;
      animateRings(view());
      const again = ids => quiz(Object.assign({}, cfg, { ids, retry: true }));
      if ($('#retryMiss')) $('#retryMiss').onclick = () => again(shuffle(missed));
      if ($('#retryAll')) $('#retryAll').onclick = () => again(cfg.ordered ? cfg.ids.slice() : shuffle(cfg.ids));
      if ($('#again')) $('#again').onclick = () => quiz(Object.assign({}, cfg, { ids: shuffle(cfg.ids) }));
      $('#review').onclick = () => { $('#revList').innerHTML = reviewList(R.answers); $('#revList').scrollIntoView({ behavior: 'smooth' }); };
      $('#done').onclick = () => exitPlay(backHash(cfg));
      backupNudge();
    }
    frame(); next();
    const sid = String(++SID); view().dataset.sid = sid;
    timerInt = setInterval(() => { if (view().dataset.sid !== sid) return clearInterval(timerInt); tick(); }, 200);
  }
  function verdict(pct, cfg) {
    if (cfg.boss || cfg.blitz || cfg.survival) return cfg.boss ? 'Boss battle over' : 'Game over';
    return pct === 100 ? 'Perfect score! 🏆' : pct >= 90 ? 'Outstanding! 🌟' : pct >= 80 ? 'Board-ready level 💪' : pct >= 65 ? 'Good progress 👍' : pct >= 50 ? 'Getting there 📈' : 'Keep practising — repetition wins 🔁';
  }
  function reviewList(answers) {
    return `<div class="card"><h3>Answer review</h3>${answers.map((a, i) => {
      const q = Q[a.id];
      return `<details class="q-prev ${a.ok ? '' : 'open-bad'}" ${a.ok ? '' : 'open'}><summary><span class="pill ${a.ok ? 'good' : 'bad'}">${a.ok ? '✓' : '✗'}</span><span class="qn">${i + 1}</span><span class="grow">${q.s}</span></summary>
        <ol class="opts-prev">${q.o.map((o, k) => `<li class="${k === q.a ? 'ok' : ''} ${k === a.oi && !a.ok ? 'no' : ''}"><b>${L(k)}.</b> ${o}${k === a.oi ? ' <small>← your answer</small>' : ''}</li>`).join('')}</ol>
        ${a.oi === -1 ? '<div class="muted small">⏰ Not answered</div>' : ''}
        <div class="src">${esc(chTitle(q.ch))} · Q${q.n}${q.r ? ' · 📖 ' + esc(q.r) : ''}</div>${q.x ? `<div class="note">ℹ️ ${esc(q.x)}</div>` : ''}</details>`;
    }).join('')}</div>`;
  }
  function backupNudge() {
    const st = S();
    if (App.needBackup() && Date.now() - (st.backupNag || 0) > 3600000 * 6) {
      st.backupNag = Date.now(); Store.save();
      setTimeout(() => {
        const m = modal(`<div class="center"><div class="intro-logo">💾</div><h3>Protect your progress</h3><p class="muted">You've answered <b>${st.sinceBackup}</b> questions since your last backup. Save a backup file to your phone now — if the browser cache is ever cleared, you can restore it and continue exactly where you left off.</p>
          <div class="row gap center-row"><button class="btn ghost" id="later">Later</button><button class="btn" id="bk">💾 Back up now</button></div></div>`, { cls: 'center-modal' });
        $('#later', m).onclick = () => m.close(); $('#bk', m).onclick = () => { m.close(); App.doExport(); };
      }, 1200);
    }
  }

  // ---------- exam simulator ----------
  function exam(cfg) {
    enterPlay();
    const st = S(), n = cfg.ids.length;
    const E = { cur: 0, ans: {}, flags: {}, orders: {}, t0: Date.now(), deadline: Date.now() + n * st.settings.examSecs * 1000, qStart: Date.now(), time: {} };
    cfg.ids.forEach(id => E.orders[id] = optOrder(Q[id], false));
    let timer;
    function draw() {
      const id = cfg.ids[E.cur], q = Q[id], ord = E.orders[id];
      view().innerHTML = `
        <div class="play exam">
          <div class="play-top">
            <button class="icon-btn" id="quit" aria-label="Quit">✕</button>
            <div class="grow"><div class="row between small"><b>Exam Simulator</b><span class="muted">${Object.keys(E.ans).length}/${n} answered</span></div><div class="prog"><i style="width:${Object.keys(E.ans).length / n * 100}%"></i></div></div>
            <div class="hud"><span class="hud-t" id="etime"></span></div>
          </div>
          <article class="qcard card">
            <div class="q-meta"><span class="tag">Question ${E.cur + 1} of ${n}</span><button class="chip ${E.flags[id] ? 'on' : ''}" id="flag">${E.flags[id] ? '🚩 Flagged' : '⚑ Flag for review'}</button></div>
            <div class="stem">${q.s}</div>
            <div class="opts">${ord.map((oi, k) => `<button class="opt ${E.ans[id] === oi ? 'sel' : ''}" data-oi="${oi}"><span class="ol">${L(k)}</span><span class="ot">${q.o[oi]}</span></button>`).join('')}</div>
            <div class="row between mt"><button class="btn ghost" id="prev" ${E.cur ? '' : 'disabled'}>‹ Prev</button><button class="btn ghost" id="grid">▦ ${n}</button><button class="btn" id="nxt">${E.cur === n - 1 ? 'Finish' : 'Next ›'}</button></div>
          </article>
        </div>`;
      $('#quit').onclick = () => App.go(backHash(cfg));
      $$('.opt').forEach(b => b.onclick = () => { E.ans[id] = +b.dataset.oi; $$('.opt').forEach(x => x.classList.toggle('sel', x === b)); FX.play('tap'); });
      $('#flag').onclick = () => { E.flags[id] = !E.flags[id]; draw(); };
      $('#prev').onclick = () => move(E.cur - 1);
      $('#nxt').onclick = () => E.cur === n - 1 ? submitAsk() : move(E.cur + 1);
      $('#grid').onclick = gridModal;
      tick();
    }
    function move(i) { const id = cfg.ids[E.cur]; E.time[id] = (E.time[id] || 0) + Date.now() - E.qStart; E.qStart = Date.now(); E.cur = Math.max(0, Math.min(n - 1, i)); draw(); }
    function gridModal() {
      const m = modal(`<h3>Navigator</h3><div class="navgrid">${cfg.ids.map((id, i) => `<button class="${E.ans[id] !== undefined ? 'done' : ''} ${E.flags[id] ? 'flag' : ''} ${i === E.cur ? 'cur' : ''}" data-i="${i}">${i + 1}</button>`).join('')}</div>
        <p class="muted small">Answered ${Object.keys(E.ans).length} · Flagged ${Object.values(E.flags).filter(Boolean).length}</p><button class="btn block" id="sub">Submit exam</button>`);
      $$('[data-i]', m).forEach(b => b.onclick = () => { m.close(); move(+b.dataset.i); });
      $('#sub', m).onclick = () => { m.close(); submitAsk(); };
    }
    async function submitAsk() {
      const un = n - Object.keys(E.ans).length;
      if (await confirmBox('Submit exam?', un ? `${un} question${un > 1 ? 's are' : ' is'} unanswered and will count as wrong.` : 'All questions answered.', 'Submit', 'Keep working')) submit();
    }
    function tick() {
      const left = E.deadline - Date.now(), el = $('#etime');
      if (el) { const s = Math.max(0, Math.ceil(left / 1000)); el.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; el.classList.toggle('low', left < 60000); }
      if (left <= 0) { toast('⏰ Time is up — exam submitted'); submit(); }
    }
    function submit() {
      clearInterval(timer); stopKeys(); App.setLeaveGuard(null);
      const answers = cfg.ids.map(id => { const oi = E.ans[id] ?? -1, ok = oi === Q[id].a; Store.answer(id, ok, { mode: 'exam', ms: E.time[id] || 0 }); return { id, oi, ok }; });
      const c = answers.filter(a => a.ok).length, pct = Math.round(c / n * 100);
      Store.addXP(c * 12);
      Store.session({ mode: 'exam', name: 'Exam Simulator', scope: cfg.scope, score: c, total: n });
      const best = Store.setBest('exam', pct);
      if (pct >= 80 && n >= 50) App.unlock('exam80');
      App.checkAch({});
      if (pct >= 80) { FX.confetti(); FX.play('win'); } else FX.play(pct >= 50 ? 'correct' : 'lose');
      const missed = answers.filter(a => !a.ok).map(a => a.id);
      view().innerHTML = `<div class="results"><div class="card glow res-hero"><div class="res-ring">${ring(pct / 100, 150, 12, '')}<div class="res-in"><b>${pct}%</b></div></div>
        <h2>${pct >= 80 ? 'Pass-level performance 🎓' : pct >= 65 ? 'Close — keep pushing 📈' : 'More practice needed 🔁'}</h2><p class="muted">${c} / ${n} correct · ${fmtMs(Date.now() - E.t0)}</p>${best ? '<div class="pill gold">🏆 New best exam score!</div>' : ''}</div>
        <div class="res-actions">${missed.length ? `<button class="btn" id="rm">🔁 Retry the ${missed.length} missed</button>` : ''}<button class="btn ghost" id="new">New exam</button><button class="btn ghost" id="done">Done</button></div>${reviewList(answers)}</div>`;
      animateRings(view());
      if ($('#rm')) $('#rm').onclick = () => quiz(Object.assign({}, cfg, { modeId: 'challenge', title: 'Retry missed', ids: shuffle(missed), feedback: 'instant', challenge: true, retry: true }));
      $('#new').onclick = () => setup('exam', { chapters: cfg.chapters });
      $('#done').onclick = () => exitPlay(backHash(cfg));
      backupNudge();
    }
    keys(e => {
      const k = e.key.toLowerCase();
      if (/^[1-9]$/.test(k)) { const b = $$('.opt')[+k - 1]; b && b.click(); }
      else if (k === 'arrowright' || k === 'enter') $('#nxt') && $('#nxt').click();
      else if (k === 'arrowleft') $('#prev') && $('#prev').click();
    });
    draw();
    const sid = String(++SID); view().dataset.sid = sid;
    timer = setInterval(() => { if (view().dataset.sid !== sid) return clearInterval(timer); tick(); }, 500);
  }

  // ---------- learn ----------
  function learn(n) {
    const ch = CH[n]; let cover = false;
    App.setLeaveGuard(null);
    history.pushState(null, '', '#/play');
    document.body.classList.add('playing');
    const draw = () => {
      view().innerHTML = `<div class="play learn">
        <div class="play-top"><button class="icon-btn" id="quit">✕</button><div class="grow"><b>Learn · ${esc(chTitle(n))}</b><div class="muted small">${ch.q.length} questions</div></div>
        <label class="switch-row compact"><span>Cover answers</span><input type="checkbox" id="cov" ${cover ? 'checked' : ''}><i class="switch"></i></label></div>
        ${ch.ids.map(id => { const q = Q[id]; return `<article class="card learn-q ${cover ? 'covered' : ''}" data-id="${id}">
          <div class="q-meta"><span class="tag">Q${q.n}</span><span class="tag t${Store.tier(id)}">${Store.TIERS[Store.tier(id)]}</span><button class="star ${S().flags[id] ? 'on' : ''}" data-star="${id}">${S().flags[id] ? '★' : '☆'}</button></div>
          <div class="stem">${q.s}</div>
          <ol class="opts-prev">${q.o.map((o, i) => `<li class="${i === q.a ? 'ok' : ''}"><b>${L(i)}.</b> ${o}</li>`).join('')}</ol>
          ${cover ? '<button class="chip reveal-one">👁 Reveal answer</button>' : ''}
          <div class="src">${q.r ? '📖 ' + esc(q.r) : ''}</div>${q.x ? `<div class="note">ℹ️ ${esc(q.x)}</div>` : ''}</article>`; }).join('')}
        <div class="row gap center-row mt"><button class="btn" id="toCh">🎯 Now challenge this chapter</button></div></div>`;
      $('#quit').onclick = () => { document.body.classList.remove('playing'); location.hash = '#/ch/' + n; };
      $('#cov').onchange = e => { cover = e.target.checked; draw(); };
      $$('.reveal-one').forEach(b => b.onclick = () => { b.closest('.learn-q').classList.remove('covered'); b.remove(); FX.play('flip'); });
      $$('[data-star]').forEach(b => b.onclick = () => { const on = Store.toggleFlag(b.dataset.star); b.textContent = on ? '★' : '☆'; b.classList.toggle('on', on); });
      $('#toCh').onclick = () => start('challenge', { chapters: [n] });
    };
    draw(); window.scrollTo(0, 0);
  }

  // ---------- flashcards ----------
  function flash(cfg) {
    enterPlay();
    let queue = cfg.ids.slice(), done = 0, again = 0, flipped = false, xp = 0;
    const t0 = Date.now(), total = queue.length;
    function draw() {
      if (!queue.length) return end();
      const id = queue[0], q = Q[id];
      flipped = false;
      const prev = FSRS.preview(S().cards[id] || {});
      view().innerHTML = `<div class="play flash">
        <div class="play-top"><button class="icon-btn" id="quit">✕</button><div class="grow"><div class="row between small"><b>Flashcards</b><span class="muted">${done} done · ${queue.length} left</span></div><div class="prog"><i style="width:${done / (done + queue.length) * 100}%"></i></div></div></div>
        <div class="fc-stage"><div class="fc" id="fc" tabindex="0">
          <div class="fc-face fc-front"><div class="q-meta"><span class="tag">Ch ${q.ch} · Q${q.n}</span><span class="tag t${Store.tier(id)}">${Store.TIERS[Store.tier(id)]}</span></div><div class="stem">${q.s}</div><div class="fc-hint">Recall the answer, then tap to flip ↻</div></div>
          <div class="fc-face fc-back"><div class="muted small">Answer</div><div class="fc-ans">${q.o[q.a]}</div><div class="fc-key">Book key: ${q.k}</div>${q.r ? `<div class="src">📖 ${esc(q.r)}</div>` : ''}${q.x ? `<div class="note">ℹ️ ${esc(q.x)}</div>` : ''}
            <details class="fc-all"><summary>All options</summary><ol class="opts-prev">${q.o.map((o, i) => `<li class="${i === q.a ? 'ok' : ''}"><b>${L(i)}.</b> ${o}</li>`).join('')}</ol></details></div>
        </div></div>
        <div class="rate hidden" id="rate">${['Again', 'Hard', 'Good', 'Easy'].map((r, i) => `<button class="r${i + 1}" data-g="${i + 1}"><b>${r}</b><small>${fmtIvl(prev[i])}</small></button>`).join('')}</div>
        <p class="muted small center" id="swipeHint">Swipe ← Again · → Good · ↑ Easy</p></div>`;
      $('#quit').onclick = () => App.go(backHash(cfg));
      const fc = $('#fc');
      fc.onclick = e => { if (e.target.closest('details')) return; flip(); };
      $$('#rate [data-g]').forEach(b => b.onclick = () => rate(+b.dataset.g));
      swipe(fc);
    }
    function flip() { flipped = !flipped; $('#fc').classList.toggle('flipped', flipped); if (flipped) $('#rate').classList.remove('hidden'); FX.play('flip'); }
    function rate(g) {
      if (!flipped) { flip(); return; }
      const id = queue.shift();
      Store.rate(id, g, 'flash');
      const gain = [0, 2, 6, 10, 12][g]; xp += gain; Store.addXP(gain);
      if (g === 1) { again++; queue.splice(Math.min(queue.length, 3 + Math.floor(Math.random() * 3)), 0, id); FX.play('wrong'); }
      else { done++; FX.play('correct'); }
      const fc = $('#fc'); fc.classList.add(g === 1 ? 'fly-left' : g === 4 ? 'fly-up' : 'fly-right');
      App.checkAch({});
      setTimeout(draw, 260);
    }
    function swipe(el) {
      let x0 = null, y0 = null, dx = 0, dy = 0;
      el.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; dx = dy = 0; el.setPointerCapture(e.pointerId); });
      el.addEventListener('pointermove', e => { if (x0 === null) return; dx = e.clientX - x0; dy = e.clientY - y0; if (flipped && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) el.style.transform = `translate(${dx}px,${Math.min(0, dy)}px) rotate(${dx / 20}deg) rotateY(180deg)`; });
      el.addEventListener('pointerup', () => {
        if (x0 === null) return; const ax = Math.abs(dx), ay = Math.abs(dy); x0 = null; el.style.transform = '';
        if (!flipped) return;
        if (ax > 90 && ax > ay) { rate(dx > 0 ? 3 : 1); } else if (dy < -90 && ay > ax) { rate(4); }
      });
      el.addEventListener('click', e => { if (Math.abs(dx) > 10 || Math.abs(dy) > 10) { e.stopImmediatePropagation(); } }, true);
    }
    function end() {
      stopKeys(); App.setLeaveGuard(null);
      Store.session({ mode: 'flash', name: 'Flashcards', scope: cfg.scope, score: total, total });
      FX.confetti(120); FX.play('win');
      view().innerHTML = `<div class="results"><div class="card glow res-hero"><div class="intro-logo">🃏</div><h2>Deck complete!</h2><p class="muted">${total} cards · ${again} “Again” repeats · ${fmtMs(Date.now() - t0)}</p>
        <div class="res-stats"><div><b>+${xp}</b><small>XP</small></div><div><b>${Store.dueIds(cfg.ids).length}</b><small>still due</small></div></div></div>
        <div class="res-actions"><button class="btn" id="more">Next deck</button><button class="btn ghost" id="done">Done</button></div></div>`;
      $('#more').onclick = () => start('flash', { chapters: cfg.chapters, count: total });
      $('#done').onclick = () => exitPlay(backHash(cfg));
      backupNudge();
    }
    keys(e => {
      const k = e.key;
      if (k === ' ' || k === 'Enter') { e.preventDefault(); flip(); }
      else if (/^[1-4]$/.test(k) && flipped) rate(+k);
      else if (k === 'ArrowLeft' && flipped) rate(1); else if (k === 'ArrowRight' && flipped) rate(3); else if (k === 'ArrowUp' && flipped) rate(4);
    });
    draw();
  }

  // ---------- true / false ----------
  function truefalse(cfg) {
    enterPlay();
    const items = cfg.ids.map(id => {
      const q = Q[id], truth = Math.random() < 0.5;
      let oi = q.a;
      if (!truth) { const wrong = q.o.map((_, i) => i).filter(i => i !== q.a); oi = wrong[Math.floor(Math.random() * wrong.length)]; }
      return { id, oi, truth };
    });
    let i = 0, score = 0, combo = 0, maxC = 0, correct = 0, xp = 0, locked = false; const res = [];
    function draw() {
      if (i >= items.length) return end();
      locked = false;
      const it = items[i], q = Q[it.id];
      view().innerHTML = `<div class="play tf">
        <div class="play-top"><button class="icon-btn" id="quit">✕</button><div class="grow"><div class="row between small"><b>True or False</b><span class="muted">${i + 1}/${items.length}</span></div><div class="prog"><i style="width:${i / items.length * 100}%"></i></div></div><div class="hud"><span class="hud-s">${score}</span>${combo >= 2 ? `<span class="combo pop">${combo}×</span>` : ''}</div></div>
        <div class="tf-card card slide-in" id="tfc"><div class="q-meta"><span class="tag">Ch ${q.ch} · Q${q.n}</span></div><div class="stem">${q.s}</div><div class="tf-claim"><small>Proposed answer</small><div>${q.o[it.oi]}</div></div><div class="tf-stamp" id="stamp"></div></div>
        <div class="tf-btns"><button class="tf-no" id="no">✗ False</button><button class="tf-yes" id="yes">✓ True</button></div>
        <p class="muted small center">Swipe the card or use ← / →</p><div id="fb"></div></div>`;
      $('#quit').onclick = () => App.go(backHash(cfg));
      $('#yes').onclick = () => judge(true); $('#no').onclick = () => judge(false);
      const c = $('#tfc'); let x0 = null, dx = 0;
      c.addEventListener('pointerdown', e => { x0 = e.clientX; dx = 0; c.setPointerCapture(e.pointerId); });
      c.addEventListener('pointermove', e => { if (x0 === null || locked) return; dx = e.clientX - x0; c.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`; c.style.setProperty('--tilt', Math.max(-1, Math.min(1, dx / 120))); });
      c.addEventListener('pointerup', () => { if (x0 === null) return; x0 = null; c.style.transform = ''; if (Math.abs(dx) > 90) judge(dx > 0); });
    }
    function judge(says) {
      if (locked) return; locked = true;
      const it = items[i], q = Q[it.id], ok = says === it.truth;
      Store.answer(it.id, ok, { mode: 'tf' });
      res.push({ id: it.id, oi: ok ? q.a : (it.truth ? -1 : it.oi), ok });
      const stamp = $('#stamp'); stamp.textContent = ok ? '✓' : '✗'; stamp.className = 'tf-stamp on ' + (ok ? 'good' : 'bad');
      if (ok) { correct++; combo++; maxC = Math.max(maxC, combo); score += 100 * (1 + Math.floor(combo / 4)); const g = 6 + Math.min(combo, 8); xp += g; Store.addXP(g); FX.play('correct'); FX.burst($('#tfc'), '#34d399'); FX.buzz(15); }
      else { combo = 0; FX.play('wrong'); FX.buzz([40, 30, 40]); $('#tfc').classList.add('shake'); }
      $('#fb').innerHTML = `<div class="fb ${ok ? 'good' : 'bad'} pop-in"><div class="fb-h">${ok ? 'Correct!' : 'Wrong!'} The statement was <b>${it.truth ? 'TRUE' : 'FALSE'}</b>.</div><div class="fb-key">Book key: <b>${q.k}</b></div><button class="btn block" id="nextBtn">Next ›</button></div>`;
      $('#nextBtn').onclick = () => { i++; draw(); };
      App.checkAch({ combo: maxC });
    }
    function end() {
      stopKeys(); App.setLeaveGuard(null);
      const best = Store.setBest('tf', score);
      Store.session({ mode: 'tf', name: 'True or False', scope: cfg.scope, score: correct, total: items.length });
      if (correct / items.length >= 0.8) { FX.confetti(); FX.play('win'); } else FX.play('correct');
      view().innerHTML = `<div class="results"><div class="card glow res-hero"><div class="intro-logo">✅</div><h2>${score} pts</h2><p class="muted">${correct}/${items.length} judged correctly · best combo ${maxC}×</p>${best ? '<div class="pill gold">🏆 New best!</div>' : ''}<div class="res-stats"><div><b>+${xp}</b><small>XP</small></div></div></div>
        <div class="res-actions"><button class="btn" id="again">↻ Play again</button><button class="btn ghost" id="rv">📋 Review</button><button class="btn ghost" id="done">Done</button></div><div id="revList"></div></div>`;
      $('#again').onclick = () => truefalse(Object.assign({}, cfg, { ids: shuffle(cfg.ids) }));
      $('#rv').onclick = () => $('#revList').innerHTML = reviewList(res);
      $('#done').onclick = () => exitPlay(backHash(cfg));
      backupNudge();
    }
    keys(e => { if (e.key === 'ArrowRight') judge(true); else if (e.key === 'ArrowLeft') judge(false); else if ((e.key === 'Enter' || e.key === ' ') && $('#nextBtn')) { e.preventDefault(); $('#nextBtn').click(); } });
    draw();
  }

  // ---------- match pairs ----------
  function match(cfg) {
    const BAD = /\babove\b|\bbelow\b|\bboth\b|^[A-I](\s|,|$)|\b[A-I]\s*(,|and|\+)\s*[A-I]\b|^none\b|^all\b/i;
    const usable = cfg.ids.filter(id => { const q = Q[id], a = strip(q.o[q.a]); return a.length <= 90 && !BAD.test(a); });
    if (usable.length < 3) { toast('Not enough short-answer questions in this selection — pick more chapters.'); return; }
    enterPlay();
    let round = 0, pts = 0, totalMiss = 0, xp = 0; const t0 = Date.now(); const rounds = 3;
    let deck = shuffle(usable);
    function board() {
      // pick up to 5 with unique answer texts
      const chosen = [], seenA = new Set();
      while (deck.length && chosen.length < 5) { const id = deck.shift(); const a = strip(Q[id].o[Q[id].a]).toLowerCase(); if (!seenA.has(a)) { seenA.add(a); chosen.push(id); } }
      if (chosen.length < 3) { deck = shuffle(usable); return board(); }
      let selL = null, miss = 0, left = chosen.length; const rs = Date.now();
      view().innerHTML = `<div class="play match">
        <div class="play-top"><button class="icon-btn" id="quit">✕</button><div class="grow"><div class="row between small"><b>Match Pairs · Round ${round + 1}/${rounds}</b><span class="muted" id="mt">0s</span></div><div class="prog"><i style="width:${round / rounds * 100}%"></i></div></div><div class="hud"><span class="hud-s">${pts}</span></div></div>
        <p class="muted small center">Tap a question, then its answer.</p>
        <div class="match-grid"><div class="mcol">${shuffle(chosen).map(id => `<button class="mq" data-id="${id}"><span class="tag">Ch ${Q[id].ch}</span>${Q[id].s}</button>`).join('')}</div>
        <div class="mcol">${shuffle(chosen).map(id => `<button class="ma" data-id="${id}">${Q[id].o[Q[id].a]}</button>`).join('')}</div></div></div>`;
      $('#quit').onclick = () => App.go(backHash(cfg));
      const tm = setInterval(() => { const e = $('#mt'); if (!e) return clearInterval(tm); e.textContent = Math.round((Date.now() - rs) / 1000) + 's'; }, 500);
      $$('.mq').forEach(b => b.onclick = () => { if (b.classList.contains('gone')) return; $$('.mq').forEach(x => x.classList.toggle('sel', x === b)); selL = b; FX.play('tap'); });
      $$('.ma').forEach(b => b.onclick = () => {
        if (!selL || b.classList.contains('gone')) { if (!selL) toast('Pick a question first'); return; }
        const ok = selL.dataset.id === b.dataset.id;
        if (ok) {
          Store.answer(b.dataset.id, true, { mode: 'match' });
          [selL, b].forEach(x => { x.classList.add('matched'); setTimeout(() => x.classList.add('gone'), 450); });
          FX.burst(b, '#34d399'); FX.play('correct'); FX.buzz(15); pts += 100; xp += 8; Store.addXP(8); left--; selL = null;
          if (!left) { clearInterval(tm); const secs = (Date.now() - rs) / 1000; const bonus = Math.max(0, Math.round(300 - secs * 5)); pts += bonus; if (!miss) { pts += 200; App.unlock('match'); } setTimeout(() => { round++; toast(`Round clear! ${bonus ? '+' + bonus + ' speed bonus' : ''}${!miss ? ' · +200 flawless' : ''}`); round < rounds ? board() : end(); }, 650); }
        } else {
          miss++; totalMiss++; Store.answer(selL.dataset.id, false, { mode: 'match' });
          [selL, b].forEach(x => { x.classList.remove('shake'); void x.offsetWidth; x.classList.add('shake', 'bad'); setTimeout(() => x.classList.remove('bad'), 500); });
          FX.play('wrong'); FX.buzz([40, 30, 40]); pts = Math.max(0, pts - 30);
        }
      });
    }
    function end() {
      stopKeys(); App.setLeaveGuard(null);
      const best = Store.setBest('match', pts);
      Store.session({ mode: 'match', name: 'Match Pairs', scope: cfg.scope, score: pts });
      FX.confetti(); FX.play('win');
      view().innerHTML = `<div class="results"><div class="card glow res-hero"><div class="intro-logo">🧩</div><h2>${pts} pts</h2><p class="muted">${rounds} boards · ${totalMiss} mistakes · ${fmtMs(Date.now() - t0)}</p>${best ? '<div class="pill gold">🏆 New best!</div>' : ''}<div class="res-stats"><div><b>+${xp}</b><small>XP</small></div></div></div>
        <div class="res-actions"><button class="btn" id="again">↻ Play again</button><button class="btn ghost" id="done">Done</button></div></div>`;
      $('#again').onclick = () => match(cfg); $('#done').onclick = () => exitPlay(backHash(cfg));
      App.checkAch({}); backupNudge();
    }
    board();
  }

  // ---------- knockout ----------
  function knockout(cfg) {
    enterPlay();
    let i = 0, pts = 0, downs = 0, xp = 0, wins = 0; const res = [];
    function draw() {
      if (i >= cfg.ids.length) return end();
      const id = cfg.ids[i], q = Q[id], ord = optOrder(q, false);
      let alive = ord.length, hitWrong = false;
      view().innerHTML = `<div class="play ko">
        <div class="play-top"><button class="icon-btn" id="quit">✕</button><div class="grow"><div class="row between small"><b>Knockout · ${i + 1}/${cfg.ids.length}</b><span class="muted">${downs} knock-down${downs === 1 ? '' : 's'}</span></div><div class="prog"><i style="width:${i / cfg.ids.length * 100}%"></i></div></div><div class="hud"><span class="hud-s">${pts}</span></div></div>
        <article class="qcard card slide-in"><div class="q-meta"><span class="tag">Ch ${q.ch} · Q${q.n}</span><span class="tag">🥊 Tap the WRONG options</span></div><div class="stem">${q.s}</div>
        <div class="opts">${ord.map((oi, k) => `<button class="opt" data-oi="${oi}"><span class="ol">${L(k)}</span><span class="ot">${q.o[oi]}</span></button>`).join('')}</div><div id="fb"></div></article></div>`;
      $('#quit').onclick = () => App.go(backHash(cfg));
      $$('.opt').forEach(b => b.onclick = () => {
        if (b.disabled) return;
        const oi = +b.dataset.oi;
        if (oi === q.a) {
          hitWrong = true; downs++; b.classList.add('right', 'ko-hit'); FX.play('hit'); FX.buzz([60, 40, 60]);
          $('.qcard').classList.add('shake');
          $$('.opt').forEach(x => x.disabled = true);
          Store.answer(id, false, { mode: 'knockout' }); res.push({ id, oi: -1, ok: false });
          done(false);
        } else {
          b.disabled = true; b.classList.add('out'); alive--; pts += 25; FX.play('tap'); FX.floatText(b, '+25');
          if (alive === 1) {
            $$('.opt').forEach(x => { if (+x.dataset.oi === q.a) x.classList.add('right'); x.disabled = true; });
            pts += 50; wins++; const g = 12; xp += g; Store.addXP(g); FX.play('correct'); FX.burst($('.opt.right'), '#34d399');
            Store.answer(id, true, { mode: 'knockout' }); res.push({ id, oi: q.a, ok: true });
            done(true);
          }
        }
      });
      function done(ok) {
        $('#fb').innerHTML = `<div class="fb ${ok ? 'good' : 'bad'} pop-in"><div class="fb-h">${ok ? 'K.O.! Only the answer is left standing 🥊' : 'Knocked down! That was the correct answer 😵'}</div><div class="fb-key">Book key: <b>${q.k}</b></div>${q.x ? `<div class="note">ℹ️ ${esc(q.x)}</div>` : ''}<button class="btn block" id="nextBtn">Next ›</button></div>`;
        $('#nextBtn').onclick = () => { i++; draw(); };
        App.checkAch({});
      }
    }
    function end() {
      stopKeys(); App.setLeaveGuard(null);
      const best = Store.setBest('knockout', pts);
      if (!downs && cfg.ids.length >= 5) App.unlock('ko');
      Store.session({ mode: 'knockout', name: 'Knockout', scope: cfg.scope, score: wins, total: cfg.ids.length });
      if (wins / cfg.ids.length >= 0.8) { FX.confetti(); FX.play('win'); } else FX.play('correct');
      view().innerHTML = `<div class="results"><div class="card glow res-hero"><div class="intro-logo">🥊</div><h2>${pts} pts</h2><p class="muted">${wins}/${cfg.ids.length} knockouts · ${downs} knock-downs</p>${best ? '<div class="pill gold">🏆 New best!</div>' : ''}<div class="res-stats"><div><b>+${xp}</b><small>XP</small></div></div></div>
        <div class="res-actions"><button class="btn" id="again">↻ Play again</button><button class="btn ghost" id="rv">📋 Review</button><button class="btn ghost" id="done">Done</button></div><div id="revList"></div></div>`;
      $('#again').onclick = () => setup('knockout', { chapters: cfg.chapters });
      $('#rv').onclick = () => $('#revList').innerHTML = reviewList(res);
      $('#done').onclick = () => exitPlay(backHash(cfg));
      backupNudge();
    }
    keys(e => { if ((e.key === 'Enter' || e.key === ' ') && $('#nextBtn')) { e.preventDefault(); $('#nextBtn').click(); } else if (/^[1-9]$/.test(e.key)) { const b = $$('.opt')[+e.key - 1]; b && b.click(); } });
    draw();
  }

  window.Modes = { list, setup, start };
  App.routes.play = () => { if (!view().querySelector('.play,.results')) location.replace('#/'); };
})();
