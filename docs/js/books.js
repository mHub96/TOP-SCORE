/* Book shelf: Top Score is built in; other MCQ books come as private pack files (.tspack, kind "book")
   that the user loads once per device. Packs are kept in IndexedDB and never uploaded.
   Pack format (same container as the Greenberg pack): "TSPACK01" + uint32 LE header length + JSON header + data.
   Header: {kind:'book', version:1, book:{id,title,short,authors,year,color,icon}, counts:{q,img}, files:{name:[off,len,mime]}} */
(function () {
  const DBN = 'topscore-books', ST = 'packs', MAGIC = 'TSPACK01';
  const BOOKS = {};            // id -> book
  const ORDER = [];            // shelf order
  let dbp = null;
  const CUR_KEY = 'topscore.book';

  // ---------- built-in book: Top Score ----------
  const D = window.TS_DATA;
  const TS = {
    id: 'ts', builtin: true, title: 'Top Score for the Neurosurgery Board Examination', short: 'Top Score',
    authors: 'Tarar et al.', year: 2025, color: '#6d4cff', icon: '🏆', coverSrc: 'icons/ts-cover.webp',
    source: D.source, parts: D.parts.slice(),
    chapters: D.chapters.map(c => ({ n: c.n, t: c.t, p: c.p, q: c.q })),
    greenberg: true
  };
  add(TS);

  function add(b) {
    if (!BOOKS[b.id]) ORDER.push(b.id);
    BOOKS[b.id] = b;
    if (!b.parts || !b.parts.length) b.parts = [b.short || b.title];
    b.chapters.forEach(c => { if (c.p === undefined) c.p = 0; });
  }

  // ---------- IndexedDB ----------
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
    if (new TextDecoder().decode(head.slice(0, 8)) !== MAGIC) throw new Error('This file is not a TOP SCORE pack.');
    const n = new DataView(head.buffer).getUint32(8, true);
    const h = JSON.parse(await b.slice(12, 12 + n).text());
    h.base = 12 + n;
    return h;
  }
  function part(rec, name) { const f = rec.header.files[name]; return f ? rec.blob.slice(rec.header.base + f[0], rec.header.base + f[0] + f[1], f[2]) : null; }

  let myUid = null; try { myUid = (JSON.parse(localStorage.getItem('topscore.acct')) || {}).id || null; } catch (e) { }
  async function open(rec) {
    if (rec.server && rec.uid !== myUid) return null;      // the owner's library copy is not shown to other accounts on a shared device
    const b = JSON.parse(await part(rec, 'book.json').text());
    const meta = rec.header.book || {};
    const book = Object.assign({}, meta, b, { builtin: false, rec, size: rec.blob.size, built: rec.header.built, urls: {} });
    book.id = meta.id || b.id;
    add(book);
    return book;
  }

  const ready = (async () => {
    try {
      const keys = await op('readonly', s => s.getAllKeys());
      for (const k of keys || []) {
        try { const rec = await op('readonly', s => s.get(k)); if (rec && rec.blob && rec.header) await open(rec); }
        catch (e) { console.warn('Could not open book pack', k, e); }
      }
    } catch (e) { /* IndexedDB unavailable */ }
    ORDER.sort((a, b) => (a === 'ts' ? -1 : b === 'ts' ? 1 : (BOOKS[a].order || 99) - (BOOKS[b].order || 99) || BOOKS[a].short.localeCompare(BOOKS[b].short)));
  })();

  /* Load any pack file. Returns {kind:'book', book} or {kind:'explain'} (Greenberg pack, handled by Explain). */
  async function load(file, opts = {}) {
    const h = await readHeader(file);
    if (h.kind !== 'book') {
      if (window.Explain) { await Explain.load(file); return { kind: 'explain' }; }
      throw new Error('Unknown pack type.');
    }
    if (!h.files || !h.files['book.json']) throw new Error('The book pack is incomplete.');
    const id = h.book && h.book.id;
    if (!id || id === 'ts') throw new Error('The book pack has no valid id.');
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (file.size > 200 * 1048576 && navigator.storage && navigator.storage.estimate) {      // video packs: say so plainly instead of failing halfway
      const e = await navigator.storage.estimate().catch(() => null);
      if (e && e.quota && file.size > e.quota - (e.usage || 0)) throw new Error(`This pack needs ${(file.size / 1073741824).toFixed(1)} GB of browser storage, but only ${((e.quota - (e.usage || 0)) / 1073741824).toFixed(1)} GB is free on this device.`);
    }
    await op('readwrite', s => s.put({ blob: file, header: h, name: file.name, at: Date.now(), server: !!opts.server, uid: opts.uid || null, updated: opts.updated || 0 }, id));
    const rec = await op('readonly', s => s.get(id));
    const old = BOOKS[id]; if (old && old.urls) Object.values(old.urls).forEach(u => URL.revokeObjectURL(u));
    const book = await open(rec);
    return { kind: 'book', book, replaced: !!old };
  }
  async function remove(id) {
    if (id === 'ts') return;
    await op('readwrite', s => s.delete(id));
    const b = BOOKS[id]; if (b && b.urls) Object.values(b.urls).forEach(u => URL.revokeObjectURL(u));
    delete BOOKS[id]; const i = ORDER.indexOf(id); if (i >= 0) ORDER.splice(i, 1);
    if (current() === id) setCurrent('ts');
  }
  function url(bid, name) {
    const b = BOOKS[bid]; if (!b || !b.rec) return '';
    if (!b.urls[name]) { const p = part(b.rec, 'img/' + name); if (!p) return ''; b.urls[name] = URL.createObjectURL(p); }
    return b.urls[name];
  }
  /* any stored file of a pack, by its full name in the pack (e.g. 'video/ch04.mp4'); '' when the pack has no such file */
  function file(bid, name) {
    const b = BOOKS[bid]; if (!b || !b.rec) return '';
    if (!b.urls[name]) { const p = part(b.rec, name); if (!p) return ''; b.urls[name] = URL.createObjectURL(p); }
    return b.urls[name];
  }
  /* the book's front cover image (null when the book has none) */
  function cover(bid) {
    const b = BOOKS[bid]; if (!b) return null;
    if (b.coverSrc) return b.coverSrc;
    if (!b.rec || !b.rec.header.files['cover.webp']) return null;
    if (!b.urls['cover.webp']) b.urls['cover.webp'] = URL.createObjectURL(part(b.rec, 'cover.webp'));
    return b.urls['cover.webp'];
  }
  function current() { let c = null; try { c = localStorage.getItem(CUR_KEY); } catch (e) { } return c && BOOKS[c] ? c : 'ts'; }
  function setCurrent(id) { try { localStorage.setItem(CUR_KEY, id); } catch (e) { } }

  window.Books = {
    ready, load, remove, url, file, cover, current, setCurrent, readHeader,
    get: id => BOOKS[id], list: () => ORDER.map(id => BOOKS[id]), all: BOOKS
  };
})();
