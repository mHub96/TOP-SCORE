/* TOP SCORE service worker — offline-first app shell. Bump VERSION on every deploy. */
const VERSION = 'topscore-v3.3.0';
const AUTH = 'topscore-auth';      // holds the login token so push notifications can be fetched while the app is closed
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/data.js', 'js/fsrs.js', 'js/books.js', 'js/store.js', 'js/sync.js', 'js/account.js', 'js/explain.js', 'js/fx.js', 'js/charts.js', 'js/app.js', 'js/modes.js', 'js/qrcode.js', 'js/exam.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/ts-cover.webp', 'icons/badge-96.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))   /* bypass the HTTP cache: never mix old and new files */.then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== AUTH).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google Fonts: cache at runtime (stale-while-revalidate)
  if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('gstatic.com')) {
    e.respondWith(caches.open(VERSION + '-fonts').then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { caches.open(VERSION).then(c => c.put('index.html', r.clone())); return r; }).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const cl = r.clone(); caches.open(VERSION).then(c => c.put(req, cl)); }
    return r;
  })));
});

/* ---------- push notifications ----------
   The server sends an empty push (no content passes through Google/Apple); we then fetch the waiting
   notifications from the TOP SCORE server with the stored login token and show them. */
const API = location.hostname.endsWith('github.io') ? 'https://topscore-sync.topscore-c067b3.workers.dev/api' : 'https://topscore-test.topscore-c067b3.workers.dev/api';
/* only windows of THIS app: other apps on mhub96.github.io share the origin, so matchAll would return their windows too */
const ours = async () => (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(w => w.url.startsWith(self.registration.scope));
async function token() { try { const r = await (await caches.open(AUTH)).match('token'); return r ? (await r.text()) : ''; } catch (e) { return ''; } }
self.addEventListener('push', e => e.waitUntil((async () => {
  const wins = await ours();
  const t = await token();
  let items = [];
  if (t) {
    try {
      const c = await caches.open(AUTH), lr = await c.match('last'), last = lr ? +(await lr.text()) : 0;
      const r = await fetch(API + '/notifications?after=' + last, { headers: { Authorization: 'Bearer ' + t }, cache: 'no-store' });
      items = (await r.json()).items || [];
      if (items.length) await c.put('last', new Response(String(items[items.length - 1].id)));
    } catch (e) { }
  }
  // the app is open in front of the user: let it show its own alert instead of a system notification
  const focused = wins.find(w => w.focused || w.visibilityState === 'visible');
  if (focused && items.length) { focused.postMessage({ type: 'push', items }); return; }
  if (!items.length) items = [{ id: 'u' + Date.now(), title: 'TOP SCORE', body: 'You have a new update.', url: '#/arena' }];
  for (const it of items.slice(-4)) {
    await self.registration.showNotification(it.title, {
      body: it.body || '', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: 'ts-' + it.id, renotify: true,
      vibrate: [80, 40, 80], data: { url: it.url || '' }, timestamp: it.created || Date.now()
    });
  }
})()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL('./' + (e.notification.data && e.notification.data.url || ''), self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await ours();
    for (const w of wins) { if ('focus' in w) { try { await w.focus(); w.postMessage({ type: 'open', url: e.notification.data && e.notification.data.url || '' }); return; } catch (err) { } } }
    await self.clients.openWindow(target);
  })());
});
self.addEventListener('pushsubscriptionchange', e => e.waitUntil((async () => {
  const t = await token(); if (!t) return;
  try {
    const key = (await (await fetch(API + '/push/key')).json()).key;
    const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
    await fetch(API + '/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ sub: sub.toJSON() }) });
  } catch (err) { }
})()));
