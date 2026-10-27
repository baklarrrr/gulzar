'use strict';

// Gulzar: cook and make one step at a time, draw with your own hand, with big pictures and a voice, and a
// room that fills up with keepsakes as things get finished. Runs on a tablet or phone (touch) and on Meta
// Ray-Ban Display (600x600: swipes move focus between buttons, a pinch presses, Back is the system gesture;
// on the drawing page, pinch-and-drag draws). This file runs both index.html and draw.html.
// Everything is kept on the device (localStorage, and sessionStorage for a drawing in progress). Nothing is
// sent anywhere.

const $ = (sel, root = document) => root.querySelector(sel);
const screenEl = document.getElementById('screen');
const toastEl = document.getElementById('toast');
const IMG = (name) => `img/${name}.webp`;

// Drawing has its own page, draw.html. Its first stylesheet turns on pinch-and-drag for the glasses
// (body { touch-action: none }, which the glasses read once, when a page loads), so the rest of the app keeps the
// glasses' usual swipe and pinch.
const DRAW_PAGE = document.body.classList.contains('drawpage');

// ---- saved state ------------------------------------------------------------------------------------------
const DEFAULTS = {
  name: '', helperName: '', lang: 'en', greet: 'time', voice: true, autoRead: true, rate: 'normal', size: 'large',
  theme: 'dark', show: { cook: true, make: true, draw: true, day: true }, hide: [], dayItems: null,
  guide: true, vibrate: true, dragCheck: false,
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

let settings = { ...DEFAULTS, ...sanitizeSettings(load('gulzar.settings', {})) };
settings.show = { ...DEFAULTS.show, ...settings.show };
settings.dragCheck = dragCheckOn();
let room = Array.isArray(load('gulzar.room', [])) ? load('gulzar.room', []) : [];
let day = load('gulzar.day', { date: '', done: [], planted: false });

// Drag check is a helper's test tool: it lasts for this visit only (sessionStorage), so it is never left over her
// drawing the next time she opens the app.
function saveSettings() {
  const { dragCheck, ...keep } = settings;
  save('gulzar.settings', keep);
  try { sessionStorage.setItem('gulzar.dragCheck', dragCheck ? '1' : ''); } catch (e) { /* this visit only */ }
}

function dragCheckOn() {
  try { return sessionStorage.getItem('gulzar.dragCheck') === '1'; } catch (e) { return false; }
}

// Only known keys with known values get in, whether they come from storage or from a glasses link.
function sanitizeSettings(s) {
  const out = {};
  if (!s || typeof s !== 'object') return out;
  if (typeof s.name === 'string') out.name = s.name.trim().slice(0, 40);
  if (typeof s.helperName === 'string') out.helperName = s.helperName.trim().slice(0, 24);
  if (s.lang === 'en' || s.lang === 'ur') out.lang = s.lang;
  if (s.greet === 'time' || s.greet === 'salaam') out.greet = s.greet;
  if (typeof s.voice === 'boolean') out.voice = s.voice;
  if (typeof s.autoRead === 'boolean') out.autoRead = s.autoRead;
  for (const k of ['guide', 'vibrate']) if (typeof s[k] === 'boolean') out[k] = s[k];
  if (s.rate === 'slow' || s.rate === 'normal') out.rate = s.rate;
  if (s.size === 'large' || s.size === 'xl') out.size = s.size;
  if (s.theme === 'dark' || s.theme === 'light') out.theme = s.theme;
  if (s.show && typeof s.show === 'object') {
    out.show = {};
    for (const k of ['cook', 'make', 'draw', 'day']) out.show[k] = s.show[k] !== false;
  }
  if (Array.isArray(s.hide)) out.hide = s.hide.filter((id) => typeof id === 'string' && ACTIVITIES[id]);
  if (Array.isArray(s.dayItems)) {
    out.dayItems = s.dayItems.filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, 40)).filter(Boolean).slice(0, 10);
    if (!out.dayItems.length) out.dayItems = null;
  } else if (s.dayItems === null) {
    out.dayItems = null;
  }
  return out;
}

