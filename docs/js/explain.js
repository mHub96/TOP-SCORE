/* Greenberg explanation pack: a local file the user loads once (kept in IndexedDB, never uploaded).
   Pack format: "TSPACK01" + uint32 LE header length + JSON header {files:{name:[offset,length,type]}, ...} + data. */
(function () {
  const DBN = 'topscore-pack', ST = 'kv', MAGIC = 'TSPACK01';
  let dbp = null, blob = null, H = null, base = 0;
  const chCache = {}, pgCache = {}, urls = {};
  const ready = init();

  function idb() {
    return dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DBN, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(ST);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
  }
  async function op(mode, fn) {
    const d = await idb();
    return new Promise((res, rej) => { const t = d.transaction(ST, mode); const q = fn(t.objectStore(ST)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  }
  async function readHeader(b) {
    const head = new Uint8Array(await b.slice(0, 12).arrayBuffer());
    if (new TextDecoder().decode(head.slice(0, 8)) !== MAGIC) throw new Error('This file is not a TOP SCORE explanation pack.');
    const n = new DataView(head.buffer).getUint32(8, true);
    const h = JSON.parse(await b.slice(12, 12 + n).text());
    h.base = 12 + n;
    return h;
  }
  function use(b, h) { blob = b; H = h; base = h.base; for (const k in chCache) delete chCache[k]; for (const k in pgCache) delete pgCache[k]; for (const k in urls) { URL.revokeObjectURL(urls[k]); delete urls[k]; } }
  async function init() {
    try { const r = await op('readonly', s => s.get('pack')); if (r && r.blob && r.header) use(r.blob, r.header); } catch (e) { /* no pack */ }
  }
  async function load(file) {
    const h = await readHeader(file);
    if (!h.files || !h.files['index.json']) throw new Error('The pack is incomplete.');
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    await op('readwrite', s => s.put({ blob: file, header: h, name: file.name, size: file.size, at: Date.now() }, 'pack'));
    // re-read from IndexedDB so we hold the stored copy, not the picked file
    const r = await op('readonly', s => s.get('pack'));
    use(r.blob, r.header);
    return info();
  }
  async function remove() { await op('readwrite', s => s.delete('pack')); use(null, null); }
  function info() { return H ? { title: H.title, built: H.built, counts: H.counts, size: blob.size, version: H.version } : null; }
  const has = () => !!H;
  function part(name, type) { const f = H.files[name]; if (!f) return null; return blob.slice(base + f[0], base + f[0] + f[1], type || f[2]); }
  async function json(name) { const b = part(name); return b ? JSON.parse(await b.text()) : null; }
  function url(name) { if (!urls[name]) { const b = part(name); if (!b) return ''; urls[name] = URL.createObjectURL(b); } return urls[name]; }
  async function forQ(id) {
    await ready; if (!H) return null;
    const ch = id.split('-')[0];
    if (!chCache[ch]) chCache[ch] = json('q/' + ch + '.json').catch(() => ({}));
    return ((await chCache[ch]) || {})[id] || null;
  }
  async function page(pp) { if (!pgCache[pp]) pgCache[pp] = json('p/' + pp + '.json').catch(() => null); return pgCache[pp]; }

  // ---------- rendering ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const BADGE = {
    V: ['v', '✅ Verified in Greenberg'],
    R: ['r', '🔶 Related reading'],
    C: ['c', '⚠️ Greenberg differs from the key'],
    N: ['n', '— No matching passage found']
  };
  function imgs(list, cap, kind) {
    return list.map(im => `<button class="ximg ${kind}" data-src="${esc(im[0])}" aria-label="Zoom ${kind === 't' ? 'table' : 'figure'}"><img loading="lazy" src="${url(im[0])}" width="${im[1]}" height="${im[2]}" alt="${esc(cap)}"></button>`).join('');
  }
  function item(it) {
    if (it.k === 'p') return `<div class="xpass">${it.h ? `<div class="xhead">§ ${esc(it.h)}</div>` : ''}<div class="xtext">${it.html}</div><div class="xpg">p. ${it.pp}</div></div>`;
    if (it.k === 't') return `<figure class="xfig xtab"><figcaption>${esc(it.cap)} <span class="xpg">p. ${it.pp}</span></figcaption>${imgs(it.img, it.cap, 't')}</figure>`;
    if (it.k === 'f') return `<figure class="xfig">${imgs(it.img, it.cap, 'f')}<figcaption>${it.caphtml || esc(it.cap)} <span class="xpg">p. ${it.pp}</span></figcaption></figure>`;
    return '';
  }
  function html(e, q, opts = {}) {
    const b = BADGE[e.v] || BADGE.N;
    const pages = [...new Set(e.items.map(i => i.pp))];
    const cited = e.cite || [];
    const moved = pages.length && cited.length && !pages.some(p => cited.includes(p));
    return `<details class="xpd x-${b[0]}" ${opts.open ? 'open' : ''}>
      <summary><span class="xt">📖 Greenberg explains</span><span class="xbadge">${b[1]}</span></summary>
      <div class="xbody">
        ${e.v === 'C' ? `<div class="xwarn">The Greenberg text below does not match the book's key. The key shown is the book's printed answer; check this point in the original.</div>` : ''}
        ${e.v === 'R' ? `<div class="xinfo">Closest Greenberg text on this topic. It does not state the key word for word.</div>` : ''}
        ${e.items.map(item).join('')}
        ${moved ? `<div class="xinfo">Found on p. ${pages.join(', ')} (Top Score cites p. ${cited.join(', ')}).</div>` : ''}
        <div class="xfoot">Greenberg's Handbook of Neurosurgery, 10th ed. · ${pages.map(p => `<button class="xpage" data-pp="${p}">Read p. ${p}</button>`).join(' ')}</div>
      </div></details>`;
  }
  async function mount(el, id, opts = {}) {
    if (!el) return;
    await ready;
    if (!H) { el.innerHTML = opts.hint ? `<div class="xnone muted small">📖 Load the Greenberg explanation pack in <a href="#/settings">Settings</a> to see explanations here.</div>` : ''; return; }
    const e = await forQ(id);
    if (!e || !e.items || !e.items.length) { el.innerHTML = `<div class="xnone muted small">📖 No matching Greenberg passage was found for this question.</div>`; return; }
    el.innerHTML = html(e, null, opts);
    wire(el);
  }
  // mount every .xp[data-q] inside root, lazily when scrolled into view
  function scan(root, opts = {}) {
    const els = [...root.querySelectorAll('.xp[data-q]:not([data-m])')];
    if (!els.length) return;
    const go = el => { el.dataset.m = 1; mount(el, el.dataset.q, opts); };
    if (!('IntersectionObserver' in window)) return els.forEach(go);
    const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { io.unobserve(en.target); go(en.target); } }), { rootMargin: '400px' });
    els.forEach(el => io.observe(el));
  }
  function wire(el) {
    el.querySelectorAll('.ximg').forEach(b => b.onclick = e => { e.preventDefault(); zoom(b.dataset.src); });
    el.querySelectorAll('.xpage').forEach(b => b.onclick = e => { e.preventDefault(); reader(+b.dataset.pp); });
    const d = el.querySelector('details');
    if (d) d.addEventListener('toggle', () => { if (d.open && window.FX) FX.play('flip'); });
  }
  function zoom(name) {
    const m = App.modal(`<div class="xzoom"><img src="${url(name)}" alt=""></div><p class="muted small center">Pinch or double-tap to zoom · tap ✕ to close</p>`, { cls: 'xzoom-modal' });
    const img = m.querySelector('.xzoom img');
    img.onclick = () => img.classList.toggle('big');
  }
  async function reader(pp) {
    const m = App.modal(`<div class="xreader"><div class="xr-head"><button class="btn ghost sm" data-d="-1">‹ p. ${pp - 1}</button><b>Greenberg p. ${pp}</b><button class="btn ghost sm" data-d="1">p. ${pp + 1} ›</button></div><div class="xr-body">Loading…</div></div>`, { cls: 'xreader-modal' });
    const body = m.querySelector('.xr-body');
    const pg = await page(pp);
    m.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { m.close(); setTimeout(() => reader(pp + +b.dataset.d), 150); });
    if (!pg) { body.innerHTML = `<p class="muted">This page is not included in the pack (only pages used by the explanations, and the pages around them, are included).</p>`; return; }
    body.innerHTML = pg.map(u => u.t === 'h' ? `<h${Math.min(6, u.l + 2)} class="xr-h">${esc(u.text)}</h${Math.min(6, u.l + 2)}>`
      : u.t === 'p' ? `<p class="xr-p">${u.html}</p>`
      : u.t === 't' ? `<figure class="xfig xtab"><figcaption>${esc(u.cap)}</figcaption>${imgs(u.img, u.cap, 't')}</figure>`
      : u.t === 'f' ? `<figure class="xfig">${imgs(u.img, u.cap, 'f')}<figcaption>${u.caphtml || esc(u.cap)}</figcaption></figure>` : '').join('');
    wire(body);
  }

  window.Explain = { ready, load, remove, info, has, forQ, mount, scan, reader, readHeader };
})();
