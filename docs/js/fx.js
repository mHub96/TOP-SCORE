/* Effects: synthesized sounds, haptics, confetti, particle bursts, neural-network background. */
(function () {
  let ctx = null;
  const S = () => Store.S.settings;
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type = 'sine', vol = 0.12, when = 0, slide = 0) {
    const a = ac(); if (!a) return;
    const t = a.currentTime + when;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const sounds = {
    correct: () => { tone(660, 0.12, 'triangle', 0.13); tone(990, 0.18, 'triangle', 0.11, 0.08); },
    wrong: () => { tone(220, 0.22, 'sawtooth', 0.06, 0, 140); },
    tap: () => tone(520, 0.05, 'sine', 0.05),
    combo: n => { tone(500 + n * 40, 0.08, 'square', 0.05); tone(750 + n * 50, 0.1, 'square', 0.04, 0.06); },
    level: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, i * 0.11)),
    win: () => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.11, i * 0.09)),
    lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.28, 'sine', 0.1, i * 0.16)),
    flip: () => tone(300, 0.08, 'sine', 0.06, 0, 600),
    hit: () => { tone(120, 0.15, 'square', 0.08, 0, 60); tone(900, 0.06, 'sawtooth', 0.04); },
    tick: () => tone(1200, 0.03, 'square', 0.025)
  };
  function play(name, arg) { if (S().sound) try { sounds[name](arg); } catch (e) { } }
  function buzz(p) { if (S().haptics && navigator.vibrate) try { navigator.vibrate(p); } catch (e) { } }

  // ---- overlay canvas for confetti / bursts ----
  const cv = document.createElement('canvas');
  cv.id = 'fx'; document.addEventListener('DOMContentLoaded', () => document.body.appendChild(cv));
  const g = cv.getContext('2d');
  let parts = [], raf = null;
  function size() { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; }
  addEventListener('resize', size); size();
  const COLORS = ['#7c5cff', '#22d3ee', '#34d399', '#fbbf24', '#f472b6', '#60a5fa'];
  function loop() {
    g.clearRect(0, 0, cv.width, cv.height);
    parts = parts.filter(p => p.life > 0);
    parts.forEach(p => {
      p.life -= 1; p.x += p.vx; p.y += p.vy; p.vy += p.gr; p.vx *= 0.99; p.rot += p.vr;
      g.save(); g.globalAlpha = Math.min(1, p.life / 40); g.translate(p.x, p.y); g.rotate(p.rot);
      g.fillStyle = p.c;
      if (p.shape === 0) g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      else { g.beginPath(); g.arc(0, 0, p.r * 0.7, 0, 7); g.fill(); }
      g.restore();
    });
    raf = parts.length ? requestAnimationFrame(loop) : null;
    if (!raf) g.clearRect(0, 0, cv.width, cv.height);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }
  function confetti(n = 160) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dpr = devicePixelRatio;
    for (let i = 0; i < n; i++) {
      const side = i % 2;
      parts.push({
        x: (side ? cv.width * 0.9 : cv.width * 0.1), y: cv.height * 0.75,
        vx: (side ? -1 : 1) * (4 + Math.random() * 9) * dpr, vy: -(10 + Math.random() * 12) * dpr,
        gr: 0.32 * dpr, r: (4 + Math.random() * 5) * dpr, c: COLORS[i % COLORS.length], life: 140 + Math.random() * 60,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, shape: i % 3 ? 0 : 1
      });
    }
    kick();
  }
  function burst(el, color) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !el) return;
    const r = el.getBoundingClientRect(), dpr = devicePixelRatio;
    const cx = (r.left + r.width / 2) * dpr, cy = (r.top + r.height / 2) * dpr;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, sp = (2 + Math.random() * 5) * dpr;
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, gr: 0.08 * dpr, r: (2 + Math.random() * 3) * dpr, c: color || COLORS[i % COLORS.length], life: 45 + Math.random() * 20, rot: 0, vr: 0, shape: 1 });
    }
    kick();
  }
  function floatText(el, text, cls = '') {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const d = document.createElement('div');
    d.className = 'float-txt ' + cls; d.textContent = text;
    d.style.left = (r.left + r.width / 2) + 'px'; d.style.top = (r.top) + 'px';
    document.body.appendChild(d); setTimeout(() => d.remove(), 1100);
  }
  function countUp(el, to, dur = 900, fmt = v => Math.round(v)) {
    if (!el) return;
    const t0 = performance.now(), from = 0;
    const step = t => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---- neural network background ----
  function neural(canvas) {
    const c = canvas.getContext('2d');
    let nodes = [], w, h, run = true;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    function init() {
      w = canvas.width = innerWidth * devicePixelRatio; h = canvas.height = innerHeight * devicePixelRatio;
      const n = Math.min(70, Math.round(innerWidth * innerHeight / 18000));
      nodes = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.25 * devicePixelRatio, vy: (Math.random() - 0.5) * 0.25 * devicePixelRatio, p: Math.random() * 6 }));
    }
    function frame() {
      if (!run) return;
      c.clearRect(0, 0, w, h);
      const css = getComputedStyle(document.documentElement);
      const col = css.getPropertyValue('--net').trim() || '124,92,255';
      const max = 150 * devicePixelRatio;
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy; n.p += 0.02;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
        if (d < max) { c.strokeStyle = `rgba(${col},${(1 - d / max) * 0.22})`; c.lineWidth = devicePixelRatio; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
      }
      for (const n of nodes) {
        c.fillStyle = `rgba(${col},${0.35 + Math.sin(n.p) * 0.25})`;
        c.beginPath(); c.arc(n.x, n.y, 2.2 * devicePixelRatio, 0, 7); c.fill();
      }
      if (!reduce) requestAnimationFrame(frame);
    }
    addEventListener('resize', init);
    document.addEventListener('visibilitychange', () => { run = !document.hidden; if (run) frame(); });
    init(); frame();
  }

  window.FX = { play, buzz, confetti, burst, floatText, countUp, neural };
})();