// A glasses link carries the helper's settings in the fragment (#s=...), which never reaches a server.
function encodeSettings(s) {
  const bytes = new TextEncoder().encode(JSON.stringify(s));
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function importFromLink() {
  const m = location.hash.match(/[#&]s=([A-Za-z0-9_-]+)/);
  if (!m) return;
  try {
    const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    settings = { ...settings, ...sanitizeSettings(JSON.parse(json)) };
    settings.show = { ...DEFAULTS.show, ...settings.show };
    saveSettings();
  } catch (e) {
    // A damaged link changes nothing.
  }
}

// ---- words ------------------------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function t(key, vars) {
  let s = (UI[settings.lang] && UI[settings.lang][key]) ?? UI.en[key] ?? key;
  if (vars && typeof s === 'string') for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

const L = (o) => (o ? (o[settings.lang] ?? o.en) : '');
const locale = () => (settings.lang === 'ur' ? 'ur-PK' : 'en-CA');
const fmtDate = (d) => new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(d);

// "Ask your helper…" becomes "Ask Ammi…" once the helper's name is set.
function helperText(s) {
  const nm = (settings.helperName || '').trim();
  if (!nm || !s) return s;
  if (settings.lang === 'ur') return s.replace(/مددگار/g, nm);
  return s.replace(/\b[Yy]our helper\b/g, nm).replace(/\b[Aa] helper\b/g, nm);
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function greeting() {
  const h = new Date().getHours();
  const g = settings.greet === 'salaam' ? t('salaam') : t(h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening');
  const sep = settings.lang === 'ur' ? '، ' : ', ';
  return settings.name ? `${g}${sep}${settings.name}` : g;
}

function timeIcon() {
  const h = new Date().getHours();
  return h >= 5 && h < 11 ? 'sunrise' : h >= 11 && h < 18 ? 'sun' : 'crescent_moon';
}

// ---- how it looks: touch screen or glasses ---------------------------------------------------------------
// The glasses are a small square display (600x600). A zoomed tablet or a phone on its side is not.
const glassesQuery = matchMedia('(max-width: 640px) and (max-height: 640px) and (min-aspect-ratio: 4/5) and (max-aspect-ratio: 5/4)');
const forceGlasses = new URLSearchParams(location.search).has('glasses');
const isGlasses = () => forceGlasses || glassesQuery.matches;

function applyLook() {
  const root = document.documentElement;
  const glasses = isGlasses();
  root.lang = settings.lang === 'ur' ? 'ur' : 'en';
  root.dir = settings.lang === 'ur' ? 'rtl' : 'ltr';
  root.classList.toggle('mode-glasses', glasses);
  root.classList.toggle('mode-touch', !glasses);
  // The glasses display adds light to the world: black is see-through, so the glasses always stay dark.
  root.classList.toggle('theme-light', !glasses && settings.theme === 'light');
  root.classList.toggle('size-xl', settings.size === 'xl');
  document.title = t('appName');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = !glasses && settings.theme === 'light' ? '#FFF7EA' : '#000000';
}

// ---- voice ------------------------------------------------------------------------------------------------
const speech = {
  ok: 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
  unlocked: false, // browsers only speak after the first tap or key press

  voiceFor(lang) {
    if (!this.ok) return null;
    const voices = speechSynthesis.getVoices() || [];
    const list = voices.filter((v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith(lang));
    return list.find((v) => v.default) || list.find((v) => v.localService) || list[0] || null;
  },

  // English always gets a try (the glasses have one en-US voice); Urdu only when the device has an Urdu voice.
  canSpeak(lang) {
    if (!this.ok) return false;
    return lang === 'en' || !!this.voiceFor('ur');
  },

  say(text, { force = false } = {}) {
    if (!text || !canVoice()) return false;
    if (!this.unlocked && !force) return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = settings.lang === 'ur' ? 'ur-PK' : 'en-US';
    const v = this.voiceFor(settings.lang);
    try { if (v) u.voice = v; } catch (e) { /* the device picks its own voice */ }
    u.rate = settings.rate === 'slow' ? 0.7 : 0.85;
    u.onstart = () => document.documentElement.classList.add('speaking');
    u.onend = () => document.documentElement.classList.remove('speaking');
    u.onerror = () => document.documentElement.classList.remove('speaking');
    speechSynthesis.speak(u);
    this.lastSaidAt = Date.now();
    return true;
  },

  stop() {
    if (this.ok) speechSynthesis.cancel();
    document.documentElement.classList.remove('speaking');
  },
};

// With no voice for the chosen language there is no Read button at all, rather than one that does nothing.
const canVoice = () => settings.voice && speech.canSpeak(settings.lang);

// Touch as a sense: short, quiet pulses where the browser allows them (Android Chrome), after the first touch.
// iPad and iPhone have no vibration for web pages, and the glasses have none for web apps, so nothing is
// faked there.
const canBuzz = () => typeof navigator.vibrate === 'function' && !isGlasses();
const PULSES = { press: 12, stroke: 10, step: 18, finish: [24, 80, 34] };
function buzz(kind) {
  if (!settings.vibrate || !canBuzz()) return;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate(PULSES[kind] || PULSES.press); } catch (e) { /* not allowed here */ }
}

let lastInput = 'pointer';
let calmTimer = 0;
// Resting: on the glasses, 15 s without a swipe or pinch rests the decoration (see style.css). The first input
// wakes it straight away and is still handled as usual.
function rest() { if (isGlasses()) document.documentElement.classList.add('resting'); }
function wake() {
  document.documentElement.classList.remove('resting');
  clearTimeout(calmTimer);
  if (!document.hidden && isGlasses()) calmTimer = setTimeout(rest, 15000);
}
addEventListener('pointerdown', () => { lastInput = 'pointer'; speech.unlocked = true; wake(); }, true);
addEventListener('keydown', () => { lastInput = 'key'; speech.unlocked = true; wake(); }, true);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { wake(); return; }
  clearTimeout(calmTimer);
  clearTimeout(focusTimer);
  speech.stop();
  toastEl.hidden = true;
});

// Drag check (helper-only): whether pinch-and-drag reaches this page on the real glasses, readable without a
// debugger. It shows the page's touch-action, pointer events by kind, moves in the last second, the pointer
// type, the last position against the area's size, and arrow keys (swipes) and Enter (pinches).
const drag = { down: 0, move: 0, up: 0, cancel: 0, arrows: 0, enter: 0, type: '-', x: 0, y: 0, moves: [], area: null, timer: 0 };
function dragTrack(e) {
  if (!settings.dragCheck) return;
  const kind = { pointerdown: 'down', pointermove: 'move', pointerup: 'up', pointercancel: 'cancel' }[e.type];
  drag[kind] += 1;
  drag.type = e.pointerType || '?';
  const box = drag.area && drag.area.getBoundingClientRect();
  if (box) { drag.x = Math.round(e.clientX - box.left); drag.y = Math.round(e.clientY - box.top); }
  if (kind === 'move') drag.moves.push(performance.now());
  dragShow();
}
['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((type) => addEventListener(type, dragTrack, true));
addEventListener('keydown', (e) => {
  if (!settings.dragCheck) return;
  if (e.key === 'Enter') drag.enter += 1;
  else if (e.key.startsWith('Arrow')) drag.arrows += 1;
  dragShow();
}, true);
function dragShow() {
  const el = document.getElementById('dragcheck');
  if (!el) return;
  const now = performance.now();
  drag.moves = drag.moves.filter((at) => now - at < 1000);
  const box = drag.area && drag.area.getBoundingClientRect();
  const size = box ? `${Math.round(box.width)}×${Math.round(box.height)}` : '-';
  el.textContent = `touch-action: ${getComputedStyle(document.body).touchAction} · down ${drag.down} · move ${drag.move} · up ${drag.up}`
    + ` · cancel ${drag.cancel} · ${drag.moves.length}/s · ${drag.type} · at ${drag.x},${drag.y} in ${size} · arrows ${drag.arrows} · Enter ${drag.enter}`;
  clearTimeout(drag.timer);
  drag.timer = setTimeout(dragShow, 1000); // lets the moves-per-second figure fall back to 0
}

// Swiping past the end of a row gives a small springy nudge, so a swipe is never met with nothing.
addEventListener('keydown', (e) => {
  if (!e.key.startsWith('Arrow') || e.defaultPrevented) return;
  const before = document.activeElement;
  setTimeout(() => {
    const el = document.activeElement;
    if (el !== before || !el || !screenEl.contains(el) || el.id === 'pad') return;
    const dir = e.key.slice(5).toLowerCase();
    el.classList.remove('nudge-up', 'nudge-down', 'nudge-left', 'nudge-right');
    void el.offsetWidth;
    el.classList.add(`nudge-${dir}`);
    setTimeout(() => el.classList.remove(`nudge-${dir}`), 320);
  }, 0);
});

// ---- small pieces of markup -------------------------------------------------------------------------------
const pic = (name, cls = '') => `<img class="pic ${cls}" src="${IMG(name)}" alt="" draggable="false">`;
const pics = (names, cls = '') => `<span class="pics n${names.length} ${cls}">${names.map((n) => pic(n)).join('')}</span>`;
const readBtn = (compact) => (canVoice()
  ? `<button class="read${compact ? ' icon' : ''}" data-act="read" aria-label="${esc(t('read'))}">${pic('speaker_high_volume')}<span>${esc(t('read'))}</span></button>`
  : '');
// Home sits at the start of a bar; the spacer after it pushes the other buttons to the end.
const homeBtn = (spacer = true) => `<button class="pill home touch-only" data-act="home">${pic('house')}<span class="lbl">${esc(t('home'))}</span></button>${spacer ? '<span class="spacer touch-only"></span>' : ''}`;

function topBar(title, { sub = '', gear = false, compactRead = false, img = '', lead = '' } = {}) {
  return `<header class="top">
    <div class="titles">${lead || (img ? pic(img, 'titlepic') : '')}<div><h1 tabindex="-1">${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div></div>
    <div class="tools">${readBtn(compactRead)}${gear ? `<button class="gear" data-act="gear" data-hold="gear" aria-label="${esc(t('helperTitle'))}">${pic('gear')}<span class="holdfill" aria-hidden="true"></span></button>` : ''}</div>
  </header>`;
}

// ---- drawings taught step by step -------------------------------------------------------------------------
function ring(n, make) {
  let s = '';
  for (let i = 0; i < n; i += 1) s += make((360 / n) * i);
  return s;
}
const polar = (deg, r) => [100 + r * Math.cos((deg * Math.PI) / 180), 100 + r * Math.sin((deg * Math.PI) / 180)].map((v) => v.toFixed(1));

const SUN_RAYS = ring(12, (a) => { const [x1, y1] = polar(a, 58); const [x2, y2] = polar(a, 82); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; });
const PETALS = ring(5, (a) => { const rad = ((a - 90) * Math.PI) / 180; return `<circle cx="${(100 + 31 * Math.cos(rad)).toFixed(1)}" cy="${(72 + 31 * Math.sin(rad)).toFixed(1)}" r="17"/>`; });
const LEAVES = '<path d="M99 150 C84 136 66 140 58 152 C72 160 88 160 99 150 Z"/><path d="M101 168 C116 154 134 158 142 170 C128 178 112 178 101 168 Z"/>';
const WINDOWS = '<rect x="60" y="108" width="22" height="22"/><rect x="118" y="108" width="22" height="22"/><path d="M71 108 V130 M60 119 H82 M129 108 V130 M118 119 H140"/>';
const DOOR = '<rect x="88" y="132" width="24" height="48" rx="3"/>';
const SMALL_PETALS = ring(8, (a) => `<ellipse cx="100" cy="72" rx="7" ry="11" transform="rotate(${a} 100 100)"/>`);
const BIG_PETALS = ring(8, (a) => `<ellipse cx="100" cy="44" rx="12" ry="17" transform="rotate(${a + 22.5} 100 100)"/>`);
const TIP_DOTS = ring(8, (a) => `<circle class="dot" cx="100" cy="16" r="4.5" transform="rotate(${a + 22.5} 100 100)"/>`);
const HOUSE_FLOWERS = '<circle cx="72" cy="187" r="7"/><circle cx="128" cy="187" r="7"/><path d="M72 194 V200 M128 194 V200"/>';

const ART = {
  sun: {
    parts: ['<circle cx="100" cy="100" r="42"/>', SUN_RAYS],
    colour: `<circle cx="100" cy="100" r="42" fill="#FFD84D" stroke="#FFB020"/><g stroke="#FF9F43">${SUN_RAYS}</g>`,
  },
  flower: {
    parts: ['<circle cx="100" cy="72" r="13"/>', PETALS, '<path d="M100 105 C96 132 104 156 100 192"/>', LEAVES],
    order: [1, 0, 2, 3], // petals are painted under the centre
    under: { 1: '<circle cx="100" cy="72" r="13"/>' }, // so the tracing outline leaves out the petals there
    colour: `<path d="M100 105 C96 132 104 156 100 192" stroke="#3FB560"/><g fill="#8EE59B" stroke="#3FB560">${LEAVES}</g><g fill="#FF8FB6" stroke="#FF5A93">${PETALS}</g><circle cx="100" cy="72" r="13" fill="#FFD84D" stroke="#F0A800"/>`,
  },
  house: {
    parts: ['<rect x="48" y="92" width="104" height="88"/>', '<path d="M38 92 L100 40 L162 92 Z"/>', DOOR, WINDOWS],
    colour: `<rect x="48" y="92" width="104" height="88" fill="#FFD9A8" stroke="#E8A050"/><path d="M38 92 L100 40 L162 92 Z" fill="#FF7A6B" stroke="#E0503F"/><g fill="#C08850" stroke="#8A5A2B">${DOOR}</g><g fill="#9FD8FF" stroke="#4DA8FF">${WINDOWS}</g><g fill="#FF8FB6" stroke="#3FB560">${HOUSE_FLOWERS}</g>`,
  },
  mehndi: {
    parts: ['<circle class="dot" cx="100" cy="100" r="8"/>', '<circle cx="100" cy="100" r="16"/>', SMALL_PETALS, BIG_PETALS, TIP_DOTS],
    henna: true,
  },
};

// upto = the step being taught: the whole picture shows faintly, parts already drawn in ink and the new part in
// the highlight colour. 0 = the finished picture.
function art(id, upto = 0) {
  const a = ART[id];
  if (!a) return '';
  const order = a.order || a.parts.map((_, i) => i);
  let body;
  if (!upto || upto > a.parts.length) {
    body = a.colour || `<g class="${a.henna ? 'henna' : 'old'}">${order.map((i) => a.parts[i]).join('')}</g>`;
  } else {
    body = `<g class="ghost">${order.map((i) => a.parts[i]).join('')}</g>${order.filter((i) => i < upto).map((i) => `<g class="${i === upto - 1 ? 'new' : 'old'}">${a.parts[i]}</g>`).join('')}`;
  }
  return `<svg class="art" viewBox="0 0 200 200" aria-hidden="true">${body}</svg>`;
}

// The tracing guide on the drawing page: the picture's outline, drawn as one quiet layer (so crossings do not get
// brighter) at a constant screen width, to trace or ignore. Parts another part covers are cut away (the flower's
// petals under its centre). When a step is shown, its part is drawn on top in the highlight colour; with the
// outline switched off (only), that part is all there is, so a step always shows which part it means.
function guideSvg(id, tip = 0, only = false) {
  const a = ART[id];
  if (!a) return '';
  const order = a.order || a.parts.map((_, i) => i);
  let defs = '';
  const rest = only ? '' : order.filter((i) => i !== tip - 1).map((i) => {
    if (!a.under || !a.under[i]) return `<g>${a.parts[i]}</g>`;
    defs += `<mask id="cut-${id}-${i}" maskUnits="userSpaceOnUse" x="-12" y="-12" width="224" height="224"><rect x="-12" y="-12" width="224" height="224" fill="#fff"/><g fill="#000" stroke="none">${a.under[i]}</g></mask>`;
    return `<g mask="url(#cut-${id}-${i})">${a.parts[i]}</g>`;
  }).join('');
  const now = tip && a.parts[tip - 1] ? `<g class="now">${a.parts[tip - 1]}</g>` : '';
  return `<svg class="guide" viewBox="-12 -12 224 224" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${defs ? `<defs>${defs}</defs>` : ''}${rest ? `<g class="rest">${rest}</g>` : ''}${now}</svg>`;
}

// ---- the room ---------------------------------------------------------------------------------------------
// Each room has fixed places: three frames, four shelf spots, three on the table, three plants. When a kind of
// place is full, a new room starts, so nothing ever leaves; the newest room shows first.
const FRAMES = [[70, 74, 150, 116], [250, 58, 160, 136], [440, 74, 150, 116]];
// [x, y, size]: pictures have a little transparent space at the bottom, so y puts them right on the surface.
const SHELF = [[70, 224, 118], [195, 224, 118], [320, 224, 118], [445, 224, 118]];
const TABLE = [[622, 379, 106], [714, 379, 106], [806, 379, 106]];
const PLANTS = [[706, 202, 98], [836, 202, 98], [430, 482, 150]];
const CAPS = { draw: FRAMES.length, make: SHELF.length, cook: TABLE.length, day: PLANTS.length };

function keepFor(item) {
  if (item.kind === 'day') return DAY_PLANTS[(item.n || 0) % DAY_PLANTS.length];
  const a = ACTIVITIES[item.act];
  if (item.kind === 'draw') {
    const name = a ? a.name : { en: 'Free drawing', ur: 'جو چاہیں بنائیں' };
    return drawingOf(item)
      ? { img: 'framed_picture', en: `Your drawing: ${name.en}`, ur: `آپ کی تصویر: ${name.ur}` }
      : { img: 'page_facing_up', en: `Your drawing on paper: ${name.en}`, ur: `کاغذ پر آپ کی تصویر: ${name.ur}` };
  }
  return a ? a.keep : { img: 'star', en: 'Something you made', ur: 'آپ کی بنائی ہوئی چیز' };
}

function drawingOf(item) {
  if (!item || !item.drawing) return null;
  let raw = '';
  try { raw = localStorage.getItem(item.drawing) || ''; } catch (e) { return null; }
  if (raw.startsWith('data:image/')) return { photo: raw };
  try {
    const d = JSON.parse(raw);
    return d && d.v === 1 && Array.isArray(d.s) ? { vector: d } : null;
  } catch (e) {
    return null;
  }
}

function vectorSvg(d, { minWidth = 0, box = '' } = {}) {
  const lw = Math.max(d.lw || 20, minWidth);
  const marks = d.s.map(([c, pts]) => {
    const col = c > 0 && PAD_COLOURS[c] ? PAD_COLOURS[c].css : 'currentColor';
    if (pts.length <= 2) return `<circle cx="${pts[0]}" cy="${pts[1]}" r="${lw / 2}" fill="${col}"/>`;
    let path = `M${pts[0]} ${pts[1]}`;
    for (let i = 2; i < pts.length; i += 2) path += `Q${pts[i - 2]} ${pts[i - 1]} ${(pts[i - 2] + pts[i]) / 2} ${(pts[i - 1] + pts[i + 1]) / 2}`;
    path += `L${pts[pts.length - 2]} ${pts[pts.length - 1]}`;
    return `<path d="${path}" stroke="${col}"/>`;
  }).join('');
  return `<svg class="drawing" ${box} viewBox="0 0 ${d.w} ${d.h}" preserveAspectRatio="xMidYMid meet" fill="none" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${marks}</svg>`;
}

function roomPages(items) {
  const pages = [];
  items.forEach((it, i) => {
    const kind = CAPS[it.kind] ? it.kind : 'make';
    let page = pages.find((p) => p[kind].length < CAPS[kind]);
    if (!page) {
      page = { draw: [], make: [], cook: [], day: [] };
      pages.push(page);
    }
    page[kind].push({ ...it, i });
  });
  return pages.length ? pages : [{ draw: [], make: [], cook: [], day: [] }];
}

function roomSvg(page, { fresh = -1 } = {}) {
  const sky = timeIcon() === 'crescent_moon' ? 'night' : 'day';
  let s = `<svg class="roomsvg sky-${sky}" viewBox="0 0 1000 640" role="img" aria-label="${esc(t('room'))}">
    <defs>
      <radialGradient id="lampglow"><stop offset="0" stop-color="#ffd27a" stop-opacity="0.3"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
      <linearGradient id="walltone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.22"/><stop offset="0.7" stop-color="#000" stop-opacity="0"/></linearGradient>
    </defs>
    <rect class="wall" x="0" y="0" width="1000" height="452"/>
    <rect class="walltone" x="0" y="0" width="1000" height="452" fill="url(#walltone)"/>
    <line class="rail" x1="0" y1="34" x2="1000" y2="34"/>
    <rect class="floor" x="0" y="452" width="1000" height="188"/>
    <path class="sunpatch" d="M700 452 H930 L1000 640 H646 Z"/>
    <path class="boards" d="M0 512 H1000 M0 578 H1000"/>
    <line class="skirting" x1="0" y1="452" x2="1000" y2="452"/>
    <rect class="window" x="690" y="56" width="250" height="236" rx="10"/>
    <path class="mullion" d="M815 56 V292 M690 174 H940"/>
    <image class="decor" href="${IMG(sky === 'night' ? 'crescent_moon' : 'sun')}" x="722" y="80" width="78" height="78"/>
    <rect class="sill" x="672" y="292" width="286" height="16" rx="6"/>
    <rect class="shelf" x="58" y="330" width="524" height="16" rx="6"/>
    <path class="bracket" d="M110 346 V372 M530 346 V372"/>
    <ellipse class="rug" cx="300" cy="604" rx="250" ry="30"/>
    <ellipse class="lampglow" cx="250" cy="600" rx="240" ry="80" fill="url(#lampglow)"/>
    <circle class="lampglow" cx="291" cy="430" r="62" fill="url(#lampglow)" opacity="0.5"/>
    <image class="decor" href="${IMG('couch_and_lamp')}" x="110" y="386" width="258" height="258"/>
    <rect class="table" x="620" y="474" width="300" height="18" rx="8"/>
    <path class="legs" d="M648 492 V620 M892 492 V620"/>`;
  const sparkle = (x, y, size) => `<image href="${IMG('sparkles')}" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
  FRAMES.forEach(([x, y, w, h], k) => {
    const it = page.draw[k];
    s += `<rect class="frame${it ? '' : ' empty'}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>`;
    if (!it) return;
    const d = drawingOf(it);
    const inner = `x="${x + 12}" y="${y + 12}" width="${w - 24}" height="${h - 24}"`;
    if (d && d.photo) s += `<image href="${esc(d.photo)}" ${inner} preserveAspectRatio="xMidYMid meet"/>`;
    else if (d && d.vector) s += vectorSvg(d.vector, { minWidth: d.vector.w / 34, box: inner });
    else s += `<image href="${IMG('page_facing_up')}" x="${x + w / 2 - 44}" y="${y + h / 2 - 44}" width="88" height="88"/><image href="${IMG('crayon')}" x="${x + w / 2 + 6}" y="${y + h / 2 - 2}" width="48" height="48"/>`;
    if (it.i === fresh) s += sparkle(x + w - 40, y - 30, 70);
  });
  const place = (slots, list) => slots.forEach(([x, y, size], k) => {
    const it = list[k];
    if (!it) return;
    s += `<image class="thing" href="${IMG(keepFor(it).img)}" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
    if (it.i === fresh) s += sparkle(x + size * 0.62, y - size * 0.3, size * 0.55);
  });
  place(SHELF, page.make);
  place(TABLE, page.cook);
  place(PLANTS, page.day);
  return `${s}</svg>`;
}

// ---- lists ------------------------------------------------------------------------------------------------
const ticks = {}; // things ticked on "You will need", for this visit only
const visibleIds = (kind) => (ORDER[kind] || []).filter((id) => !settings.hide.includes(id));
const showKind = (kind) => settings.show[kind] && visibleIds(kind).length > 0;

// A picture for the helper's own day lines, matched on whole words ("sweater" is not "eat").
function pictureFor(text) {
  const words = text.toLowerCase().split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  const same = (w, k) => w === k || (/^[a-z]+$/.test(k) && [`${k}s`, `${k}es`, `${k}ing`, `${k}ed`].includes(w));
  const hit = KEYWORDS.find(([keys]) => keys.some((k) => words.some((w) => same(w, k))));
  return hit ? hit[1] : 'star';
}

function dayList() {
  if (settings.dayItems) return settings.dayItems.map((text) => ({ img: pictureFor(text), text }));
  return DAY_STARTER.map((d) => ({ img: d.img, text: L(d) }));
}

function freshDay() {
  if (day.date !== todayKey()) {
    day = { date: todayKey(), done: [], planted: false };
    save('gulzar.day', day);
  }
}

function dayStage(items) {
  const n = items.filter((_, i) => day.done.includes(i)).length;
  if (items.length && n >= items.length) return DAY_STAGES[3];
  return DAY_STAGES[Math.min(2, Math.floor((n / Math.max(1, items.length)) * 3))];
}

const stepPictures = (st) => (st.helper ? ['handshake', ...st.img.filter((x) => x !== 'kitchen_knife' && x !== 'scissors')] : st.img);

// ---- screens ----------------------------------------------------------------------------------------------
// Each returns { html, say, focus, after }. "say" is what Read to me (and auto-read) speaks.
const SCREENS = {
  home() {
    freshDay();
    const g = greeting();
    const tiles = ['cook', 'make', 'draw'].filter(showKind).concat('room');
    const items = dayList();
    const allDone = items.length > 0 && items.every((_, i) => day.done.includes(i));
    const strip = settings.show.day
      ? `<button class="daystrip" data-act="go" data-to="day" data-say="${esc(t('day'))}">
          ${pic(TILE_IMG.day)}<span class="label">${esc(t('day'))}</span>
          ${allDone ? `<span class="count">${esc(t('dayAll'))}</span>`
            : `<span class="pips" aria-hidden="true">${items.map((_, i) => `<i class="${day.done.includes(i) ? 'on' : ''}"></i>`).join('')}</span>`}
        </button>`
      : '';
    const html = `${topBar(g, { sub: esc(fmtDate(new Date())), gear: true, img: timeIcon() })}
      ${strip}
      <p class="ask">${esc(t('ask'))}</p>
      <div class="tiles n${tiles.length}">
        ${tiles.map((k) => `<button class="tile k-${k}" data-act="go" data-to="${k === 'room' ? 'room' : `list:${k}`}" data-say="${esc(t(k))}">${pic(TILE_IMG[k])}<span>${esc(t(k))}</span></button>`).join('')}
      </div>`;
    return { html, say: `${g}. ${t('ask')}`, focus: '.tile' };
  },

  list(kind) {
    const ids = visibleIds(kind);
    const cards = ids.map((id) => {
      const a = ACTIVITIES[id];
      const helpers = a.steps.filter((s) => s.helper).length;
      const meta = kind === 'draw' ? ''
        : `${t('nSteps', { n: a.steps.length })}${helpers ? ` · ${helperText(t('withHelper', { h: helpers }))}` : ''}`;
      const picture = kind === 'draw' ? `<span class="artbox">${art(id, 0)}</span>` : pics(a.hero);
      const open = kind === 'draw' ? `data-act="draw" data-id="${id}"` : `data-act="go" data-to="intro:${id}"`;
      return `<button class="card k-${kind}" ${open} data-say="${esc(L(a.name))}">${picture}<span class="cardtext"><span class="name">${esc(L(a.name))}</span>${meta ? `<span class="meta">${esc(meta)}</span>` : ''}</span></button>`;
    });
    if (kind === 'draw') {
      cards.push(`<button class="card k-draw" data-act="draw" data-id="free" data-say="${esc(t('free'))}">${pics(['paintbrush'])}<span class="cardtext"><span class="name">${esc(t('free'))}</span><span class="meta">${esc(t('freeHint'))}</span></span></button>`);
    }
    const names = ids.map((id) => L(ACTIVITIES[id].name)).join(', ');
    return {
      html: `${topBar(t(`pick${kind}`), { img: TILE_IMG[kind] })}<div class="cards n${cards.length} k-${kind}">${cards.join('')}</div><div class="bar">${homeBtn()}</div>`,
      say: `${t(`pick${kind}`)}. ${names}${kind === 'draw' ? `, ${t('free')}` : ''}.`,
      focus: '.card',
    };
  },

  intro(id) {
    const a = ACTIVITIES[id];
    if (!a) return SCREENS.home();
    const needs = a.needs;
    const got = ticks[id] || (ticks[id] = new Set());
    const lead = pics(a.hero, 'lead');
    const html = `${topBar(L(a.name), { sub: esc(t('nSteps', { n: a.steps.length })), lead })}
      <div class="intro k-${a.kind}">
        <div class="needs">
          <h2>${esc(t('need'))}</h2>
          <div class="needgrid n${needs.length}">
            ${needs.map((n, i) => `<button class="need${got.has(i) ? ' got' : ''}" data-act="tick" data-id="${id}" data-i="${i}" aria-pressed="${got.has(i)}" data-say="${esc(helperText(L(n)))}">${pic(n.img)}<span>${esc(helperText(L(n)))}</span><span class="tickmark" aria-hidden="true"></span></button>`).join('')}
          </div>
          <p class="hint">${esc(t('needHint'))}</p>
        </div>
      </div>
      <div class="bar">${homeBtn()}<button class="primary big" data-act="go" data-to="step:${id}:1">${esc(t('start'))}<span class="arrow" aria-hidden="true"></span></button></div>`;
    return { html, say: helperText(`${L(a.name)}. ${t('need')}: ${needs.map((n) => L(n)).join(', ')}.`), focus: '.bar .primary' };
  },

  step(id, nStr) {
    const a = ACTIVITIES[id];
    if (!a) return SCREENS.home();
    const total = a.steps.length;
    const n = Math.min(Math.max(parseInt(nStr, 10) || 1, 1), total);
    const st = a.steps[n - 1];
    const last = n === total;
    const picture = pics(stepPictures(st), 'step');
    const dots = Array.from({ length: total }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    const actions = `<button class="primary big" data-act="${last ? 'finish' : 'next'}" data-id="${id}">${esc(last ? t('finish') : t('next'))}<span class="${last ? 'check' : 'arrow'}" aria-hidden="true"></span></button>`;
    const sentence = helperText(L(st));
    const html = `<header class="top step-top">
        <div class="titles"><div><h1 tabindex="-1">${esc(L(a.name))}</h1><p class="sub"><span class="stepof">${esc(t('stepOf', { n, t: total }))}</span><span class="dots" aria-hidden="true">${dots}</span></p></div></div>
        <div class="tools">${readBtn(true)}</div>
      </header>
      <div class="stepbody k-${a.kind}${st.helper ? ' needs-helper' : ''}">
        <div class="stepart">${picture}</div>
        <div class="steptext">
          ${st.helper ? `<p class="helper">${pic('handshake')}<span>${esc(helperText(t('helperBadge')))}</span></p>` : ''}
          <p class="say">${esc(sentence)}</p>
          ${n === 1 ? `<p class="calm">${esc(t('slow'))}</p>` : ''}
        </div>
      </div>
      <div class="bar">
        ${homeBtn(false)}
        <button class="pill prev${n === 1 ? ' unseen' : ''}" data-act="prev" data-id="${id}" ${n === 1 ? 'disabled' : ''} aria-label="${esc(t('prev'))}"><span class="arrow back" aria-hidden="true"></span><span class="lbl">${esc(t('prev'))}</span></button>
        <span class="spacer"></span>
        ${actions}
      </div>`;
    return { html, say: `${t('stepSay', { n })} ${sentence}`, focus: '.bar .primary' };
  },

  done(id) {
    const a = ACTIVITIES[id];
    const item = room[room.length - 1];
    // A plain, warm closing line about what it is for; never a verdict on how something looks.
    const line = a && a.kind === 'cook' ? t('closeCook') : a && a.kind === 'make' ? t('closeMake') : '';
    if (item && item.kind === 'draw') doneDraft = item.act;
    const madeText = a ? L(a.doneText) : L({ en: 'You made a drawing.', ur: 'آپ نے تصویر بنائی۔' });
    let hero;
    let keepText;
    let keepPic = '';
    if (item && item.kind === 'draw') {
      const d = drawingOf(item);
      hero = d && d.photo ? `<img class="drawn photo" src="${esc(d.photo)}" alt="">`
        : d && d.vector ? `<span class="drawn">${vectorSvg(d.vector, { minWidth: d.vector.w / 45 })}</span>`
          : pics(['page_facing_up', 'crayon'], 'keepsakes');
      keepText = d ? t('onWall') : t('paperPlace');
    } else {
      const keep = item ? keepFor(item) : { img: 'sparkles' };
      hero = a && a.hero ? pics(a.hero, 'keepsakes') : pic(keep.img, 'keepsake');
      keepText = keep.text ? L(keep.text) : '';
      keepPic = keep.img ? pic(keep.img, 'inline') : '';
    }
    const html = `<div class="donebox">
        <div class="celebrate">${hero}${pic('sparkles', 'spark')}</div>
        <h1 tabindex="-1">${esc(madeText)}</h1>
        ${line ? `<p class="praise">${esc(line)}</p>` : ''}
        <p class="keeptext">${keepPic}<span>${esc(keepText)}</span></p>
        ${item && item.act === id ? `<button class="pill notdone" data-act="notDone">${esc(t(item.kind === 'draw' ? 'keepDrawing' : 'backToSteps'))}</button>` : ''}
      </div>
      <div class="bar">
        ${homeBtn()}
        ${readBtn(true)}
        <button class="primary big" data-act="go" data-to="room" data-replace="1">${pic('couch_and_lamp')}<span>${esc(t('seeRoom'))}</span></button>
      </div>`;
    return { html, say: `${madeText} ${line} ${keepText}`.replace(/\s+/g, ' ').trim(), focus: '.bar .primary' };
  },

  room(pStr) {
    const n = room.length;
    const pages = roomPages(room);
    const newest = Math.max(0, pages.findIndex((p) => ['draw', 'make', 'cook', 'day'].some((k) => p[k].some((it) => it.i === n - 1))));
    const idx = pStr ? Math.min(Math.max((parseInt(pStr, 10) || 1) - 1, 0), pages.length - 1) : newest;
    const count = pages.length > 1 ? t('roomOf', { n: idx + 1, t: pages.length, all: n }) : n === 1 ? t('roomOne') : t('roomCount', { n });
    const fresh = history.state && history.state.fresh ? n - 1 : -1;
    // Only the way that leads somewhere is shown: Earlier room from the newest, Newer room from the first.
    const nav = `${idx > 0 ? `<button class="pill" data-act="roomPage" data-p="${idx}"><span class="arrow back" aria-hidden="true"></span><span>${esc(t('prevRoom'))}</span></button>` : ''}${idx < pages.length - 1 ? `<button class="pill" data-act="roomPage" data-p="${idx + 2}"><span>${esc(t('nextRoom'))}</span><span class="arrow" aria-hidden="true"></span></button>` : ''}`;
    const html = `${topBar(t('room'), { sub: n ? esc(count) : '', img: TILE_IMG.room })}
      <div class="roombox">${roomSvg(pages[idx], { fresh })}</div>
      <p class="roomline">${esc(n ? t('roomLine') : t('roomEmpty'))}</p>
      <div class="bar">
        ${homeBtn()}
        ${nav}
        ${n ? `<button class="primary big" data-act="go" data-to="things">${pic('basket')}<span>${esc(t('everything'))}</span></button>` : ''}
      </div>`;
    return { html, say: `${t('room')}. ${n ? `${count}. ${t('roomLine')}` : t('roomEmpty')}`, focus: n ? '.bar .primary' : 'h1' };
  },

  things() {
    const rows = room.map((it, i) => ({ it, i })).reverse().map(({ it, i }) => {
      const k = keepFor(it);
      const when = t('added', { date: fmtDate(new Date(it.at)) });
      const d = it.kind === 'draw' ? drawingOf(it) : null;
      const picture = d && d.photo ? `<img class="thumb" src="${esc(d.photo)}" alt="">`
        : d && d.vector ? `<span class="thumb">${vectorSvg(d.vector, { minWidth: d.vector.w / 16 })}</span>` : pic(k.img);
      return `<li><button class="thingrow" data-act="saything" data-i="${i}" data-say="${esc(`${L(k)}. ${when}`)}">${picture}<span class="tt"><span class="name">${esc(L(k))}</span><span class="meta">${esc(when)}</span></span></button></li>`;
    }).join('');
    return {
      html: `${topBar(t('everything'), { img: 'basket' })}<ol class="things">${rows}</ol><div class="bar">${homeBtn()}</div>`,
      say: `${t('everything')}. ${room.length === 1 ? t('roomOne') : t('roomCount', { n: room.length })}.`,
      focus: '.thingrow',
    };
  },

  day() {
    freshDay();
    const items = dayList();
    const all = items.length > 0 && items.every((_, i) => day.done.includes(i));
    const rows = items.map((d, i) => {
      const on = day.done.includes(i);
      return `<li><button class="dayrow${on ? ' on' : ''}" data-act="dayTick" data-i="${i}" aria-pressed="${on}" data-say="${esc(d.text)}">${pic(d.img)}<span class="name">${esc(d.text)}</span><span class="tickmark" aria-hidden="true"></span></button></li>`;
    }).join('');
    const hint = all ? `${t('dayFinished')} ${t('plantNew')}` : `${t('dayHint')} ${t('dayGrow')}`;
    const hintHtml = all ? esc(hint) : `${esc(t('dayHint'))} <span class="grow">${esc(t('dayGrow'))}</span>`;
    const html = `${topBar(t('day'), { sub: esc(fmtDate(new Date())), img: TILE_IMG.day })}
      <div class="dayhead">${pic(dayStage(items), 'stage')}<p class="hint dayhint${all ? ' cheer' : ''}">${hintHtml}</p></div>
      <ol class="daylist n${items.length}">${rows}</ol>
      <div class="bar">${homeBtn()}${all ? `<button class="primary big" data-act="go" data-to="room">${pic('couch_and_lamp')}<span>${esc(t('seeRoom'))}</span></button>` : ''}</div>`;
    return { html, say: `${t('day')}. ${all ? hint : items.filter((_, i) => !day.done.includes(i)).map((d) => d.text).join(', ')}`, focus: '.dayrow' };
  },

  helper() {
    const opt = (key, value, label) => `<button class="seg${settings[key] === value ? ' on' : ''}" data-act="set" data-key="${key}" data-value="${value}" aria-pressed="${settings[key] === value}">${esc(label)}</button>`;
    const row = (label, inner) => `<div class="setrow"><span class="setlabel">${esc(label)}</span><div class="segs">${inner}</div></div>`;
    const showRow = ['cook', 'make', 'draw', 'day'].map((k) => `<button class="seg${settings.show[k] ? ' on' : ''}" data-act="show" data-key="${k}" aria-pressed="${settings.show[k]}">${esc(t(k))}</button>`).join('');
    const actRow = Object.keys(ORDER).flatMap((k) => ORDER[k]).map((id) => {
      const on = !settings.hide.includes(id);
      return `<button class="seg k-${ACTIVITIES[id].kind}${on ? ' on' : ''}" data-act="toggleAct" data-id="${id}" aria-pressed="${on}">${esc(L(ACTIVITIES[id].name))}</button>`;
    }).join('');
    const voices = !speech.ok ? t('voiceNone') : speech.voiceFor('ur') ? t('voiceOk') : t('voiceNoUrdu');
    const dayText = (settings.dayItems || DAY_STARTER.map((d) => L(d))).join('\n');
    const backup = load('gulzar.room.backup', null);
    const keys = isGlasses();
    const html = `${topBar(t('helperTitle'), { sub: esc(t('helperNote')), img: 'gear' })}
      <div class="settings">
        <label class="setrow"><span class="setlabel">${esc(t('nameLabel'))}</span><input id="nameInput" type="text" maxlength="40" autocomplete="off" value="${esc(settings.name)}" placeholder="${esc(t('namePh'))}"></label>
        <label class="setrow"><span class="setlabel">${esc(t('helperNameLabel'))}</span><input id="helperInput" type="text" maxlength="24" autocomplete="off" value="${esc(settings.helperName)}" placeholder="${esc(t('namePh'))}"></label>
        ${row(t('langLabel'), `${opt('lang', 'en', 'English')}${opt('lang', 'ur', 'اردو')}`)}
        ${row(t('greetLabel'), `${opt('greet', 'time', t('greetTime'))}${opt('greet', 'salaam', t('salaam'))}`)}
        ${row(t('voiceLabel'), `${opt('voice', true, t('on'))}${opt('voice', false, t('off'))}`)}
        ${row(t('autoLabel'), `${opt('autoRead', true, t('on'))}${opt('autoRead', false, t('off'))}`)}
        ${row(t('rateLabel'), `${opt('rate', 'slow', t('slowLbl'))}${opt('rate', 'normal', t('normalLbl'))}`)}
        <p class="voicestate">${esc(t('voiceStatus'))}: ${esc(voices)}</p>
        ${row(t('sizeLabel'), `${opt('size', 'large', t('large'))}${opt('size', 'xl', t('xl'))}`)}
        <div class="touch-only">${row(t('themeLabel'), `${opt('theme', 'dark', t('dark'))}${opt('theme', 'light', t('light'))}`)}</div>
        ${row(t('showLabel'), showRow)}
        ${row(t('activitiesLabel'), actRow)}
        ${row(t('guideLabel'), `${opt('guide', true, t('on'))}${opt('guide', false, t('off'))}`)}
        <div class="setrow touch-only"><span class="setlabel">${esc(t('vibrateLabel'))}</span>
          ${canBuzz() ? `<div class="segs">${opt('vibrate', true, t('on'))}${opt('vibrate', false, t('off'))}</div>` : `<span class="voicestate">${esc(t('vibrateNone'))}</span>`}
          <p class="fine">${esc(t('vibrateNote'))}</p>
        </div>
        ${row(t('dragLabel'), `${opt('dragCheck', true, t('on'))}${opt('dragCheck', false, t('off'))}`)}
        ${settings.dragCheck ? `<p class="fine">${esc(t('dragHow'))}</p>` : ''}
        <label class="setrow"><span class="setlabel">${esc(t('dayLabel'))}</span><textarea id="dayInput" rows="6" maxlength="440">${esc(dayText)}</textarea></label>
        <div class="setrow"><span class="setlabel"></span><div class="daypreview" id="dayPreview">${dayPreview()}</div></div>
        <div class="setrow"><span class="setlabel"></span><div class="segs"><button class="seg" data-act="dayStarter">${esc(t('dayReset'))}</button></div></div>
        <div class="setrow touch-only"><span class="setlabel">${esc(t('glassesLabel'))}</span>
          <div class="segs"><a class="seg" id="addGlasses" href="${esc(deepLink())}">${esc(t('addGlasses'))}</a><button class="seg" data-act="copyLink">${esc(t('copyLink'))}</button></div>
          <p class="fine">${esc(t('glassesNote'))}</p>
        </div>
        <div class="setrow"><span class="setlabel">${esc(t('roomLabel'))}</span><div class="segs">
          <button class="seg danger" data-act="clearRoom" data-hold="clear"><span class="holdfill" aria-hidden="true"></span><span>${esc(keys ? t('clearRoomKeys') : t('clearRoom'))}</span></button>
          ${backup ? `<button class="seg" data-act="restoreRoom">${esc(t('restoreRoom'))}</button>` : ''}
        </div></div>
        <p class="fine">${esc(t('credits'))}</p>
      </div>
      <div class="bar"><button class="primary big" data-act="home">${esc(t('ok'))}<span class="check" aria-hidden="true"></span></button></div>`;
    return {
      html,
      say: t('helperTitle'),
      focus: '.seg',
      after: () => {
        let timer;
        const later = (fn) => { clearTimeout(timer); timer = setTimeout(fn, 400); };
        const name = $('#nameInput');
        const helperIn = $('#helperInput');
        const dayIn = $('#dayInput');
        name.addEventListener('input', () => later(() => { settings.name = name.value.trim().slice(0, 40); saveSettings(); refreshLink(); }));
        helperIn.addEventListener('input', () => later(() => { settings.helperName = helperIn.value.trim().slice(0, 24); saveSettings(); refreshLink(); }));
        dayIn.addEventListener('input', () => later(() => {
          const lines = dayIn.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 10).map((x) => x.slice(0, 40));
          settings.dayItems = lines.length ? lines : null;
          saveSettings();
          refreshLink();
          const prev = $('#dayPreview');
          if (prev) prev.innerHTML = dayPreview();
        }));
      },
    };
  },
};

function dayPreview() {
  return dayList().map((d) => `<span class="dp">${pic(d.img)}<span>${esc(d.text)}</span></span>`).join('');
}

function glassesLink() {
  const base = `${location.origin}${location.pathname.replace(/index\.html$/, '')}`;
  const { name, helperName, lang, greet, voice, autoRead, rate, size, show, hide, dayItems, guide } = settings;
  return `${base}#s=${encodeSettings({ name, helperName, lang, greet, voice, autoRead, rate, size, show, hide, dayItems, guide })}`;
}

const deepLink = () => `fb-viewapp://web_app_deep_link?appName=Gulzar&appUrl=${encodeURIComponent(glassesLink())}`;

function refreshLink() {
  const a = $('#addGlasses');
  if (a) a.href = deepLink();
}

// ---- drawing pad ------------------------------------------------------------------------------------------
const PAD_COLOURS = [
  { css: 'var(--ink)', en: 'Ink', ur: 'سیاہی' },
  { css: '#FF5A5A', en: 'Red', ur: 'لال' },
  { css: '#FFC830', en: 'Yellow', ur: 'پیلا' },
  { css: '#3FC46A', en: 'Green', ur: 'ہرا' },
  { css: '#3D9BFF', en: 'Blue', ur: 'نیلا' },
  { css: '#FF6FB0', en: 'Pink', ur: 'گلابی' },
];

// Her lines are kept in the picture's own square units (the guide's viewBox, -12 to 212), fitted to the drawing
// area with one even scale and centred. However the canvas changes shape (a step opens, the tablet turns), a circle
// stays a circle and stays on the outline she traced.
const SPACE = { min: -12, size: 224 };

// A drawing in progress is kept for this visit (sessionStorage): it survives leaving the drawing page by Home or
// Back, and "Keep drawing" can give it back after Done.
const draft = {
  name: (key) => `gulzar.draft.${key}`,
  load(key) {
    try {
      const d = JSON.parse(sessionStorage.getItem(this.name(key)) || 'null');
      const list = d && d.v === 2 && Array.isArray(d.a) ? d.a : [];
      return list.filter((a) => a && (a.wipe || (Array.isArray(a.pts) && a.pts.length)));
    } catch (e) {
      return [];
    }
  },
  save(key, actions) {
    try { sessionStorage.setItem(this.name(key), JSON.stringify({ v: 2, a: actions })); } catch (e) { /* too large to keep; drawing still works */ }
  },
  drop(key) {
    try { sessionStorage.removeItem(this.name(key)); } catch (e) { /* nothing kept */ }
  },
};

const pad = {
  canvas: null, ctx: null, actions: [], colour: 0, live: null, dpr: 1, draftKey: '', w: 0, h: 0, pointerAt: 0, penSaid: false,
  m: { s: 1, ox: 0, oy: 0 },
  pen: { on: false, down: false, x: 100, y: 100, lastKey: '', lastAt: 0, step: 8 },

  start(key) {
    this.canvas = $('#pad');
    if (!this.canvas) return;
    this.draftKey = key;
    this.ctx = this.canvas.getContext('2d');
    this.actions = draft.load(key);
    this.live = null;
    this.pen.on = false;
    this.pen.down = false;
    this.fit();
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', () => this.up());
    c.addEventListener('pointercancel', () => this.up());
    c.addEventListener('keydown', (e) => this.keyPen(e));
    c.addEventListener('blur', () => this.penOff());
    this.changed(false);
    this.showPen();
  },

  setColour(i) {
    this.colour = i;
    screenEl.querySelectorAll('.swatch').forEach((sw) => {
      const on = Number(sw.dataset.i) === i;
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-pressed', on);
    });
    const cb = $('.colourbtn');
    if (cb) cb.style.setProperty('--c', PAD_COLOURS[i].css);
    this.showPen();
  },

  // After any change: Done waits (still readable, and a tap explains) until there is something to keep, the hint
  // goes once there is a line, and the draft is kept.
  changed(keep = true) {
    const shown = this.visible().length;
    const d = $('[data-act="savedrawing"]');
    if (d) {
      d.classList.toggle('waiting', shown === 0);
      d.setAttribute('aria-disabled', shown === 0);
    }
    const box = $('#canvasbox');
    if (box) box.classList.toggle('empty', shown === 0);
    if (keep) draft.save(this.draftKey, this.actions);
  },

  // The square of picture units sits inside #space (the drawing area clear of the hint band).
  fit() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.w = r.width;
    this.h = r.height;
    const b = ($('#space') || this.canvas).getBoundingClientRect();
    const sc = Math.min(b.width, b.height) / SPACE.size || 1;
    this.m = { s: sc, ox: b.left - r.left + (b.width - SPACE.size * sc) / 2, oy: b.top - r.top + (b.height - SPACE.size * sc) / 2 };
    this.redraw();
  },

  toPx([u, v]) { return [this.m.ox + (u - SPACE.min) * this.m.s, this.m.oy + (v - SPACE.min) * this.m.s]; },

  css(i) {
    const c = PAD_COLOURS[i].css;
    return c.startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#fff' : c;
  },

  point(e) {
    const r = this.canvas.getBoundingClientRect();
    return [+((e.clientX - r.left - this.m.ox) / this.m.s + SPACE.min).toFixed(2), +((e.clientY - r.top - this.m.oy) / this.m.s + SPACE.min).toFixed(2)];
  },

  // The canvas's edges in picture units, for the arrow pen.
  bounds() {
    const { s: sc, ox, oy } = this.m;
    return { x0: -ox / sc + SPACE.min, x1: (this.w - ox) / sc + SPACE.min, y0: -oy / sc + SPACE.min, y1: (this.h - oy) / sc + SPACE.min };
  },

  down(e) {
    e.preventDefault();
    this.pointerAt = Date.now();
    if (this.pen.on) this.penOff();
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
    this.live = { c: this.colour, pts: [this.point(e)] };
    this.actions.push(this.live);
    this.redraw();
    this.changed(false);
  },

  move(e) {
    if (!this.live || this.pen.down) return;
    this.pointerAt = Date.now();
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const events = list.length ? list : [e];
    events.forEach((ev) => this.live.pts.push(this.point(ev)));
    this.stroke(this.live, events.length);
  },

  up() {
    if (!this.live || this.pen.down) return;
    this.pointerAt = Date.now();
    this.live = null;
    buzz('stroke');
    this.changed();
  },

  // Drawing with swipes (the glasses' fallback, and any keyboard): a pinch (Enter) shows the pen, the next pinch
  // puts it down, swipes draw, and a pinch lifts it and puts it away. With the pen shown but up, swiping past an
  // edge leaves the canvas. Without the pen, swipes move between buttons as usual, so the canvas never traps them.
  keyPen(e) {
    const p = this.pen;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (Date.now() - this.pointerAt < 400) return; // the same pinch already drew a line
      if (!p.on) {
        p.on = true;
        this.penAgain = false;
        const b = this.bounds();
        p.x = Math.min(Math.max(p.x, b.x0), b.x1);
        p.y = Math.min(Math.max(p.y, b.y0), b.y1);
        if (!this.penSaid) { this.penSaid = true; speech.say(t('penUp')); }
      } else if (!p.down) {
        p.down = true;
        this.live = { c: this.colour, pts: [[+p.x.toFixed(2), +p.y.toFixed(2)]] };
        this.actions.push(this.live);
        this.redraw();
        this.changed(false);
      } else {
        this.liftPen();
        p.on = false;
        this.penAgain = true;
        if (!this.againSaid) { this.againSaid = true; speech.say(t('penAgain')); }
      }
      this.showPen();
      return;
    }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d || !p.on) return;
    e.preventDefault();
    const b = this.bounds();
    const atEdge = (d[0] < 0 && p.x <= b.x0 + 0.01) || (d[0] > 0 && p.x >= b.x1 - 0.01) || (d[1] < 0 && p.y <= b.y0 + 0.01) || (d[1] > 0 && p.y >= b.y1 - 0.01);
    if (atEdge && !p.down) {
      this.penOff();
      leaveCanvas(e.key);
      return;
    }
    const now = Date.now();
    const base = 0.035 * SPACE.size;
    p.step = p.lastKey === e.key && now - p.lastAt < 400 ? Math.min(base * 2.9, p.step * 1.35) : base;
    p.lastKey = e.key;
    p.lastAt = now;
    p.x = Math.min(b.x1, Math.max(b.x0, p.x + d[0] * p.step));
    p.y = Math.min(b.y1, Math.max(b.y0, p.y + d[1] * p.step));
    if (p.down && this.live) {
      this.live.pts.push([+p.x.toFixed(2), +p.y.toFixed(2)]);
      this.stroke(this.live, 1);
    }
    this.showPen();
  },

  liftPen() {
    if (!this.pen.down) return;
    this.pen.down = false;
    this.live = null;
    buzz('stroke');
    this.changed();
  },

  penOff() {
    this.liftPen();
    this.pen.on = false;
    this.penAgain = false;
    this.showPen();
  },

  showPen() {
    const box = $('#canvasbox');
    const cur = $('#pencursor');
    if (!box || !cur || !this.canvas) return;
    const p = this.pen;
    box.classList.toggle('keypen', p.on);
    cur.classList.toggle('down', p.down);
    const [x, y] = this.toPx([p.x, p.y]);
    cur.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    cur.style.setProperty('--c', this.css(this.colour));
    const cap = $('#pencap');
    if (cap) cap.textContent = p.on ? t(p.down ? 'penDown' : 'penUp') : this.penAgain ? t('penAgain') : '';
    box.classList.toggle('keycap', !!(cap && cap.textContent)); // the caption keeps its band
  },

  width() { return Math.max(8, 4.9 * this.m.s); },

  // added = how many points arrived since the last paint (0 = the whole stroke)
  stroke(st, added = 0) {
    const ctx = this.ctx;
    const pts = st.pts;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.strokeStyle = this.css(st.c);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = this.width();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      const [x, y] = this.toPx(pts[0]);
      ctx.beginPath();
      ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const from = added ? Math.max(0, pts.length - added - 2) : 0;
      ctx.beginPath();
      let [x0, y0] = this.toPx(pts[from]);
      ctx.moveTo(x0, y0);
      for (let i = from + 1; i < pts.length; i += 1) {
        const [x1, y1] = this.toPx(pts[i]);
        ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        [x0, y0] = [x1, y1];
      }
      ctx.lineTo(x0, y0);
      ctx.stroke();
    }
    ctx.restore();
  },

  visible() {
    let shown = [];
    for (const a of this.actions) {
      if (a.wipe) shown = [];
      else shown.push(a);
    }
    return shown;
  },

  redraw() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.visible().forEach((st) => this.stroke(st, 0));
  },

  undo() {
    this.liftPen();
    this.actions.pop();
    this.redraw();
    this.changed();
  },

  // Clear can be undone: it is a marker in the list, not a loss.
  wipe() {
    this.liftPen();
    if (this.actions.length && !this.actions[this.actions.length - 1].wipe) this.actions.push({ wipe: true });
    this.redraw();
    this.changed();
  },

  // The drawing as lines, cropped to what was drawn (with a margin, in the frames' 4:3 shape) and scaled to
  // 1000 units across, so a small drawing still fills its frame.
  vectorSnapshot() {
    const shown = this.visible();
    const px = shown.map((st) => st.pts.map((pt) => this.toPx(pt)));
    const pts = px.flat();
    const W = this.w;
    const H = this.h;
    let [sx, sy, sw, sh] = [0, 0, W, H];
    if (pts.length) {
      const margin = this.width() + Math.max(W, H) * 0.05;
      const x0 = Math.max(0, Math.min(...pts.map((q) => q[0])) - margin);
      const y0 = Math.max(0, Math.min(...pts.map((q) => q[1])) - margin);
      const x1 = Math.min(W, Math.max(...pts.map((q) => q[0])) + margin);
      const y1 = Math.min(H, Math.max(...pts.map((q) => q[1])) + margin);
      sw = Math.min(W, Math.max(x1 - x0, (y1 - y0) * (4 / 3)));
      sh = Math.min(H, Math.max(y1 - y0, sw * (3 / 4)));
      sx = Math.min(Math.max(0, (x0 + x1) / 2 - sw / 2), W - sw);
      sy = Math.min(Math.max(0, (y0 + y1) / 2 - sh / 2), H - sh);
    }
    const k = 1000 / sw;
    return {
      v: 1,
      w: 1000,
      h: Math.round(sh * k),
      lw: Math.round(this.width() * k),
      s: shown.map((st, i) => [st.c, px[i].flatMap(([x, y]) => [Math.round((x - sx) * k), Math.round((y - sy) * k)])]),
    };
  },
};

