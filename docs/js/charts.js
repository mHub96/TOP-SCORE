/* Lightweight SVG charts with hover/tap tooltips. Colors come from CSS custom properties. */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tipAttr = t => ` data-tip="${esc(t)}"`;

  // shared tooltip
  let tip;
  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement('div'); tip.className = 'chart-tip'; document.body.appendChild(tip);
    const show = (e) => {
      const el = e.target.closest('[data-tip]');
      if (!el) { tip.classList.remove('on'); return; }
      tip.innerHTML = el.getAttribute('data-tip').replace(/\n/g, '<br>');
      tip.classList.add('on');
      const x = (e.touches ? e.touches[0].clientX : e.clientX), y = (e.touches ? e.touches[0].clientY : e.clientY);
      const w = tip.offsetWidth;
      tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px';
      tip.style.top = Math.max(8, y - tip.offsetHeight - 14) + 'px';
    };
    document.addEventListener('pointermove', show);
    document.addEventListener('pointerdown', show);
    document.addEventListener('scroll', () => tip.classList.remove('on'), true);
    return tip;
  }

  const fmtDay = d => { const x = new Date(d + 'T00:00'); return x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };

  /* stacked area: days = [{d, vals:[...]}], series = [{name, cls}] */
  function stackedArea(el, days, series, opts = {}) {
    ensureTip();
    const W = 640, H = 240, L = 40, R = 12, T = 12, B = 28;
    if (!days.length) { el.innerHTML = empty('Answer some questions to start your growth curve.'); return; }
    if (days.length === 1) days = [{ d: days[0].d, vals: days[0].vals.map(() => 0), pre: 1 }].concat(days);
    const totals = days.map(d => d.vals.reduce((a, b) => a + b, 0));
    const max = opts.max || Math.max(...totals, 1);
    const x = i => L + (W - L - R) * (i / (days.length - 1));
    const y = v => T + (H - T - B) * (1 - v / max);
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts.label || 'Stacked area chart')}">`;
    for (let k = 0; k <= 4; k++) {
      const v = max * k / 4;
      svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`;
    }
    const cum = days.map(() => 0);
    series.forEach((s, si) => {
      const top = days.map((d, i) => cum[i] + d.vals[si]);
      let p = `M${x(0)},${y(top[0])}`;
      for (let i = 1; i < days.length; i++) p += `L${x(i)},${y(top[i])}`;
      for (let i = days.length - 1; i >= 0; i--) p += `L${x(i)},${y(cum[i])}`;
      svg += `<path class="area ${s.cls}" d="${p}Z"/>`;
      let ln = `M${x(0)},${y(top[0])}`;
      for (let i = 1; i < days.length; i++) ln += `L${x(i)},${y(top[i])}`;
      svg += `<path class="area-line ${s.cls}" d="${ln}"/>`;
      top.forEach((v, i) => cum[i] = v);
    });
    const step = Math.max(1, Math.ceil(days.length / 6));
    days.forEach((d, i) => {
      if (!d.pre && (i % step === 0 || i === days.length - 1)) svg += `<text class="tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${fmtDay(d.d)}</text>`;
      if (d.pre) return;
      const t = fmtDay(d.d) + '\n' + series.map((s, si) => `${s.name}: ${d.vals[si]}`).reverse().join('\n');
      const bw = (W - L - R) / Math.max(1, days.length - 1);
      svg += `<rect class="hit" x="${x(i) - bw / 2}" y="${T}" width="${bw}" height="${H - T - B}"${tipAttr(t)}/>`;
    });
    svg += '</svg>';
    el.innerHTML = svg + legend(series);
  }

  /* bars + line on the same percentage axis: accuracy % line, volume shown in tooltip & faint bars scaled to own max */
  function accuracyTrend(el, days) {
    ensureTip();
    if (!days.length) { el.innerHTML = empty('No answers yet.'); return; }
    const W = 640, H = 220, L = 40, R = 12, T = 12, B = 28;
    const n = days.length;
    const x = i => L + (W - L - R) * ((i + 0.5) / n);
    const y = v => T + (H - T - B) * (1 - v / 100);
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Daily accuracy">`;
    [0, 25, 50, 75, 100].forEach(v => svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`);
    const bw = Math.max(2, (W - L - R) / n - 2);
    let p = '';
    days.forEach((d, i) => {
      const acc = d.a ? d.c / d.a * 100 : 0;
      svg += `<rect class="bar-soft" x="${x(i) - bw / 2}" y="${y(acc)}" width="${bw}" height="${Math.max(0, y(0) - y(acc))}" rx="3"/>`;
      p += (p ? 'L' : 'M') + x(i) + ',' + y(acc);
    });
    svg += `<path class="line" d="${p}"/>`;
    const step = Math.max(1, Math.ceil(n / 6));
    days.forEach((d, i) => {
      const acc = d.a ? Math.round(d.c / d.a * 100) : 0;
      svg += `<circle class="dot" cx="${x(i)}" cy="${y(acc)}" r="4"/>`;
      svg += `<rect class="hit" x="${x(i) - (W - L - R) / n / 2}" y="${T}" width="${(W - L - R) / n}" height="${H - T - B}"${tipAttr(`${fmtDay(d.d)}\nAccuracy: ${acc}%\nAnswered: ${d.a} · Correct: ${d.c}`)}/>`;
      if (i % step === 0 || i === n - 1) svg += `<text class="tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${fmtDay(d.d)}</text>`;
    });
    el.innerHTML = svg + '</svg>';
  }

  /* GitHub-style activity heatmap for last `weeks` weeks */
  function heatmap(el, daily, weeks = 18) {
    ensureTip();
    const cell = 13, gap = 3, L = 26, T = 16;
    const end = new Date(); end.setHours(0, 0, 0, 0);
    const start = new Date(end); start.setDate(start.getDate() - (weeks * 7 - 1) - end.getDay());
    const vals = Object.values(daily).map(d => d.a);
    const max = Math.max(10, ...vals);
    const W = L + weeks * (cell + gap) + cell, H = T + 7 * (cell + gap);
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart heat" role="img" aria-label="Activity heatmap">`;
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((d, i) => { if (i % 2) svg += `<text class="tick" x="0" y="${T + i * (cell + gap) + 10}">${d}</text>`; });
    let lastMonth = -1, lastLabelWk = -9;
    for (let dt = new Date(start), i = 0; dt <= end; dt.setDate(dt.getDate() + 1), i++) {
      const wk = Math.floor(i / 7), wd = dt.getDay();
      const key = Store.today(dt.getTime());
      const a = daily[key] ? daily[key].a : 0;
      const lvl = a === 0 ? 0 : Math.min(4, 1 + Math.floor(a / max * 4));
      if (wd === 0 && dt.getMonth() !== lastMonth && wk - lastLabelWk >= 3) { lastMonth = dt.getMonth(); lastLabelWk = wk; svg += `<text class="tick" x="${L + wk * (cell + gap)}" y="10">${dt.toLocaleDateString(undefined, { month: 'short' })}</text>`; }
      svg += `<rect class="hm l${lvl}" x="${L + wk * (cell + gap)}" y="${T + wd * (cell + gap)}" width="${cell}" height="${cell}" rx="3"${tipAttr(`${dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}\n${a} answered${daily[key] && daily[key].a ? ' · ' + Math.round(daily[key].c / daily[key].a * 100) + '% correct' : ''}`)}/>`;
    }
    svg += '</svg>';
    el.innerHTML = svg + `<div class="hm-legend">Less <i class="hm l0"></i><i class="hm l1"></i><i class="hm l2"></i><i class="hm l3"></i><i class="hm l4"></i> More</div>`;
  }

  /* simple vertical bars: items [{label, v, tip}] */
  function bars(el, items, opts = {}) {
    ensureTip();
    const W = 640, H = opts.h || 200, L = 34, R = 8, T = 14, B = 28;
    const max = Math.max(1, ...items.map(i => i.v));
    const n = items.length, slot = (W - L - R) / n, bw = Math.max(3, slot - 4);
    const y = v => T + (H - T - B) * (1 - v / max);
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts.label || 'Bar chart')}">`;
    [0, 0.5, 1].forEach(k => svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(max * k)}" y2="${y(max * k)}"/><text class="tick" x="${L - 6}" y="${y(max * k) + 4}" text-anchor="end">${Math.round(max * k)}</text>`);
    items.forEach((it, i) => {
      const x = L + slot * i + (slot - bw) / 2, h = y(0) - y(it.v);
      if (it.v > 0) svg += `<path class="bar ${it.cls || ''}" d="${roundTop(x, y(it.v), bw, h, 4)}"/>`;
      if (it.v > 0 && n <= 16) svg += `<text class="bar-val" x="${x + bw / 2}" y="${y(it.v) - 4}" text-anchor="middle">${it.v}</text>`;
      svg += `<rect class="hit" x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}"${tipAttr(it.tip || `${it.label}: ${it.v}`)}/>`;
      if (n <= 16 || i % Math.ceil(n / 12) === 0) svg += `<text class="tick" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text>`;
    });
    el.innerHTML = svg + '</svg>';
  }
  function roundTop(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  /* radar for parts: items [{label, v (0..1), tip}] */
  function radar(el, items) {
    ensureTip();
    const S = 360, C = S / 2, Rr = 130, n = items.length;
    const pt = (i, r) => [C + r * Math.sin(2 * Math.PI * i / n), C - r * Math.cos(2 * Math.PI * i / n)];
    let svg = `<svg viewBox="0 0 ${S} ${S}" class="chart radar" role="img" aria-label="Mastery by part">`;
    [0.25, 0.5, 0.75, 1].forEach(k => {
      svg += `<polygon class="grid" points="${items.map((_, i) => pt(i, Rr * k).join(',')).join(' ')}"/>`;
    });
    items.forEach((it, i) => {
      const [x, y] = pt(i, Rr); svg += `<line class="grid" x1="${C}" y1="${C}" x2="${x}" y2="${y}"/>`;
      const [lx, ly] = pt(i, Rr + 16);
      svg += `<text class="tick" x="${lx}" y="${ly + 3}" text-anchor="middle">${esc(it.short)}</text>`;
    });
    svg += `<polygon class="radar-area" points="${items.map((it, i) => pt(i, Rr * Math.max(0.02, it.v)).join(',')).join(' ')}"/>`;
    items.forEach((it, i) => {
      const [x, y] = pt(i, Rr * Math.max(0.02, it.v));
      svg += `<circle class="dot" cx="${x}" cy="${y}" r="4"/><circle class="hit" cx="${x}" cy="${y}" r="12"${tipAttr(it.tip)}/>`;
    });
    el.innerHTML = svg + '</svg>';
  }

  /* donut ring for tiers */
  function donut(el, vals, series, center) {
    ensureTip();
    const S = 180, C = 90, R = 70, sw = 22, tot = vals.reduce((a, b) => a + b, 0) || 1;
    let a0 = -Math.PI / 2, svg = `<svg viewBox="0 0 ${S} ${S}" class="chart donut" role="img" aria-label="Mastery breakdown">`;
    vals.forEach((v, i) => {
      if (!v) return;
      const a1 = a0 + 2 * Math.PI * v / tot - (vals.filter(Boolean).length > 1 ? 0.025 : 0);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = v === tot ? `M${C},${C - R}A${R},${R} 0 1 1 ${C - 0.01},${C - R}` :
        `M${C + R * Math.cos(a0)},${C + R * Math.sin(a0)}A${R},${R} 0 ${large} 1 ${C + R * Math.cos(a1)},${C + R * Math.sin(a1)}`;
      svg += `<path class="arc ${series[i].cls}" d="${p}" stroke-width="${sw}" fill="none"${tipAttr(`${series[i].name}: ${v} (${Math.round(v / tot * 100)}%)`)}/>`;
      a0 = a1 + (vals.filter(Boolean).length > 1 ? 0.025 : 0);
    });
    svg += `<text x="${C}" y="${C - 2}" text-anchor="middle" class="donut-big">${center[0]}</text><text x="${C}" y="${C + 18}" text-anchor="middle" class="tick">${center[1]}</text></svg>`;
    el.innerHTML = svg;
  }

  function legend(series) {
    return `<div class="legend">${series.slice().reverse().map(s => `<span><i class="sw ${s.cls}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  }
  const empty = msg => `<div class="chart-empty">📈 ${esc(msg)}</div>`;

  window.Charts = { tip: ensureTip, stackedArea, accuracyTrend, heatmap, bars, radar, donut, legend };
})();
