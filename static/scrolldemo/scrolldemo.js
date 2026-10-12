// scroll-demo engine. Scroll position -> keyframe timeline -> springs -> inline styles.
// Modelled on the pagebuddy.app approach: every visual value chases its target
// through a spring, so the page glides between keyframes instead of snapping to
// the scrollbar. Never edit this per project. Write acts in the page.

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Clamped linear map: range(0.5, [0, 1], [10, 20]) -> 15. Output range may be reversed. */
export function range(v, [a, b], [c, d]) {
  const t = (v - a) / (b - a);
  const out = c + (d - c) * t;
  return c < d ? Math.min(d, Math.max(c, out)) : Math.min(c, Math.max(d, out));
}

export const presets = {
  follow: { stiffness: 500, damping: 500, mass: 3 },  // default: critically damped, ~0.7s catch-up, no overshoot
  bouncy: { stiffness: 160, damping: 18, mass: 2 },   // cards and dropped blocks settle with a little give
  soft: { stiffness: 160, damping: 24, mass: 1.5 },   // headlines leaving
  heavy: { stiffness: 500, damping: 500, mass: 10 },  // image sequences: slower catch-up hides frame steps
  instant: { stiffness: 5000, damping: 1, mass: 1, clamp: true },
};

// One rAF loop for every moving spring.
const live = new Set();
let raf = 0, last = 0;
function tick(now) {
  const dt = Math.min(0.064, (now - last) / 1000 || 0.016);
  last = now;
  for (const s of live) s._step(dt);
  raf = live.size ? requestAnimationFrame(tick) : 0;
}
function wake(s) {
  live.add(s);
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
}

/**
 * spring(n, apply, opts): n numbers chasing targets. apply(values[]) writes styles.
 * Pass it to a timeline track, or call .set([..]) yourself.
 */
export function spring(n, apply, opts = {}) {
  let cfg = { ...presets.follow, ...opts };
  const x = opts.initial ? [...opts.initial] : Array(n).fill(0);
  const v = Array(n).fill(0);
  let target = [...x];
  const s = {
    get value() { return x; },
    config(c) { cfg = { ...cfg, ...(presets[c] || c) }; return s; },
    snap(t) { target = [...t]; t.forEach((val, i) => { x[i] = val; v[i] = 0; }); apply(x); live.delete(s); },
    set(t) {
      t = Array.isArray(t) ? t : [t];
      if (reduced) return s.snap(t);
      if (t.every((val, i) => val === target[i]) && !live.has(s)) return;
      target = [...t];
      wake(s);
    },
    _step(dt) {
      const { stiffness: k, mass: m } = cfg;
      // Damping above critical is clamped to critical (pagebuddy's springs do the same):
      // the 'follow' preset would otherwise crawl the last few pixels for seconds.
      const c = cfg.overdamp ? cfg.damping : Math.min(cfg.damping, 2 * Math.sqrt(k * m));
      const steps = Math.ceil(dt / 0.004), h = dt / steps;
      let moving = false;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < steps; j++) {
          v[i] += ((-k * (x[i] - target[i]) - c * v[i]) / m) * h;
          x[i] += v[i] * h;
        }
        if (cfg.clamp && Math.sign(target[i] - x[i]) !== Math.sign(v[i]) && v[i] !== 0) { x[i] = target[i]; v[i] = 0; }
        if (Math.abs(v[i]) > 0.001 || Math.abs(x[i] - target[i]) > 0.001) moving = true;
        else { x[i] = target[i]; v[i] = 0; }
      }
      apply(x);
      if (!moving) live.delete(s);
    },
  };
  return s;
}

/** flag(apply): a discrete state (class on/off, cursor mode). Steps, never tweens. */
export function flag(apply) {
  let cur = Symbol('unset');
  const f = { discrete: true, set(val) { if (val !== cur) { cur = val; apply(val); } }, snap(val) { f.set(val); } };
  return f;
}

const lerp = (a, b, t) => (Array.isArray(a) ? a.map((ai, i) => ai + (b[i] - ai) * t) : a + (b - a) * t);

/**
 * timeline(rows): rows are [frame, [driver, target, ease?], ...].
 * Frames are integers on any scale (0..30 is typical). Returns go(progress 0..1).
 * A target may be a function, resolved when the timeline is built, so cursor
 * paths can be measured from the live layout. Rebuild on resize.
 * ease(t, from, to) lets one segment curve (an arc for a drag) instead of a line.
 */