// With the pen up, swiping past the bottom edge goes to the nearest button below, past the top edge to the
// buttons above; past the sides the pen just goes away and the next swipe moves as usual.
function leaveCanvas(key) {
  const c = $('#pad');
  if (!c) return;
  const sel = key === 'ArrowDown' ? '.drawbar button' : key === 'ArrowUp' ? '.drawtop button, .tipbox' : '';
  if (!sel) return;
  const r = c.getBoundingClientRect();
  const x = r.left + pad.toPx([pad.pen.x, pad.pen.y])[0];
  const list = [...screenEl.querySelectorAll(sel)].filter((b) => b.offsetParent !== null && !b.disabled);
  if (!list.length) return;
  const mid = (b) => { const q = b.getBoundingClientRect(); return Math.abs(q.left + q.width / 2 - x); };
  list.sort((p, q) => mid(p) - mid(q));
  list[0].focus();
}

// ---- the drawing page (draw.html) ---------------------------------------------------------------------------
// Drawing is the activity: the canvas opens straight away, with the picture beside it and its outline under her
// lines to trace or ignore. Steps appear only on request ("Show me how"), one at a time; on the glasses the first
// press shows the whole picture. Done is one press, and the done screen can take it back. Paper is the other way to
// draw, with a photo at the end.
const drawState = { id: 'free', tip: 0, paper: false, look: false };

