/* FSRS-5 spaced-repetition scheduler (Free Spaced Repetition Scheduler, default parameters). */
(function () {
  const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
    1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
  const DECAY = -0.5, FACTOR = 19 / 81, DAY = 86400000, RETENTION = 0.9;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  const retrievability = (elapsedDays, s) => s > 0 ? Math.pow(1 + FACTOR * elapsedDays / s, DECAY) : 0;
  const intervalFor = (s, r = RETENTION) => s / FACTOR * (Math.pow(r, 1 / DECAY) - 1);
  const initS = g => Math.max(W[g - 1], 0.1);
  const initD = g => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);

  function nextD(d, g) {
    const delta = -W[6] * (g - 3);
    const dp = d + delta * (10 - d) / 9;
    return clamp(W[7] * initD(4) + (1 - W[7]) * dp, 1, 10);
  }
  function recallS(d, s, r, g) {
    const hard = g === 2 ? W[15] : 1, easy = g === 4 ? W[16] : 1;
    return s * (Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy + 1);
  }
  function forgetS(d, s, r) {
    const sf = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r));
    return Math.min(sf, s);
  }
  const shortTermS = (s, g) => s * Math.exp(W[17] * (g - 3 + W[18]));

  /* card: {s,d,due,last,reps,lapses}  g: 1 Again, 2 Hard, 3 Good, 4 Easy */
  function review(card, g, now = Date.now()) {
    const c = Object.assign({ s: 0, d: 0, due: 0, last: 0, reps: 0, lapses: 0 }, card);
    if (!c.reps || !c.s) {
      c.s = initS(g); c.d = initD(g);
    } else {
      const elapsed = (now - c.last) / DAY;
      if (elapsed < 1) {
        c.s = shortTermS(c.s, g);
      } else {
        const r = retrievability(elapsed, c.s);
        c.s = g === 1 ? forgetS(c.d, c.s, r) : recallS(c.d, c.s, r, g);
      }
      c.d = nextD(c.d, g);
    }
    c.s = clamp(c.s, 0.01, 36500);
    if (g === 1) c.lapses++;
    c.reps++;
    c.last = now;
    let ivlDays = intervalFor(c.s);
    if (g === 1) c.due = now + 10 * 60000;
    else c.due = now + Math.max(g === 2 ? 0.5 : 1, Math.round(ivlDays)) * DAY;
    return c;
  }
  function currentR(card, now = Date.now()) {
    if (!card || !card.reps) return 0;
    return retrievability((now - card.last) / DAY, card.s);
  }
  /* preview intervals for flashcard buttons */
  function preview(card, now = Date.now()) {
    return [1, 2, 3, 4].map(g => review(card, g, now).due - now);
  }
  window.FSRS = { review, currentR, preview, intervalFor, DAY };
})();