export function timeline(rows) {
  const tracks = new Map();
  for (const [frame, ...entries] of rows) {
    for (const [driver, target, ease] of entries) {
      if (!tracks.has(driver)) tracks.set(driver, []);
      tracks.get(driver).push({ frame, target: typeof target === 'function' ? target() : target, ease });
    }
  }
  const end = Math.max(...rows.map((r) => r[0]));
  for (const keys of tracks.values()) keys.sort((a, b) => a.frame - b.frame);

  function valueAt(driver, keys, f) {
    if (f <= keys[0].frame) return keys[0].target;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (f <= b.frame) {
        if (driver.discrete) return f >= b.frame ? b.target : a.target;
        const t = (f - a.frame) / (b.frame - a.frame);
        return b.ease ? b.ease(t, a.target, b.target) : lerp(a.target, b.target, t);
      }
    }
    return keys[keys.length - 1].target;
  }

  let first = true;
  return function go(p) {
    const f = p * end;
    for (const [driver, keys] of tracks) {
      const val = valueAt(driver, keys, f);
      first ? driver.snap(Array.isArray(val) || driver.discrete ? val : [val]) : driver.set(val);
    }
    first = false;
  };
}

/**
 * scene(el, { progress, resize, from }): el is a tall <section> holding a sticky stage.
 * progress(p) gets 0 when the section top hits the viewport top, 1 when its
 * bottom reaches the viewport bottom. Listens to scroll only while visible.
 */
export function scene(el, { progress, resize, from = 'pin' } = {}) {
  if (typeof el === 'string') el = document.querySelector(el);
  // from: 'pin' starts at 0 when the stage sticks. 'enter' starts at 0 when the
  // section's top enters at the bottom of the viewport, so a close can begin
  // revealing on the way in instead of showing an empty screen first.
  const read = () => {
    const r = el.getBoundingClientRect();
    return range(r.top, [from === 'enter' ? innerHeight : 0, -(r.height - innerHeight)], [0, 1]);
  };
  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; progress?.(read()); });
  };
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting) { addEventListener('scroll', onScroll, { passive: true }); onScroll(); }
    else { removeEventListener('scroll', onScroll); progress?.(read()); }
  }).observe(el);
  let w = innerWidth;
  addEventListener('resize', () => {
    if (innerWidth === w && resize?.widthOnly) return; // phone URL bar shows/hides: height-only resize
    w = innerWidth;
    requestAnimationFrame(() => { resize?.(read()); progress?.(read()); });
  }, { passive: true });
  document.fonts?.ready.then(() => { resize?.(read()); progress?.(read()); });
  return { read };
}

/**
 * rects(container): positions of elements relative to container, cached until clear().
 * Measure with transforms reset, or a moving element will report where it is
 * mid-animation instead of where it lives.
 */
export function rects(container) {
  if (typeof container === 'string') container = document.querySelector(container);
  let cache = new Map();
  const measure = (el) => {
    const c = container.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { left: r.left - c.left, top: r.top - c.top, width: r.width, height: r.height,
      cx: r.left - c.left + r.width / 2, cy: r.top - c.top + r.height / 2 };
  };
  const box = (c, r) => ({ left: r.left - c.left, top: r.top - c.top, right: r.right - c.left, width: r.width, height: r.height,
    cx: r.left - c.left + r.width / 2, cy: r.top - c.top + r.height / 2 });
  return {
    of(el) { if (!cache.has(el)) cache.set(el, measure(el)); return cache.get(el); },
    /** lines(el): first and last line boxes of an inline element that wraps. Aim a selection with these, not of(). */
    lines(el) {
      const key = `lines:${el.dataset.sdKey ??= Math.random()}`;
      if (!cache.has(key)) {
        const c = container.getBoundingClientRect(), l = el.getClientRects();
        cache.set(key, { first: box(c, l[0]), last: box(c, l[l.length - 1]) });
      }
      return cache.get(key);
    },
    clear() { cache = new Map(); },
  };
}

/** withStyles(el, styles, fn): run fn with temporary inline styles, e.g. measure at rest. */
export function withStyles(el, styles, fn) {
  const prev = Object.keys(styles).map((k) => [k, el.style.getPropertyValue(k)]);
  for (const [k, v] of Object.entries(styles)) el.style.setProperty(k, v);
  const out = fn();
  for (const [k, v] of prev) el.style.setProperty(k, v);
  return out;
}