function drawPageHtml() {
  const { id, tip, paper, look } = drawState;
  const a = ACTIVITIES[id];
  const glasses = isGlasses();
  const name = a ? L(a.name) : t('free');
  const total = a ? a.steps.length : 0;
  const helping = tip > 0 || look;
  const tipLabel = !helping ? t(glasses ? 'stepsShort' : 'showHow') : tip < total ? t('nextStep') : t('hideSteps');
  // The glasses bar shows the short Next and Hide, so Done keeps its row; the voice still says the whole label.
  const tipShown = glasses && helping ? t(tip < total ? 'nextShort' : 'hideShort') : tipLabel;
  const tipsBtn = a ? `<button class="pill tips" data-act="tips" data-say="${esc(tipLabel)}">${esc(tipShown)}</button>` : '';
  const modeBtn = a ? `<button class="pill mode" data-act="mode">${pic(paper ? 'paintbrush' : 'page_facing_up')}<span class="long">${esc(paper ? t('onScreenBtn') : t('onPaperBtn'))}</span><span class="short">${esc(paper ? t('screenShort') : t('paperShort'))}</span></button>` : '';
  let tipBox = '';
  if (a && helping) {
    const lines = look ? [['say', t('wholePicture')]] : [['tipof', t('stepOf', { n: tip, t: total })], ['say', L(a.steps[tip - 1])]];
    tipBox = glasses
      // On the glasses the step line itself puts the steps away: one pinch on it. It reads the step when the focus
      // lands on it, and Hide shares the count's line so the sentence has the whole width.
      ? `<button class="tipbox" data-act="tipHide" data-say="${esc(`${drawSay()} ${t('hideSteps')}`)}"><span class="tiprow">${look ? `<span class="say">${esc(lines[0][1])}</span>` : `<span class="tipof">${esc(lines[0][1])}</span>`}<span class="tiphide">${esc(t('hideShort'))}</span></span>${look ? '' : `<span class="say">${esc(lines[1][1])}</span>`}</button>`
      // On a touch screen the step's words come first, across the box; the count sits with the buttons under them.
      : `<div class="tipbox"><p class="say">${esc(lines[lines.length - 1][1])}</p><div class="tipnav">${look ? '' : `<p class="tipof">${esc(lines[0][1])}</p>`}${readBtn(true)}<div class="tipbtns">
          <button class="pill" data-act="tipPrev"${tip <= 1 ? ' disabled' : ''} aria-label="${esc(t('prevStep'))}"><span class="arrow back" aria-hidden="true"></span></button>
          ${tip < total ? `<button class="pill" data-act="tips" aria-label="${esc(t('nextStep'))}"><span class="long">${esc(t('nextStep'))}</span><span class="short">${esc(t('nextShort'))}</span><span class="arrow" aria-hidden="true"></span></button>` : ''}
          <button class="pill" data-act="tipHide"><span class="long">${esc(t('hideSteps'))}</span><span class="short">${esc(t('hideShort'))}</span></button>
        </div></div></div>`;
  }
  const swatches = (where) => `<div class="swatches ${where}">${PAD_COLOURS.map((c, i) => `<button class="swatch${i === pad.colour ? ' on' : ''}" data-act="colour" data-i="${i}" style="--c:${c.css}" aria-label="${esc(L(c))}" aria-pressed="${i === pad.colour}"></button>`).join('')}</div>`;
  // Beside the canvas on a wide screen, above it on a tall one: the picture (with the step's part lit while a step
  // shows), the colours, Show me how while the steps are closed and, on a phone, the paper / screen choice.
  const side = glasses ? '' : `<div class="drawside">${a ? `<span class="artbox target">${art(id, tip)}</span>` : ''}${paper ? '' : swatches('inside')}<div class="sidebtns">${helping ? '' : tipsBtn}${modeBtn}</div></div>`;
  const hint = glasses ? t('drawHintGlasses') : a && settings.guide ? t('traceHint') : a ? t('drawHint') : t('freeHint');
  const surface = paper
    ? `<span class="artbox paperart">${art(id, tip)}</span><p class="paperneed">${pics(['page_facing_up', 'crayon'])}<span>${esc(t('paperNeed'))}</span></p>`
    : `<div class="space" id="space" aria-hidden="true">${look ? `<span class="artbox lookart">${art(id, 0)}</span>` : a && settings.guide ? guideSvg(id, tip) : a && tip ? guideSvg(id, tip, true) : ''}</div>
       <canvas id="pad" tabindex="0" aria-label="${esc(name)}" data-say="${esc(`${name}. ${hint}`)}"></canvas>
       <span class="pencursor" id="pencursor" aria-hidden="true"></span><p class="pencap" id="pencap" aria-live="polite"></p>
       <p class="emptyhint" id="emptyhint">${esc(hint)}</p>`;
  const colours = glasses
    ? `<button class="pill colourbtn" data-act="colourNext" data-say="${esc(t('colour'))}" aria-label="${esc(t('colour'))}" style="--c:${PAD_COLOURS[pad.colour].css}"><span class="cdot" aria-hidden="true"></span><span class="clbl">${esc(t('colour'))}</span></button>`
    : swatches('inbar');
  const barTips = glasses || !helping ? tipsBtn : '';
  const tools = paper
    ? `${barTips}${homeBtn(false)}<button class="pill touch-only" data-act="photo" data-id="${id}">${pic('camera_with_flash')}<span>${esc(t('takePhoto'))}</span></button>`
    : `${colours}<button class="pill" data-act="undo">${esc(t('undo'))}</button><button class="pill" data-act="wipe">${esc(t('again'))}</button>${barTips}${homeBtn(false)}`;
  // Done is drawn already waiting when there is nothing to keep, so it never fades from gold as the page redraws.
  const kept = paper ? [] : draft.load(id);
  const waiting = !paper && kept.length - 1 === kept.map((x) => !!x.wipe).lastIndexOf(true);
  const done = `<button class="primary big${waiting ? ' waiting' : ''}"${waiting ? ' aria-disabled="true"' : ''} data-act="${paper ? 'paperdone' : 'savedrawing'}" data-id="${esc(a ? id : 'free')}">${esc(t('done'))}<span class="check" aria-hidden="true"></span></button>`;
  return `<header class="top drawtop${helping ? ' stepping' : ''}">
      <div class="titles">${a ? `<span class="artbox lead">${art(id, 0)}</span>` : ''}<div><h1 tabindex="-1">${esc(name)}</h1></div></div>
      <div class="tools">${modeBtn}${readBtn(true)}</div>
    </header>
    <div class="drawmain${paper ? ' paper' : ''}${a ? '' : ' free'}${helping ? ' tipping' : ''}">
      ${side}
      ${tipBox}
      <div class="canvasbox${look ? ' look' : ''}" id="canvasbox">${surface}${settings.dragCheck ? '<p class="dragcheck" id="dragcheck"></p>' : ''}</div>
    </div>
    <div class="bar drawbar">${tools}${done}</div>`;
}

