/* Accounts: sign-in/sign-up (owner approves new accounts), account settings, owner panel,
   owner's private book library on the server, arena (leaderboard + challenges), notifications inbox. */
(function () {
  // the live site uses the real server; a local copy (tests) uses a separate test server so it never touches real accounts
  const API = location.hostname.endsWith('github.io') ? 'https://topscore-sync.topscore-c067b3.workers.dev/api' : 'https://topscore-test.topscore-c067b3.workers.dev/api';
  const AKEY = 'topscore.acct';
  const OWNER_CREDIT = '© 2026 Dr. Mohammed Riyadh Jaafar · Arabic Board Neurosurgery Resident. All rights reserved.';
  let acct = null; try { acct = JSON.parse(localStorage.getItem(AKEY)); } catch (e) { }
  let inbox = { challenges: [] }, seenInvites = new Set(JSON.parse(sessionStorage.getItem('ts.seenInv') || '[]')), inboxT = null;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- push notifications (phone status-bar alerts while the app is closed) ----------
  const Push = (() => {
    const AUTHC = 'topscore-auth';
    const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
    const b64 = k => { const s = atob((k + '='.repeat((4 - k.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };
    async function token(t) {
      try { if (!('caches' in window)) return; const c = await caches.open(AUTHC); if (t) await c.put('token', new Response(t)); else { await c.delete('token'); await c.delete('last'); } } catch (e) { }
    }
    async function reg() { return navigator.serviceWorker.getRegistration() .then(r => r || navigator.serviceWorker.register('sw.js')).then(() => navigator.serviceWorker.ready); }
    async function current() { if (!supported()) return null; try { return await (await reg()).pushManager.getSubscription(); } catch (e) { return null; } }
    /* 'on' | 'off' | 'blocked' | 'install' (iPhone: must be opened from the home-screen icon) | 'unsupported' */
    async function state() {
      if (ios() && !standalone()) return 'install';
      if (!supported()) return 'unsupported';
      if (Notification.permission === 'denied') return 'blocked';
      return Notification.permission === 'granted' && await current() ? 'on' : 'off';
    }
    async function send(sub) { await api('/push/subscribe', { body: { sub: sub.toJSON() } }); }
    async function enable() {
      const st = await state();
      if (st === 'install' || st === 'unsupported' || st === 'blocked') return st;
      const perm = await Notification.requestPermission();      // must run inside the button tap
      if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'off';
      const r = await reg();
      let sub = await r.pushManager.getSubscription();
      if (!sub) {
        const { key } = await api('/push/key');
        if (!key) throw new Error('The server has no push key.');
        sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
      }
      await token(acct && acct.token);
      await send(sub);
      return 'on';
    }
    async function disable() {
      const sub = await current(); if (!sub) return;
      try { await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } }); } catch (e) { }
      try { await sub.unsubscribe(); } catch (e) { }
    }
    /* every start: keep the server's copy of this device's subscription fresh (it can change silently) */
    async function refresh() {
      if (!acct || !supported() || Notification.permission !== 'granted') return;
      try {
        await token(acct.token);
        const r = await reg(); let sub = await r.pushManager.getSubscription();
        if (!sub) { const { key } = await api('/push/key'); if (key) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }); }
        if (sub) await send(sub);
      } catch (e) { }
    }
    async function test() { return api('/push/test', { body: {} }); }
    return { supported, ios, standalone, state, enable, disable, refresh, test, token };
  })();

  // ---------- API ----------
  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.body && !(opts.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}, acct && acct.token ? { Authorization: 'Bearer ' + acct.token } : {});
    let r;
    try { r = await fetch(API + path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers, body: opts.body && !(opts.body instanceof Blob) && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body, cache: 'no-store' }); }
    catch (e) { throw new Error('No connection to the TOP SCORE server. Check your internet.'); }
    if (opts.raw) { if (!r.ok) throw new Error('Download failed (' + r.status + ')'); return r; }
    let j = {}; try { j = await r.json(); } catch (e) { }
    if (r.status === 401 && acct && path !== '/login') { expired(); throw new Error('Your session ended. Please log in again.'); }
    if (!r.ok) throw new Error(j.error || ('Server error ' + r.status));
    return j;
  }
  /* the password never leaves the device: it is stretched here (PBKDF2, 200k rounds, salted with the username) */
  async function pwHash(username, pw) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode('topscore:' + username.toLowerCase()), iterations: 200000 }, key, 256);
    return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function saveAcct(a) { acct = a; if (a) localStorage.setItem(AKEY, JSON.stringify(a)); else localStorage.removeItem(AKEY); Push.token(a && a.token); }
  function expired() { const u = acct && acct.username; saveAcct(null); sessionStorage.setItem('ts.relogin', u || ''); location.reload(); }
  const me = () => acct;
  const isOwner = () => !!(acct && acct.role === 'owner');

  // ---------- sign in / sign up ----------
  function showAuth(mode = 'login') {
    document.body.classList.add('authing');
    requestAnimationFrame(() => document.documentElement.classList.remove('gate'));   // only the login panel is ever revealed
    const v = $('#view');
    const pre = sessionStorage.getItem('ts.relogin') || '';
    v.innerHTML = `<div class="auth-wrap"><div class="auth card glow">
      <div class="auth-logo">🧠</div><h1><span class="grad">TOP SCORE</span></h1>
      <p class="muted small center">Neurosurgery board library · private study group</p>
      <div class="seg" id="aTab"><button data-m="login" class="${mode === 'login' ? 'on' : ''}">Log in</button><button data-m="signup" class="${mode === 'signup' ? 'on' : ''}">Create account</button></div>
      <form id="aForm" autocomplete="on">
        <label class="field"><span>Username</span><input id="aUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(pre)}" required></label>
        ${mode === 'signup' ? `<label class="field"><span>Your name (shown to friends)</span><input id="aName" name="name" maxlength="40" placeholder="e.g. Dr. Ali"></label>` : ''}
        <label class="field"><span>Password</span><input id="aPw" type="password" name="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" required minlength="6"></label>
        ${mode === 'signup' ? `<label class="field"><span>Repeat password</span><input id="aPw2" type="password" autocomplete="new-password" required minlength="6"></label>` : ''}
        <button class="btn block" id="aGo">${mode === 'signup' ? 'Create account' : 'Log in'}</button>
        <p class="muted small center" id="aMsg">${mode === 'signup' ? 'The owner approves every new account before it can log in.' : ''}</p>
      </form></div>
      <p class="credit-line">${OWNER_CREDIT}</p></div>`;
    $$('#aTab button').forEach(b => b.onclick = () => showAuth(b.dataset.m));
    $('#aForm').onsubmit = async e => {
      e.preventDefault();
      const u = $('#aUser').value.trim().toLowerCase(), pw = $('#aPw').value, msg = $('#aMsg'), go = $('#aGo');
      if (pw.length < 6) { msg.textContent = 'Password: at least 6 characters.'; return; }
      if (mode === 'signup' && pw !== $('#aPw2').value) { msg.textContent = 'The passwords do not match.'; return; }
      go.disabled = true; msg.textContent = mode === 'signup' ? 'Creating your account…' : 'Logging in…';
      try {
        const h = await pwHash(u, pw);
        if (mode === 'signup') {
          const r = await api('/signup', { body: { username: u, display: ($('#aName').value || '').trim(), pw: h } });
          if (r.owner) { msg.textContent = 'Owner account created — logging in…'; await doLogin(u, h); return; }
          v.querySelector('.auth').innerHTML = `<div class="auth-logo">⏳</div><h2>Account requested</h2><p class="muted">Your account <b>${esc(u)}</b> is waiting for the owner's approval. You can log in as soon as it is approved.</p><button class="btn block" id="aBack">Back to log in</button>`;
          $('#aBack').onclick = () => { sessionStorage.setItem('ts.relogin', u); showAuth('login'); };
          return;
        }
        await doLogin(u, h);
      } catch (err) { msg.textContent = '⚠️ ' + err.message; go.disabled = false; }
    };
    setTimeout(() => ($('#aUser').value ? $('#aPw') : $('#aUser')).focus(), 50);
  }
  async function doLogin(u, h) {
    const r = await api('/login', { body: { username: u, pw: h } });
    // progress studied on this device before accounts existed can be added to the first account that logs in here
    const anon = localStorage.getItem('topscore.v1');
    const mine = localStorage.getItem('topscore.v1.u' + r.user.id);
    let take = false;
    if (anon && !mine && !localStorage.getItem('topscore.v1.claimed')) {
      let n = 0; try { n = (JSON.parse(anon).log || []).length; } catch (e) { }
      if (n && await App.confirmBox('Add this device’s progress?', `This device has <b>${n.toLocaleString()}</b> answers studied before accounts existed. Add them to <b>${esc(r.user.display)}</b>'s account?`, 'Add to my account', 'No')) take = true;
    }
    if (take) {
      localStorage.setItem('topscore.v1.u' + r.user.id, anon);
      ['topscore.chresume', 'topscore.resume'].forEach(k => { const x = localStorage.getItem(k); if (x) localStorage.setItem(k + '.u' + r.user.id, x); });
      localStorage.setItem('topscore.v1.claimed', String(r.user.id));
    }
    saveAcct(Object.assign({ token: r.token }, r.user));
    sessionStorage.removeItem('ts.relogin');
    location.hash = sessionStorage.getItem('ts.after') || '#/'; sessionStorage.removeItem('ts.after'); location.reload();
  }
  async function logout() {
    if (!await App.confirmBox('Log out?', 'Your progress is saved in your account. Log in again on any device to continue.', 'Log out')) return;
    try { await window.Sync.sync('logout'); } catch (e) { }
    try { await Push.disable(); } catch (e) { }
    try { await api('/logout', { body: {} }); } catch (e) { }
    saveAcct(null); location.hash = '#/'; location.reload();
  }

  // ---------- background: session check, books list, owner library, inbox ----------
  async function start() {
    try {
      const r = await api('/me');
      saveAcct(Object.assign({}, acct, r.user));
      await api('/me', { body: { books: Books.list().map(b => b.id) } });
    } catch (e) { /* offline: keep working locally */ }
    if (isOwner()) syncLibrary().catch(() => { });
    Push.token(acct && acct.token); Push.refresh();
    setTimeout(() => Push.state().then(st => {
      if ((st === 'off' || st === 'install') && !localStorage.getItem('ts.pushAsk') && !document.body.classList.contains('exam-locked') && !document.body.classList.contains('playing') && !document.body.classList.contains('exam-mode')) {
        localStorage.setItem('ts.pushAsk', '1');
        App.toast('<a href="#/settings" class="toast-link"><b>🔔 Get challenge alerts on this device</b><br><small>Settings → Your account → Activate notifications</small></a>', 10000);
      }
    }), 4000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
      const d = e.data || {};
      if (d.type === 'push') { (d.items || []).forEach(it => notify(it.title, it.body, it.url || '#/arena', true)); pollInbox(); }
      if (d.type === 'open' && d.url) location.hash = d.url;
    });
    pollInbox(); inboxT = setInterval(() => { if (!document.hidden) pollInbox(); }, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pollInbox(); });
  }

  /* owner: books on the server appear on every device he logs into (download once); hidden books leave the shelf */
  async function syncLibrary(force) {
    const { books } = await api('/books');
    const changed = [];
    for (const sb of books) {
      const local = Books.get(sb.id);
      if (!sb.visible) { if (local && local.rec && local.rec.server) { await Books.remove(sb.id); changed.push(sb.id); } continue; }
      if (local && local.rec && (!local.rec.server || local.rec.updated >= sb.updated) && !force) continue;
      if (local && !local.rec) continue;
      const busy = App.toast(`☁️ Downloading ${esc(sb.meta.short || sb.id)} from your library…`, 60000);
      const res = await api(`/books/${sb.id}/pack`, { raw: true });
      const blob = await res.blob();
      const file = new File([blob], sb.meta.file || (sb.id + '.tspack'));
      const r = await Books.load(file, { server: true, uid: acct.id, updated: sb.updated });
      Store.indexBook(r.book); changed.push(sb.id);
      if (busy && busy.remove) busy.remove();
    }
    if (changed.length) { Store.syncBooks(); App.toast(`📚 Library updated: ${changed.length} book${changed.length > 1 ? 's' : ''}`); App.render(); api('/me', { body: { books: Books.list().map(b => b.id) } }).catch(() => { }); }
    return books;
  }

  async function pollInbox() {
    if (!acct) return;
    try { inbox = await api('/inbox'); } catch (e) { return; }
    const mine = acct.id;
    for (const c of inbox.challenges) {
      const k = c.id + ':' + c.status;
      if (seenInvites.has(k)) continue;
      seenInvites.add(k);
      if (c.status === 'pending' && c.to.id === mine) notify(`⚔️ ${c.from.name} challenges you!`, c.title, `#/duel/${c.id}`);
      if (c.status === 'accepted' && c.from.id === mine) notify(`⚔️ ${c.to.name} accepted your challenge`, 'Open the lobby and press Start.', `#/duel/${c.id}`);
    }
    sessionStorage.setItem('ts.seenInv', JSON.stringify([...seenInvites]));
    badge();
  }
  function notify(title, text, href, fromPush) {
    if (document.body.classList.contains('exam-locked') || document.body.classList.contains('exam-mode')) return;   // nothing pops up over an exam
    const k = 'n:' + title + '|' + href;            // the same event can arrive by push and by the inbox poll
    if (notify.last && notify.last[k] && Date.now() - notify.last[k] < 60000) return;
    (notify.last = notify.last || {})[k] = Date.now();
    App.toast(`<a href="${href}" class="toast-link"><b>${esc(title)}</b><br><small>${esc(text || '')}</small></a>`, 9000);
    FX.play('level'); FX.buzz([60, 40, 60]);
  }
  function badge() {
    const waiting = inbox.challenges.filter(c => (c.status === 'pending' && c.to.id === acct.id) || (c.status === 'accepted')).length;
    const a = $('.nav a[data-r="arena"]'); if (a) a.dataset.badge = waiting || '';
    const owner = (inbox.pendingUsers || 0) + (inbox.pwRequests || 0);
    const s = $('.top-actions a[href="#/settings"]'); if (s) s.dataset.badge = isOwner() && owner ? owner : '';
  }

  // ---------- settings: account card ----------
  function settingsHTML() {
    if (!acct) return '';
    return `<section class="card acct-card">
      <h2>👤 Your account</h2>
      <div class="acct-row"><div class="acct-av">${esc((acct.display || acct.username)[0].toUpperCase())}</div><div class="grow"><b>${esc(acct.display)}</b>${isOwner() ? ' <span class="pill gold">Owner</span>' : ''}<div class="muted small">@${esc(acct.username)} · progress syncs to every device you log into</div></div><button class="btn ghost sm" id="acOut">Log out</button></div>
      <div class="kv"><span>Sync</span><b id="syState">…</b></div>
      <label class="field"><span>Name shown to friends</span><div class="row gap"><input id="acName" value="${esc(acct.display)}" maxlength="40"><button class="btn sm" id="acNameSave">Save</button></div></label>
      <label class="switch-row"><span>🏆 Show me on the leaderboards</span><input type="checkbox" id="acLb" ${acct.lb !== false ? 'checked' : ''}><i class="switch"></i></label>
      <details class="sy-link" id="acPwBox"><summary>🔑 Change password</summary>${pwFormHTML()}</details>
      <div class="push-box" id="pushBox"><div class="row gap"><span class="push-ic">🔔</span><div class="grow"><b>Notifications on this device</b><div class="muted small" id="pushTxt">Checking…</div></div></div><div class="row gap wrap mt-s" id="pushBtns"></div></div>
      ${isOwner() ? `<div class="row gap wrap mt"><a class="btn" href="#/admin">🛡️ Owner panel</a></div>` : ''}
    </section>`;
  }
  function pwFormHTML() {
    if (!isOwner() && !acct.pwAllowed) return `<p class="muted small">${acct.pwRequest ? '⏳ Your request is waiting for the owner.' : 'Changing your password needs the owner’s approval first.'}</p>${acct.pwRequest ? '' : '<button class="btn ghost sm" id="acPwAsk">Ask the owner</button>'}`;
    return `<label class="field"><span>Current password</span><input type="password" id="acOld" autocomplete="current-password"></label>
      <label class="field"><span>New password</span><input type="password" id="acNew" autocomplete="new-password" minlength="6"></label>
      <label class="field"><span>Repeat new password</span><input type="password" id="acNew2" autocomplete="new-password"></label>
      <button class="btn sm" id="acPwGo">Change password</button>`;
  }
  function bindSettings() {
    if (!$('#acOut')) return;
    $('#acOut').onclick = logout;
    $('#acNameSave').onclick = async () => { try { const r = await api('/me', { body: { display: $('#acName').value } }); saveAcct(Object.assign({}, acct, r.user)); App.toast('✅ Name saved'); } catch (e) { App.toast('⚠️ ' + esc(e.message)); } };
    $('#acLb').onchange = async e => { try { const r = await api('/me', { body: { lb: e.target.checked } }); saveAcct(Object.assign({}, acct, r.user)); App.toast(e.target.checked ? '🏆 You appear on the leaderboards' : '🙈 Hidden from the leaderboards'); } catch (err) { App.toast('⚠️ ' + esc(err.message)); } };
    const ask = $('#acPwAsk'); if (ask) ask.onclick = async () => { try { await api('/password/request', { body: {} }); acct.pwRequest = true; saveAcct(acct); App.toast('📨 Request sent to the owner'); $('#acPwBox').innerHTML = '<summary>🔑 Change password</summary>' + pwFormHTML(); } catch (e) { App.toast('⚠️ ' + esc(e.message)); } };
    const go = $('#acPwGo'); if (go) go.onclick = async () => {
      const o = $('#acOld').value, n = $('#acNew').value;
      if (n.length < 6) return App.toast('New password: at least 6 characters');
      if (n !== $('#acNew2').value) return App.toast('The new passwords do not match');
      go.disabled = true;
      try { await api('/password', { body: { old: await pwHash(acct.username, o), pw: await pwHash(acct.username, n) } }); acct.pwAllowed = false; acct.pwRequest = false; saveAcct(acct); App.toast('🔑 Password changed'); App.render(); }
      catch (e) { App.toast('⚠️ ' + esc(e.message)); go.disabled = false; }
    };
    drawPush();
    if (window.Sync) { const draw = i => { const el = $('#syState'); if (el) el.textContent = i.state === 'syncing' ? 'Syncing…' : i.error ? '⚠️ ' + i.error : i.at ? '✅ Synced ' + App.ago(i.at) : 'Not synced yet'; }; draw(Sync.info()); Sync.onChange(draw); }
  }

  const PUSH_TXT = {
    on: '✅ On — challenges' + (isOwner() ? ', new accounts and password requests' : '') + ' show in your phone’s status bar, even when the app is closed.',
    off: 'Off — you only see alerts while the app is open.',
    blocked: '⛔ Blocked for this site. Open your browser’s site settings (🔒 next to the address, or the app info → Notifications), allow notifications, then come back.',
    install: '📲 On iPhone/iPad, notifications only work in the installed app: Safari → Share → <b>Add to Home Screen</b>, open TOP SCORE from that icon, then tap Activate here (iOS 16.4 or newer).',
    unsupported: 'This browser cannot receive push notifications. Use Chrome on Android, or the installed home-screen app on iPhone.'
  };
  async function drawPush(where = '#pushBox') {
    const box = $(where); if (!box) return;
    const st = await Push.state();
    $('#pushTxt', box) && ($('#pushTxt', box).innerHTML = PUSH_TXT[st]);
    const btns = $('#pushBtns', box); if (!btns) return;
    btns.innerHTML = st === 'on' ? '<button class="btn sm" data-p="test">📨 Send a test notification</button><button class="btn ghost sm" data-p="off">Turn off</button>'
      : st === 'off' ? '<button class="btn glow" data-p="on">🔔 Activate notifications</button>'
      : st === 'blocked' ? '<button class="btn ghost sm" data-p="on">🔄 Check again</button>' : '';
    $$('[data-p]', btns).forEach(b => b.onclick = async () => {
      b.disabled = true;
      try {
        if (b.dataset.p === 'on') {
          const r = await Push.enable();
          if (r === 'on') { App.toast('🔔 Notifications activated'); FX.play('level'); const t = await Push.test(); if (!t.devices) App.toast('⚠️ The server did not register this device — try again'); }
          else App.toast(r === 'blocked' ? '⛔ Notifications are blocked — see the note' : 'Notifications not allowed');
        }
        if (b.dataset.p === 'test') { const t = await Push.test(); App.toast(t.devices ? `📨 Sent to ${t.devices} device${t.devices > 1 ? 's' : ''} — it should arrive in a few seconds` : '⚠️ No device registered — turn notifications off and on again'); }
        if (b.dataset.p === 'off') { await Push.disable(); App.toast('🔕 Notifications off on this device'); }
      } catch (e) { App.toast('⚠️ ' + esc(e.message)); }
      drawPush(where);
    });
  }

  /* owner: library card (visibility of each book on the server) */
  function libraryHTML() {
    if (!isOwner()) return '';
    return `<section class="card" id="libCard"><h2>☁️ Your private library</h2>
      <p class="muted small">Your book packs are stored on your server and appear only in <b>your</b> account, on every device you log into. Turn a book off to remove it from your shelf — your progress in it is kept and comes back when you turn it on again.</p>
      <div id="libList" class="muted small">Loading…</div></section>`;
  }
  async function bindLibrary() {
    const el = $('#libList'); if (!el) return;
    try {
      const { books } = await api('/books');
      el.innerHTML = books.map(b => `<label class="switch-row"><span>${esc(b.meta.icon || '📘')} <b>${esc(b.meta.short || b.id)}</b> <small class="muted">${(b.size / 1048576).toFixed(1)} MB · ${(b.meta.counts && b.meta.counts.q || 0).toLocaleString()} questions</small></span><input type="checkbox" data-vis="${b.id}" ${b.visible ? 'checked' : ''}><i class="switch"></i></label>`).join('') || 'No books on the server yet.';
      $$('[data-vis]', el).forEach(i => i.onchange = async () => {
        i.disabled = true;
        try { await api(`/books/${i.dataset.vis}/visible`, { body: { visible: i.checked } }); await syncLibrary(); App.toast(i.checked ? '📚 Book shown on your shelf' : '🙈 Book hidden — progress kept'); }
        catch (e) { App.toast('⚠️ ' + esc(e.message)); i.checked = !i.checked; }
        i.disabled = false;
      });
    } catch (e) { el.textContent = '⚠️ ' + e.message; }
  }

  // ---------- owner panel ----------
  App.routes.admin = async () => {
    const v = $('#view');
    if (!isOwner()) { v.innerHTML = '<p class="muted center">Owner only.</p>'; return; }
    v.innerHTML = `<a class="back" href="#/settings">‹ Settings</a><div class="page-head"><h1>🛡️ Owner panel</h1><p class="muted">Approve accounts, password-change requests and manage your study group.</p></div><div id="admList" class="muted">Loading…</div>`;
    const draw = async () => {
      let users;
      try { users = (await api('/admin/users')).users; } catch (e) { $('#admList').textContent = '⚠️ ' + e.message; return; }
      const pend = users.filter(u => u.status === 'pending'), act = users.filter(u => u.status !== 'pending');
      $('#admList').innerHTML = `
        <section class="card"><h2>⏳ Waiting for approval <span class="pill">${pend.length}</span></h2>${pend.map(u => `
          <div class="list-item"><span class="grow"><b>${esc(u.display)}</b> <small class="muted">@${esc(u.username)} · asked ${new Date(u.created).toLocaleString()}</small></span>
          <button class="btn sm" data-a="approve" data-u="${u.id}">Approve</button><button class="btn ghost sm" data-a="reject" data-u="${u.id}">Reject</button></div>`).join('') || '<p class="muted small">No one is waiting.</p>'}</section>
        <section class="card"><h2>👥 Accounts</h2>${act.map(u => `
          <div class="list-item adm-user"><span class="grow"><b>${esc(u.display)}</b> ${u.role === 'owner' ? '<span class="pill gold">Owner</span>' : ''} ${u.status === 'rejected' ? '<span class="pill bad">rejected</span>' : ''}
            <br><small class="muted">@${esc(u.username)} · ${u.seen ? 'last seen ' + App.ago(u.seen) : 'never logged in'}${u.pwRequest ? ' · <b class="warn-t">asks to change password</b>' : u.pwAllowed ? ' · may change password' : ''}</small></span>
            ${u.role === 'owner' ? '' : `<span class="adm-btns">
              ${u.pwRequest ? `<button class="btn sm" data-a="allowpw" data-u="${u.id}">Allow password change</button>` : ''}
              ${u.status === 'rejected' ? `<button class="btn ghost sm" data-a="approve" data-u="${u.id}">Re-activate</button>` : `<button class="btn ghost sm" data-a="block" data-u="${u.id}">Block</button>`}
              <button class="btn ${u.examHost ? '' : 'ghost'} sm" data-a="${u.examHost ? 'nohost' : 'host'}" data-u="${u.id}" title="Host exam rooms on a big screen">${u.examHost ? '🖥️ Can host exams ✓' : '🖥️ Allow exam rooms'}</button>
              <button class="btn ghost sm" data-a="reset" data-u="${u.id}" data-n="${esc(u.username)}">Temp password</button>
              <button class="btn ghost sm danger-t" data-a="del" data-u="${u.id}" data-n="${esc(u.display)}">Delete</button></span>`}</div>`).join('')}</section>`;
      $$('[data-a]').forEach(b => b.onclick = async () => {
        const id = b.dataset.u, a = b.dataset.a;
        try {
          if (a === 'approve') await api('/admin/users/' + id, { body: { status: 'active' } });
          if (a === 'reject' || a === 'block') await api('/admin/users/' + id, { body: { status: 'rejected' } });
          if (a === 'allowpw') await api('/admin/users/' + id, { body: { allowPw: true } });
          if (a === 'host' || a === 'nohost') await api('/admin/users/' + id, { body: { examHost: a === 'host' } });
          if (a === 'reset') {
            const pw = prompt(`Temporary password for @${b.dataset.n} (at least 6 characters). Give it to them privately; they can then change it.`);
            if (!pw) return; if (pw.length < 6) return App.toast('At least 6 characters');
            await api('/admin/users/' + id, { body: { resetPw: await pwHash(b.dataset.n, pw) } });
          }
          if (a === 'del') { if (!await App.confirmBox(`Delete ${esc(b.dataset.n)}?`, 'The account and its progress are deleted for good.', 'Delete')) return; await api('/admin/users/' + id, { method: 'DELETE' }); }
          App.toast('✅ Done'); draw(); pollInbox();
        } catch (e) { App.toast('⚠️ ' + esc(e.message)); }
      });
    };
    draw();
  };

  // ---------- arena: leaderboard + challenges ----------
  let lbPeriod = 'all';
  App.routes.arena = async (arg) => {
    const v = $('#view'), tab = ['challenges', 'exam'].includes(arg) ? arg : 'leaders';
    v.innerHTML = `<div class="page-head"><h1>⚔️ Arena</h1><div class="seg" id="arTab"><button data-t="leaders" class="${tab === 'leaders' ? 'on' : ''}">🏆 Leaderboard</button><button data-t="challenges" class="${tab === 'challenges' ? 'on' : ''}">⚔️ Challenges</button><button data-t="exam" class="${tab === 'exam' ? 'on' : ''}">🖥️ Exam room</button></div></div><div id="arBody" class="muted">Loading…</div>`;
    $$('#arTab button').forEach(b => b.onclick = () => App.go('#/arena/' + b.dataset.t));
    if (tab === 'exam') return Exam.arenaTab($('#arBody'));
    if (tab === 'leaders') return leaders();
    return challenges();
  };
  async function leaders() {
    try { if (window.Sync) await Sync.sync('lb'); } catch (e) { }
    let d; try { d = await api('/leaderboard'); } catch (e) { $('#arBody').textContent = '⚠️ ' + e.message; return; }
    const draw = () => {
      const week = lbPeriod === 'week';
      const rows = d.rows.map(r => {
        const correct = (week ? r.week_correct : r.correct) || 0;
        return Object.assign({}, r, { good: correct, bad: Math.max(0, ((week ? r.week_answered : r.answered) || 0) - correct) });
      }).sort((a, b) => b.good - a.good);
      const medal = i => ['🥇', '🥈', '🥉'][i] || (i + 1);
      $('#arBody').innerHTML = `
        <div class="row gap wrap lb-ctl"><div class="seg" id="lbP"><button data-p="week" class="${week ? 'on' : ''}">This week</button><button data-p="all" class="${week ? '' : 'on'}">All time</button></div></div>
        <section class="card lb">${rows.map((r, i) => `<div class="lb-row ${r.id === d.me ? 'me' : ''}" style="--d:${i * 50}ms"><span class="lb-rank">${medal(i)}</span><span class="acct-av sm">${esc((r.display || '?')[0].toUpperCase())}</span><span class="grow"><b>${esc(r.display)}</b>${r.id === d.me ? ' <small class="muted">(you)</small>' : ''}<br><small class="muted">✅ ${r.good.toLocaleString()} correct · ❌ ${r.bad.toLocaleString()} incorrect · ${r.streak || 0}🔥</small></span><b class="lb-v">${r.good.toLocaleString()}</b></div>`).join('') || '<p class="muted">No one on the board yet — answer some questions!</p>'}</section>
        <p class="muted small center">Ranked by correct answers only. Each question counts once: correct if you have ever got it right, incorrect if you have not yet. Turn “Show me on the leaderboards” off in Settings to hide yourself.</p>`;
      $$('#lbP button').forEach(b => b.onclick = () => { lbPeriod = b.dataset.p; draw(); });
    };
    draw();
  }
  async function challenges() {
    let list, users;
    try { [list, users] = await Promise.all([api('/challenges'), api('/users')]); } catch (e) { $('#arBody').textContent = '⚠️ ' + e.message; return; }
    const mine = acct.id, L = list.challenges;
    const open = L.filter(c => ['pending', 'accepted', 'running'].includes(c.status));
    const done = L.filter(c => c.status === 'done').slice(0, 12);
    const row = c => {
      const meFrom = c.from.id === mine, opp = meFrom ? c.to : c.from, my = meFrom ? c.from : c.to;
      const st = c.status === 'pending' ? (meFrom ? 'Waiting for them to accept' : '<b>Invites you</b>') : c.status === 'accepted' ? 'Ready to start' : c.status === 'running' ? 'In progress' : '';
      const res = c.status === 'done' ? duelWinner(c, mine) : '';
      return `<a class="list-item duel-row" href="#/duel/${c.id}"><span class="lb-rank">⚔️</span><span class="grow"><b>vs ${esc(opp.name)}</b> · <small>${esc(c.title)}</small><br><small class="muted">${st}${res ? res + ` · ${my.score} – ${opp.score}` : ''} · ${App.ago(c.created)}</small></span><span class="chev">›</span></a>`;
    };
    $('#arBody').innerHTML = `
      <section class="card"><div class="row between"><h2>New challenge</h2></div>
        <p class="muted small">Challenge a friend on any chapter — you both get the same questions in the same order. Pick a book you both have.</p>
        <button class="btn" id="newDuel" ${users.users.length ? '' : 'disabled'}>⚔️ Challenge someone</button>${users.users.length ? '' : '<p class="muted small">No other approved accounts yet.</p>'}
        <div class="push-box mt" id="arPush"><div class="row gap"><span class="push-ic">🔔</span><div class="grow"><b>Challenge alerts on this device</b><div class="muted small" id="pushTxt">Checking…</div></div></div><div class="row gap wrap mt-s" id="pushBtns"></div></div></section>
      <section class="card"><h2>Active</h2>${open.map(row).join('') || '<p class="muted small">No active challenges.</p>'}</section>
      <section class="card"><h2>Recent results</h2>${done.map(row).join('') || '<p class="muted small">No finished challenges yet.</p>'}</section>`;
    $('#newDuel') && ($('#newDuel').onclick = () => newDuel(users.users));
    drawPush('#arPush');
  }
  function duelWinner(c, mine) {
    const meFrom = c.from.id === mine, my = meFrom ? c.from : c.to, opp = meFrom ? c.to : c.from;
    if (my.score === opp.score) return my.ms && opp.ms ? (my.ms < opp.ms ? '🏆 You won (faster)' : my.ms > opp.ms ? '💀 They won (faster)' : '🤝 Draw') : '🤝 Draw';
    return my.score > opp.score ? '🏆 You won' : '💀 You lost';
  }
  const DUEL_MODES = [['challenge', '🎯 MCQ Challenge'], ['shuffle', '🔀 Shuffle Mix'], ['confidence', '🎚️ Confidence'], ['blitz', '⚡ Speed Blitz (60 s)'], ['survival', '❤️ Survival (3 lives)'], ['boss', '🐉 Boss Battle']];
  function newDuel(users) {
    const myBooks = Books.list().map(b => b.id);
    const m = App.modal(`<div class="setup"><div class="setup-h" style="--h:15"><span class="m-ic">⚔️</span><div><h3>New challenge</h3><p class="muted small">Same questions, same order, live scores.</p></div></div>
      <label class="field"><span>Opponent</span><select id="dTo" class="chip">${users.map(u => `<option value="${u.id}">${esc(u.display)}${u.online ? ' · 🟢 online' : ''}</option>`).join('')}</select></label>
      <label class="field"><span>Book</span><select id="dBook" class="chip"></select></label>
      <label class="field"><span>Chapter</span><select id="dCh" class="chip"></select></label>
      <label class="field"><span>Mode</span><select id="dMode" class="chip">${DUEL_MODES.map(x => `<option value="${x[0]}">${x[1]}</option>`).join('')}</select></label>
      <label class="field" id="dCntF"><span>Questions</span><select id="dCnt" class="chip"><option>10</option><option selected>20</option><option>30</option><option value="0">All in the chapter</option></select></label>
      <div class="setup-foot"><span class="muted small" id="dInfo"></span><button class="btn" id="dGo">Send challenge ⚔️</button></div></div>`, { cls: 'sheet' });
    const fillBooks = () => {
      const u = users.find(x => String(x.id) === $('#dTo', m).value);
      const shared = myBooks.filter(id => id === 'ts' || (u.books || []).includes(id));
      $('#dBook', m).innerHTML = shared.map(id => `<option value="${id}">${esc(Books.get(id).short)}</option>`).join('');
      fillCh();
    };
    const fillCh = () => { const bid = $('#dBook', m).value; $('#dCh', m).innerHTML = App.chKeys(bid).map(k => `<option value="${esc(k)}">${esc(App.chShort(k))} · ${esc(App.strip(Store.CH[k].t)).slice(0, 60)}</option>`).join(''); info(); };
    const info = () => { const k = $('#dCh', m).value; const n = k ? Store.CH[k].keyed.length : 0; $('#dInfo', m).textContent = n + ' questions in this chapter'; $('#dCntF', m).style.display = ['blitz', 'survival', 'boss'].includes($('#dMode', m).value) ? 'none' : ''; };
    $('#dTo', m).onchange = fillBooks; $('#dBook', m).onchange = fillCh; $('#dCh', m).onchange = info; $('#dMode', m).onchange = info;
    fillBooks();
    $('#dGo', m).onclick = async () => {
      const key = $('#dCh', m).value, mode = $('#dMode', m).value, cnt = +$('#dCnt', m).value;
      let ids = Store.CH[key].keyed.slice();
      ids = App.shuffle(ids); if (!['blitz', 'survival', 'boss'].includes(mode) && cnt) ids = ids.slice(0, cnt);
      const title = `${DUEL_MODES.find(x => x[0] === mode)[1]} · ${App.strip(App.chTitle(key))}`;
      $('#dGo', m).disabled = true;
      try { const r = await api('/challenges', { body: { to: +$('#dTo', m).value, mode, ids, ch: key, title } }); m.close(); App.toast('⚔️ Challenge sent'); App.go('#/duel/' + r.id); }
      catch (e) { App.toast('⚠️ ' + esc(e.message)); $('#dGo', m).disabled = false; }
    };
  }

  // ---------- duel lobby / live / results ----------
  let lobbyT = null;
  App.routes.duel = async (arg) => {
    clearInterval(lobbyT);
    const id = +arg, v = $('#view');
    v.innerHTML = `<a class="back" href="#/arena/challenges">‹ Challenges</a><div id="lobby" class="muted">Loading…</div>`;
    let starting = false;
    const draw = async () => {
      if (!$('#lobby')) return clearInterval(lobbyT);
      let d; try { d = await api('/challenges/' + id); } catch (e) { $('#lobby').textContent = '⚠️ ' + e.message; return clearInterval(lobbyT); }
      const c = d.challenge, side = d.side, my = c[side], opp = c[side === 'from' ? 'to' : 'from'];
      const missing = c.ids.filter(q => !Store.Q[q]).length;
      if (c.status === 'running' && !starting) { starting = true; clearInterval(lobbyT); return countdown(c, side); }
      $('#lobby').innerHTML = `<section class="card glow duel-lobby">
        <div class="eyebrow">${esc(c.title)}</div>
        <div class="vs"><div class="vs-p ${my.ready ? 'ready' : ''}"><span class="acct-av lg">${esc(my.name[0])}</span><b>${esc(my.name)}</b><small>${my.ready ? '✅ ready' : 'not ready'}</small></div><div class="vs-x">VS</div>
        <div class="vs-p ${opp.ready ? 'ready' : ''}"><span class="acct-av lg">${esc(opp.name[0])}</span><b>${esc(opp.name)}</b><small>${c.status === 'pending' ? 'invited' : opp.ready ? '✅ ready' : 'not ready'}</small></div></div>
        <p class="muted small center">${c.ids.length} questions · same order for both${missing ? ` · <b class="warn-t">⚠️ ${missing} of these questions are not on this device — load the same book pack</b>` : ''}</p>
        ${c.status === 'done' ? duelResultHTML(c, side) : ''}
        <div class="row gap center-row wrap mt">
          ${c.status === 'pending' && side === 'to' ? '<button class="btn" data-d="accept">Accept ⚔️</button><button class="btn ghost" data-d="decline">Decline</button>' : ''}
          ${c.status === 'pending' && side === 'from' ? '<p class="muted">Waiting for your opponent to accept…</p><button class="btn ghost" data-d="cancel">Cancel</button>' : ''}
          ${c.status === 'accepted' && !my.ready ? `<button class="btn big-go" data-d="ready" ${missing ? 'disabled' : ''}>▶ Start challenge</button>` : ''}
          ${c.status === 'accepted' && my.ready ? `<p class="muted">Waiting for ${esc(opp.name)} to press Start…</p>` : ''}
          ${['declined', 'cancelled'].includes(c.status) ? `<p class="muted">This challenge was ${c.status}.</p>` : ''}
        </div></section>`;
      $$('[data-d]').forEach(b => b.onclick = async () => { b.disabled = true; try { await api(`/challenges/${id}/${b.dataset.d}`, { body: {} }); pollInbox(); draw(); } catch (e) { App.toast('⚠️ ' + esc(e.message)); b.disabled = false; } });
      if (['done', 'declined', 'cancelled'].includes(c.status)) clearInterval(lobbyT);
    };
    await draw();
    lobbyT = setInterval(draw, 1500);
  };
  function countdown(c, side) {
    const off = c.now - Date.now(); // server clock offset
    const v = $('#view');
    const tick = () => {
      const left = Math.ceil((c.startAt - (Date.now() + off)) / 1000);
      if (left > 0) { v.innerHTML = `<div class="duel-count"><div class="vs-x">${left}</div><p class="muted">${esc(c.title)}</p></div>`; FX.play('tick'); setTimeout(tick, 1000); return; }
      Modes.duel(c, side);
    };
    tick();
  }
  function duelResultHTML(c, side) {
    const my = c[side], opp = c[side === 'from' ? 'to' : 'from'];
    return `<div class="duel-res"><div class="duel-win">${duelWinner(c, my.id)}</div>
      <div class="vs-score"><div><b>${my.score}</b><small>${my.correct}/${my.answered} correct</small></div><span>–</span><div><b>${opp.score}</b><small>${opp.correct}/${opp.answered} correct</small></div></div></div>`;
  }
  /* live duel: called by the quiz runner after each answer and at the end */
  const Duel = {
    report(c, side, R, done) {
      return api(`/challenges/${c.id}/progress`, { body: { score: Duel.score(c.mode, R), correct: R.correct, answered: R.answers.filter(a => !a.sk).length, done: !!done, ms: Date.now() - R.t0 } }).then(d => d.challenge).catch(() => null);
    },
    score(mode, R) { return mode === 'blitz' ? R.score : mode === 'boss' ? (R.bossMax - R.bossHp) : mode === 'confidence' ? R.cbm : R.correct; },
    poll(c) { return api('/challenges/' + c.id).then(d => d.challenge).catch(() => null); },
    resultHTML: duelResultHTML
  };

  window.Account = { API, Push, drawPush, api, me, isOwner, showAuth, start, logout, settingsHTML, bindSettings, libraryHTML, bindLibrary, syncLibrary, pollInbox, Duel, OWNER_CREDIT, pwHash };
})();