/**
 * blurIn(el, t): the house reveal. t=0 hidden, t=1 settled.
 * Opacity, a short rise, a slight scale-up, and blur clearing together.
 */
export function blurIn(el, t, { y = 10, scale = 0.94, blur = 4, unit = 'px' } = {}) {
  el.style.opacity = t;
  el.style.translate = `0 ${range(t, [0, 1], [y, 0])}${unit}`;
  el.style.scale = range(t, [0, 1], [scale, 1]);
  el.style.filter = reduced || t >= 1 ? 'none' : `blur(${range(t, [0, 1], [blur, 0])}px)`;
}

/** blurOut(el, t): a headline leaving. Fades, shrinks, blurs. */
export function blurOut(el, t, { scale = 0.7, blur = 10 } = {}) {
  el.style.opacity = 1 - t;
  el.style.scale = range(t, [0, 1], [1, scale]);
  el.style.filter = reduced || t <= 0 ? 'none' : `blur(${range(t, [0.025, 1], [0, blur])}px)`;
}

/**
 * stagger(els, p, apply, { each, span }): run apply(el, t) over a list with offsets.
 * each = start gap between items, span = how long one item takes, both in 0..1 of p.
 */
export function stagger(els, p, apply, { each = 0.08, span = 0.4 } = {}) {
  els.forEach((el, i) => apply(el, range(p, [i * each, i * each + span], [0, 1])));
}

/**
 * cursor(el): the ghost cursor. Returns { pos, mode, show } drivers for a timeline.
 * mode sets data-mode on the element: arrow | text | hand | grab | grabbing.
 */
export function cursor(el) {
  if (typeof el === 'string') el = document.querySelector(el);
  return {
    pos: spring(2, ([x, y]) => (el.style.translate = `${x}px ${y}px`)),
    mode: flag((m) => (el.dataset.mode = m)),
    show: flag((on) => (el.style.opacity = on ? 1 : 0)),
  };
}

/** typewriter(chars, caret, p): reveal per-character spans up to p and park the caret after the last one. */
export function typewriter(chars, caret, p, container) {
  const n = Math.min(chars.length - 1, Math.floor(p * chars.length));
  chars.forEach((c, i) => c.classList.toggle('sd-typed', i <= n));
  const r = chars[n].getBoundingClientRect(), c = container.getBoundingClientRect();
  caret.style.translate = `${r.right - c.left}px ${r.top - c.top}px`;
  caret.style.height = `${r.height}px`;
}

/**
 * splitChars(el): wrap every character in a span, in document order.
 * Inline children (<em>, .sd-sel) survive, so a phrase can be marked in the
 * HTML and still be selected later. Words stay unbreakable; spaces stay breakable.
 */
export function splitChars(el) {
  const sr = document.createElement('span');
  sr.className = 'sd-sr';
  sr.textContent = el.textContent.replace(/\s+/g, ' ').trim();
  const chars = [];
  const char = (ch) => {
    const s = document.createElement('span');
    s.className = 'sd-char';
    s.textContent = ch;
    chars.push(s);
    return s;
  };
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) { child.setAttribute('aria-hidden', 'true'); walk(child); continue; }
      if (child.nodeType !== 3) continue;
      const frag = document.createDocumentFragment();
      for (const part of child.textContent.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { const sp = char(' '); sp.setAttribute('aria-hidden', 'true'); frag.append(sp); continue; }
        const w = document.createElement('span');
        w.className = 'sd-word';
        w.setAttribute('aria-hidden', 'true');
        for (const ch of part) w.append(char(ch));
        frag.append(w);
      }
      child.replaceWith(frag);
    }
  };
  walk(el);
  el.prepend(sr); // screen readers get the sentence once, not letter by letter
  return chars;
}

/**
 * arc(lift): ease for a drag path. The block rises, travels, then drops in,
 * instead of sliding along a straight line. Use as a track's third element.
 */
export const arc = (lift = 80) => (t, [x0, y0], [x1, y1]) => [
  x0 + (x1 - x0) * t,
  y0 + (y1 - y0) * t * t * t - lift * Math.sin(Math.PI * t),
];

export const prefersReducedMotion = reduced;

/** True when no spring is moving. scripts/shoot.mjs waits on this before each frame. */
export const idle = () => live.size === 0;
window.__sdIdle = idle;