function drawSay() {
  const { id, tip, paper, look } = drawState;
  const a = ACTIVITIES[id];
  if (a && look) return t('wholePicture');
  if (a && tip) return `${t('stepSay', { n: tip })} ${L(a.steps[tip - 1])}`;
  const name = a ? L(a.name) : t('free');
  if (paper) return `${name}. ${t('paperNeed')}`;
  return `${name}. ${isGlasses() ? t('drawHintGlasses') : a && settings.guide ? t('traceHint') : a ? t('drawHint') : t('freeHint')}`;
}

function renderDraw({ focus = '', say = false } = {}) {
  applyLook();
  lastCanVoice = canVoice();
  speech.stop();
  clearTimeout(focusTimer); // a pending "what the focus is on" belongs to the page being replaced
  pad.canvas = null;
  screenEl.innerHTML = drawPageHtml();
  screenEl.dataset.screen = 'draw';
  document.title = `${drawState.id === 'free' ? t('free') : L(ACTIVITIES[drawState.id].name)} · ${t('appName')}`;
  current = { say: drawSay() };
  if (!drawState.paper) pad.start(drawState.id);
  drag.area = $('#canvasbox');
  dragShow();
  if (isGlasses() || lastInput === 'key') {
    const shown = (sel) => [...screenEl.querySelectorAll(sel)].find((el) => el.offsetParent !== null && !el.disabled && getComputedStyle(el).visibility !== 'hidden');
    const f = (focus && shown(focus)) || shown('#pad') || shown('.drawbar .primary');
    if (f) {
      // The page speaks its own line just below; the focus voice would cut it off half a second in.
      skipFocusSpeech = !!(say && settings.autoRead);
      f.focus({ preventScroll: true });
      skipFocusSpeech = false;
    }
  }
  if (say && settings.autoRead) speech.say(current.say);
}

function startDrawPage() {
  const q = new URLSearchParams(location.search);
  const id = q.get('a');
  drawState.id = ACTIVITIES[id] && ACTIVITIES[id].kind === 'draw' ? id : 'free';
  drawState.paper = q.get('paper') === '1' && drawState.id !== 'free';
  const depth = Math.min(Math.max(parseInt(q.get('d'), 10) || 0, 0), 4);
  history.replaceState({ route: 'draw', depth }, '');
  renderDraw();
  // The page's own line is spoken once, at the first touch or swipe (browsers speak only after one).
  const intro = (e) => {
    removeEventListener('pointerdown', intro, true);
    removeEventListener('keydown', intro, true);
    if (!settings.autoRead) return;
    if (e.type === 'keydown') {
      skipFocusSpeech = true; // the swipe's own focus move stays quiet for the page's line
      setTimeout(() => { skipFocusSpeech = false; }, 0);
    }
    const at = Date.now();
    setTimeout(() => { if (!(speech.lastSaidAt >= at)) speech.say(current.say); }, 30);
  };
  addEventListener('pointerdown', intro, true);
  addEventListener('keydown', intro, true);
}

// ---- a photo of a drawing made on paper (touch screens with a camera) -------------------------------------
function pickPhoto(id) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.setAttribute('capture', 'environment');
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      finishDrawing(id, await shrinkPhoto(file), { paper: true });
    } catch (e) {
      finishDrawing(id, '', { paper: true });
    }
  });
  input.click();
}

async function shrinkPhoto(file) {
  let src;
  try {
    src = await createImageBitmap(file);
  } catch (e) {
    src = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = URL.createObjectURL(file);
    });
  }
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  const scale = Math.min(1, 720 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  let url = c.toDataURL('image/webp', 0.8);
  if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', 0.8);
  return url;
}

// ---- moving between screens -------------------------------------------------------------------------------
// Each screen is one history entry, so the system Back gesture steps out a level. Steps inside an activity
// replace each other, the stack never goes more than four deep (the glasses keep five entries), and finishing
// something unwinds to Home first, so Back from the room goes home.
let current = { say: '' };
let pendingRoute = null;
let lastCanVoice = null;

let doneDraft = null; // the drawing just finished: kept until the done screen is left, so "Not finished yet" can give it back

function render(route, { fromUser = false } = {}) {
  const [name, ...args] = String(route || 'home').split(':');
  if (doneDraft && name !== 'done') { draft.drop(doneDraft); doneDraft = null; }
  // Entries from before drawing moved to draw.html may still be in history.
  if (name === 'canvas' || ((name === 'intro' || name === 'step') && ACTIVITIES[args[0]] && ACTIVITIES[args[0]].kind === 'draw')) {
    openDraw(name === 'canvas' ? args[0] || 'free' : args[0], { paper: name === 'step', replace: true });
    return;
  }
  speech.stop();
  if (!toastEl.hidden && Date.now() - (toast.at || 0) > 1200) toastEl.hidden = true;
  applyLook();
  lastCanVoice = canVoice();
  const view = (SCREENS[name] || SCREENS.home)(...args);
  screenEl.innerHTML = view.html;
  screenEl.dataset.screen = SCREENS[name] ? name : 'home';
  window.scrollTo(0, 0);
  current = view;
  if (view.after) view.after();
  if (view.focus && (isGlasses() || lastInput === 'key')) {
    const f = screenEl.querySelector(`${view.focus}:not([disabled])`) || screenEl.querySelector('h1');
    if (f) f.focus({ preventScroll: true });
  }
  if (fromUser && settings.autoRead) speech.say(view.say);
}

const currentRoute = () => (history.state && history.state.route) || 'home';

function go(route, { replace = false, fresh = false } = {}) {
  const depth = (history.state && history.state.depth) || 0;
  if (replace || depth >= 4) history.replaceState({ route, depth, fresh }, '');
  else history.pushState({ route, depth: depth + 1, fresh }, '');
  render(route, { fromUser: true });
}

function goHome() {
  const depth = (history.state && history.state.depth) || 0;
  if (depth > 0) {
    history.go(-depth); // unwinds to the real first entry; popstate draws Home
  } else {
    history.replaceState({ route: 'home', depth: 0 }, '');
    render('home', { fromUser: true });
  }
}

function resetTo(route) {
  const depth = (history.state && history.state.depth) || 0;
  if (depth === 0) {
    history.pushState({ route, depth: 1 }, '');
    render(route, { fromUser: true });
    return;
  }
  pendingRoute = route;
  history.go(-depth);
  setTimeout(() => {
    if (pendingRoute !== route) return; // popstate already handled it
    pendingRoute = null;
    history.pushState({ route, depth: ((history.state && history.state.depth) || 0) + 1 }, '');
    render(route, { fromUser: true });
  }, 800);
}

addEventListener('popstate', (e) => {
  if (DRAW_PAGE || takeNext()) return;
  if (pendingRoute) {
    const r = pendingRoute;
    pendingRoute = null;
    history.pushState({ route: r, depth: 1 }, '');
    render(r, { fromUser: true });
    return;
  }
  render((e.state && e.state.route) || 'home', { fromUser: true });
});

// ---- actions ----------------------------------------------------------------------------------------------
function addToRoom(item) {
  room.push({ ...item, at: new Date().toISOString() });
  save('gulzar.room', room);
}

function finish(id) {
  const a = ACTIVITIES[id];
  if (!a) return;
  addToRoom({ kind: a.kind, act: id });
  buzz('finish');
  resetTo(`done:${id}`);
}

// Drawing opens draw.html as the next history entry (in place of this one at the history limit). The depth
// travels in its address, so Home there unwinds to the first entry.
function openDraw(id, { paper = false, replace = false } = {}) {
  const depth = (history.state && history.state.depth) || 0;
  const push = !replace && depth < 4;
  const url = `draw.html?a=${encodeURIComponent(id)}&d=${push ? depth + 1 : depth}${paper ? '&paper=1' : ''}`;
  if (push) location.assign(url);
  else location.replace(url);
}

function reloadState() {
  settings = { ...DEFAULTS, ...sanitizeSettings(load('gulzar.settings', {})) };
  settings.show = { ...DEFAULTS.show, ...settings.show };
  settings.dragCheck = dragCheckOn();
  room = Array.isArray(load('gulzar.room', [])) ? load('gulzar.room', []) : [];
  day = load('gulzar.day', { date: '', done: [], planted: false });
}

// When a drawing is finished, draw.html leaves "gulzar.next" and goes back here. Unwind to the first entry,
// then show the done screen from there, as finishing anything else does.
function takeNext() {
  let next = null;
  try { next = sessionStorage.getItem('gulzar.next'); } catch (e) { return false; }
  if (!next) return false;
  const depth = (history.state && history.state.depth) || 0;
  if (depth > 0) {
    render('home');
    history.go(-depth);
    return true;
  }
  try { sessionStorage.removeItem('gulzar.next'); } catch (e) { /* shown once either way */ }
  reloadState();
  history.pushState({ route: next, depth: 1 }, '');
  render(next, { fromUser: true });
  return true;
}

// Done is one press, so the done screen can take it back: the keepsake leaves the room and the activity
// opens again where it ended (a drawing with every line still there).
function notDone() {
  const item = room[room.length - 1];
  if (!item) return;
  room.pop();
  save('gulzar.room', room);
  if (item.drawing) { try { localStorage.removeItem(item.drawing); } catch (e) { /* already gone */ } }
  if (item.kind === 'draw') {
    doneDraft = null;
    openDraw(item.act, { paper: !!item.paper, replace: true });
    return;
  }
  const a = ACTIVITIES[item.act];
  history.replaceState({ ...history.state, route: `step:${item.act}:${a ? a.steps.length : 1}` }, '');
  render(history.state.route, { fromUser: true });
}

// Coming back to this page from the drawing page (a cached page restored by Back): what the drawing page
// saved is read again before anything is shown.
addEventListener('pageshow', (e) => {
  if (DRAW_PAGE || !e.persisted) return;
  reloadState();
  speech.unlocked = !!(navigator.userActivation && navigator.userActivation.hasBeenActive);
  if (!takeNext()) render(currentRoute());
});

// A drawing from the pad (strokes) or a photo (a small picture) is kept with the room; a drawing on paper
// without a photo gets an honest stand-in (a page and a crayon), never the app's own example picture.
function finishDrawing(id, payload, { paper = false } = {}) {
  const act = ACTIVITIES[id] ? id : 'free';
  const item = { kind: 'draw', act };
  if (paper) item.paper = true;
  if (payload) {
    const key = `gulzar.drawing.${Date.now()}`;
    try {
      localStorage.setItem(key, typeof payload === 'string' ? payload : JSON.stringify(payload));
      item.drawing = key;
    } catch (e) {
      toast(t('savedNoPicture'));
    }
  }
  addToRoom(item);
  buzz('finish');
  if (!DRAW_PAGE) {
    resetTo(`done:${act}`);
    return;
  }
  // Back to the app page, which shows the done screen (takeNext).
  try { sessionStorage.setItem('gulzar.next', `done:${act}`); } catch (e) { /* the room has it either way */ }
  if (((history.state && history.state.depth) || 0) > 0) history.back();
  else location.replace('./');
}

addEventListener('pointerdown', () => { if (!toastEl.hidden && Date.now() - (toast.at || 0) > 300) toastEl.hidden = true; }, true);

function toast(msg, ms = 4000) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  toast.at = Date.now();
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

function clearRoom() {
  save('gulzar.room.backup', room.concat(load('gulzar.room.backup', []) || []));
  room = [];
  save('gulzar.room', room);
  toast(t('cleared'));
  render('helper');
}

function restoreRoom() {
  const backup = load('gulzar.room.backup', []) || [];
  room = backup.concat(room).sort((x, y) => String(x.at).localeCompare(String(y.at)));
  save('gulzar.room', room);
  try { localStorage.removeItem('gulzar.room.backup'); } catch (e) { /* nothing to remove */ }
  toast(t('restored'));
  render('helper');
}

// Helper-only actions need a deliberate hand: hold the button (gear 2 s, clear 3 s), or on the glasses
// (no touch screen) press it five times within four seconds. A single tap only explains this.
const HOLDS = { gear: 2000, clear: 3000 };
const holdState = { el: null, timer: 0, presses: {}, ignoreClicksUntil: 0 };

function holdDone(kind) {
  holdState.ignoreClicksUntil = Date.now() + 450;
  holdState.presses = {};
  toastEl.hidden = true;
  if (kind === 'gear') go('helper');
  else if (kind === 'clear') clearRoom();
}

screenEl.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-hold]');
  if (!el) return;
  const kind = el.dataset.hold;
  el.style.setProperty('--hold', `${HOLDS[kind]}ms`);
  el.classList.add('holding');
  clearTimeout(holdState.timer);
  holdState.el = el;
  holdState.timer = setTimeout(() => {
    el.classList.remove('holding');
    holdState.el = null;
    holdDone(kind);
  }, HOLDS[kind]);
  el.addEventListener('pointerleave', endHold, { once: true });
});

function endHold() {
  if (!holdState.el) return;
  clearTimeout(holdState.timer);
  holdState.el.classList.remove('holding');
  holdState.el = null;
}
addEventListener('pointerup', endHold, true);
addEventListener('pointercancel', endHold, true);

function pressedHold(el) {
  const kind = el.dataset.hold;
  if (lastInput !== 'key') {
    if (kind === 'gear') toast(t('gearTap'));
    return;
  }
  const now = Date.now();
  const list = (holdState.presses[kind] || []).filter((p) => now - p < 4000).concat(now);
  holdState.presses[kind] = list;
  if (list.length >= 5) holdDone(kind);
  else if (kind === 'gear') toast(t('gearTapKeys'));
}

screenEl.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-hold]') || e.target.closest('#pad')) e.preventDefault(); });

screenEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  if (Date.now() < holdState.ignoreClicksUntil) {
    e.preventDefault();
    return;
  }
  // On the glasses a pinch may arrive both as a drag on the canvas and as Enter on the focused button: one
  // gesture, one action.
  if (DRAW_PAGE && lastInput === 'key' && Date.now() - pad.pointerAt < 400) return;
  if (b.dataset.hold) {
    pressedHold(b);
    return;
  }
  const act = b.dataset.act;
  const [screen, id, n] = currentRoute().split(':');
  // Every press is acknowledged at once: a small spring, and on Android a short pulse.
  b.classList.remove('pressed');
  void b.offsetWidth;
  b.classList.add('pressed');
  setTimeout(() => b.classList.remove('pressed'), 300);
  if (!['finish', 'savedrawing', 'paperdone', 'photo'].includes(act)) buzz(['next', 'prev', 'tips', 'tipPrev'].includes(act) ? 'step' : 'press');

  switch (act) {
    case 'go':
      go(b.dataset.to, { replace: b.dataset.replace === '1', fresh: b.dataset.to === 'room' && screen === 'done' });
      break;
    case 'home':
      goHome();
      break;
    case 'read':
      speech.say(current.say, { force: true });
      break;
    case 'next':
    case 'prev': {
      const to = Math.max(1, (parseInt(n, 10) || 1) + (act === 'next' ? 1 : -1));
      history.replaceState({ ...history.state, route: `step:${id}:${to}` }, '');
      render(history.state.route, { fromUser: true });
      break;
    }
    case 'finish':
      finish(b.dataset.id);
      break;
    case 'paperdone':
      finishDrawing(b.dataset.id, '', { paper: true });
      break;
    case 'photo':
      pickPhoto(b.dataset.id);
      break;
    case 'tick': {
      const set = ticks[b.dataset.id] || (ticks[b.dataset.id] = new Set());
      const i = Number(b.dataset.i);
      if (set.has(i)) set.delete(i); else set.add(i);
      b.classList.toggle('got', set.has(i));
      b.setAttribute('aria-pressed', set.has(i));
      if (set.has(i)) speech.say(b.dataset.say);
      break;
    }
    case 'dayTick': {
      freshDay();
      const i = Number(b.dataset.i);
      const on = !day.done.includes(i);
      day.done = on ? day.done.concat(i) : day.done.filter((x) => x !== i);
      const items = dayList();
      const all = items.length > 0 && items.every((_, k) => day.done.includes(k));
      if (all && !day.planted) {
        day.planted = true;
        addToRoom({ kind: 'day', act: 'day', n: room.filter((r) => r.kind === 'day').length });
      }
      save('gulzar.day', day);
      if (all) {
        render('day');
        speech.say(`${t('dayFinished')} ${t('plantNew')}`);
        const r = screenEl.querySelector(`.dayrow[data-i="${i}"]`);
        if (r && (isGlasses() || lastInput === 'key')) r.focus();
      } else {
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on);
        const hint = screenEl.querySelector('.dayhint');
        if (hint) { hint.innerHTML = `${esc(t('dayHint'))} <span class="grow">${esc(t('dayGrow'))}</span>`; hint.classList.remove('cheer'); }
        const stage = screenEl.querySelector('.dayhead .stage');
        if (stage) stage.src = IMG(dayStage(items));
        const bar = screenEl.querySelector('.bar .primary');
        if (bar) bar.remove();
        if (on) speech.say(b.dataset.say);
      }
      break;
    }
    case 'saything':
      speech.say(b.dataset.say, { force: true });
      break;
    case 'roomPage':
      history.replaceState({ ...history.state, route: `room:${b.dataset.p}`, fresh: false }, '');
      render(history.state.route, { fromUser: true });
      break;
    case 'draw':
      openDraw(b.dataset.id);
      break;
    case 'notDone':
      notDone();
      break;
    case 'colour':
      pad.setColour(Number(b.dataset.i));
      break;
    case 'colourNext':
      pad.setColour((pad.colour + 1) % PAD_COLOURS.length);
      speech.say(L(PAD_COLOURS[pad.colour]));
      break;
    case 'undo':
      pad.undo();
      break;
    case 'wipe':
      pad.wipe();
      break;
    case 'tips': {
      const total = ACTIVITIES[drawState.id].steps.length;
      if (isGlasses() && !drawState.tip && !drawState.look && !drawState.paper) {
        drawState.look = true; // on the glasses: the whole picture first, big
      } else if (drawState.look) {
        drawState.look = false;
        drawState.tip = 1;
      } else {
        drawState.tip = drawState.tip >= total ? 0 : drawState.tip + 1;
      }
      const showing = drawState.look || drawState.tip > 0;
      // On the glasses focus goes back to the canvas once a step shows, so the next pinch or drag draws.
      const focus = isGlasses() && drawState.tip > 0 && !drawState.paper ? '#pad' : '[data-act="tips"]';
      renderDraw({ focus, say: showing });
      break;
    }
    case 'tipPrev':
      drawState.tip = Math.max(1, drawState.tip - 1);
      renderDraw({ focus: drawState.tip > 1 ? '[data-act="tipPrev"]' : '[data-act="tips"]', say: true });
      break;
    case 'tipHide':
      drawState.tip = 0;
      drawState.look = false;
      renderDraw({ focus: isGlasses() && !drawState.paper ? '#pad' : '[data-act="tips"]' });
      break;
    case 'mode':
      drawState.paper = !drawState.paper;
      drawState.look = false;
      renderDraw({ focus: '[data-act="mode"]', say: true });
      break;
    case 'savedrawing':
      if (b.classList.contains('waiting')) {
        buzz('press');
        toast(t('drawFirst'));
        speech.say(t('drawFirst'), { force: true });
        break;
      }
      finishDrawing(b.dataset.id, pad.vectorSnapshot());
      break;
    case 'set': {
      const key = b.dataset.key;
      let value = b.dataset.value;
      if (value === 'true' || value === 'false') value = value === 'true';
      settings[key] = value;
      saveSettings();
      render('helper');
      const again = screenEl.querySelector(`[data-key="${key}"].on`);
      if (again && (isGlasses() || lastInput === 'key')) again.focus();
      if (key === 'lang' || key === 'rate' || key === 'voice') speech.say(t('helperTitle'), { force: true });
      break;
    }
    case 'show': {
      const key = b.dataset.key;
      settings.show[key] = !settings.show[key];
      saveSettings();
      b.classList.toggle('on', settings.show[key]);
      b.setAttribute('aria-pressed', settings.show[key]);
      refreshLink();
      break;
    }
    case 'toggleAct': {
      const actId = b.dataset.id;
      settings.hide = settings.hide.includes(actId) ? settings.hide.filter((x) => x !== actId) : settings.hide.concat(actId);
      saveSettings();
      const on = !settings.hide.includes(actId);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
      refreshLink();
      break;
    }
    case 'dayStarter':
      settings.dayItems = null;
      saveSettings();
      render('helper');
      break;
    case 'copyLink':
      if (navigator.clipboard) navigator.clipboard.writeText(glassesLink()).then(() => toast(t('copied')), () => {});
      break;
    case 'restoreRoom':
      restoreRoom();
      break;
    default:
      break;
  }
});

// On the glasses, say what the focus lands on (after a short pause, so a quick swipe past is quiet).
let focusTimer = 0;
let skipFocusSpeech = false; // the drawing page's own line is being spoken
screenEl.addEventListener('focusin', (e) => {
  if (!isGlasses() || !settings.autoRead || lastInput !== 'key') return;
  if (skipFocusSpeech) {
    skipFocusSpeech = false;
    return;
  }
  const el = e.target.closest('[data-say]');
  clearTimeout(focusTimer);
  if (el) focusTimer = setTimeout(() => speech.say(el.dataset.say), 450);
});

addEventListener('resize', () => {
  const lookChanged = document.documentElement.classList.contains('mode-glasses') !== isGlasses();
  if (DRAW_PAGE) {
    if (lookChanged) renderDraw();
    else if (pad.canvas) { pad.fit(); pad.showPen(); }
  } else if (lookChanged) {
    render(currentRoute());
  }
});

// ---- start --------------------------------------------------------------------------------------------------
if (DRAW_PAGE) {
  startDrawPage();
} else {
  importFromLink();
  if (!history.state || !history.state.route) history.replaceState({ route: 'home', depth: 0 }, '');
  if (!takeNext()) render(history.state.route);
}
wake();

// Voices can arrive after the first screen. Redraw only if that changes whether there is a voice to offer.
if (speech.ok) {
  const onVoices = () => {
    const screen = screenEl.dataset.screen;
    if (screen === 'helper') {
      const v = $('.voicestate');
      if (v) v.textContent = `${t('voiceStatus')}: ${speech.voiceFor('ur') ? t('voiceOk') : t('voiceNoUrdu')}`;
    } else if (canVoice() !== lastCanVoice) {
      if (screen === 'draw') renderDraw();
      else render(currentRoute());
    }
  };
  if (typeof speechSynthesis.addEventListener === 'function') speechSynthesis.addEventListener('voiceschanged', onVoices);
  else if ('onvoiceschanged' in speechSynthesis) speechSynthesis.onvoiceschanged = onVoices;
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
