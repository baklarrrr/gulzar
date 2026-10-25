'use strict';

// Gulzar: cook, make and draw one step at a time, with big pictures and a voice, and a room that fills up
// with keepsakes as things get finished. Runs on a tablet or phone (touch) and on Meta Ray-Ban Display
// (600x600: swipes move focus between buttons, a pinch presses, Back is the system gesture).
// Everything is kept on the device in localStorage. Nothing is sent anywhere.

const $ = (sel, root = document) => root.querySelector(sel);
const screenEl = document.getElementById('screen');
const toastEl = document.getElementById('toast');
const IMG = (name) => `img/${name}.webp`;

// ---- saved state ------------------------------------------------------------------------------------------
const DEFAULTS = {
  name: '', helperName: '', lang: 'en', greet: 'time', voice: true, autoRead: true, rate: 'normal', size: 'large',
  theme: 'dark', show: { cook: true, make: true, draw: true, day: true }, hide: [], dayItems: null,
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
let room = Array.isArray(load('gulzar.room', [])) ? load('gulzar.room', []) : [];
let day = load('gulzar.day', { date: '', done: [], planted: false });

function saveSettings() { save('gulzar.settings', settings); }

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
    return true;
  },

  stop() {
    if (this.ok) speechSynthesis.cancel();
    document.documentElement.classList.remove('speaking');
  },
};

// With no voice for the chosen language there is no Read button at all, rather than one that does nothing.
const canVoice = () => settings.voice && speech.canSpeak(settings.lang);

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
    colour: `<path d="M100 105 C96 132 104 156 100 192" stroke="#3FB560"/><g fill="#8EE59B" stroke="#3FB560">${LEAVES}</g><g fill="#FF8FB6" stroke="#FF5A93">${PETALS}</g><circle cx="100" cy="72" r="13" fill="#FFD84D" stroke="#F0A800"/>`,
  },
  house: {
    parts: ['<rect x="48" y="92" width="104" height="88"/>', '<path d="M38 94 L100 40 L162 94 Z"/>', DOOR, WINDOWS],
    colour: `<rect x="48" y="92" width="104" height="88" fill="#FFD9A8" stroke="#E8A050"/><path d="M38 94 L100 40 L162 94 Z" fill="#FF7A6B" stroke="#E0503F"/><g fill="#C08850" stroke="#8A5A2B">${DOOR}</g><g fill="#9FD8FF" stroke="#4DA8FF">${WINDOWS}</g><g fill="#FF8FB6" stroke="#3FB560">${HOUSE_FLOWERS}</g>`,
  },
  mehndi: {
    parts: ['<circle class="dot" cx="100" cy="100" r="5"/>', '<circle cx="100" cy="100" r="16"/>', SMALL_PETALS, BIG_PETALS, TIP_DOTS],
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
    for (let i = 2; i < pts.length; i += 2) path += `L${pts[i]} ${pts[i + 1]}`;
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
    <rect class="wall" x="0" y="0" width="1000" height="452"/>
    <rect class="floor" x="0" y="452" width="1000" height="188"/>
    <path class="boards" d="M0 512 H1000 M0 578 H1000"/>
    <line class="skirting" x1="0" y1="452" x2="1000" y2="452"/>
    <rect class="window" x="690" y="56" width="250" height="236" rx="10"/>
    <path class="mullion" d="M815 56 V292 M690 174 H940"/>
    <image class="decor" href="${IMG(sky === 'night' ? 'crescent_moon' : 'sun')}" x="722" y="80" width="78" height="78"/>
    <rect class="sill" x="672" y="292" width="286" height="16" rx="6"/>
    <rect class="shelf" x="58" y="330" width="524" height="16" rx="6"/>
    <path class="bracket" d="M110 346 V372 M530 346 V372"/>
    <ellipse class="rug" cx="300" cy="604" rx="250" ry="30"/>
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
      const meta = kind === 'draw' ? t('nSteps', { n: a.steps.length })
        : `${t('nSteps', { n: a.steps.length })}${helpers ? ` · ${helperText(t('withHelper', { h: helpers }))}` : ''}`;
      const picture = kind === 'draw' ? `<span class="artbox">${art(id, 0)}</span>` : pics(a.hero);
      return `<button class="card k-${kind}" data-act="go" data-to="intro:${id}" data-say="${esc(L(a.name))}">${picture}<span class="cardtext"><span class="name">${esc(L(a.name))}</span><span class="meta">${esc(meta)}</span></span></button>`;
    });
    if (kind === 'draw') {
      cards.push(`<button class="card k-draw touch-only" data-act="go" data-to="canvas:free" data-say="${esc(t('free'))}">${pics(['paintbrush'])}<span class="cardtext"><span class="name">${esc(t('free'))}</span><span class="meta">${esc(t('freeHint'))}</span></span></button>`);
    }
    const names = ids.map((id) => L(ACTIVITIES[id].name)).join(', ');
    return {
      html: `${topBar(t(`pick${kind}`), { img: TILE_IMG[kind] })}<div class="cards n${cards.length} k-${kind}">${cards.join('')}</div><div class="bar">${homeBtn()}</div>`,
      say: `${t(`pick${kind}`)} ${names}.`,
      focus: '.card',
    };
  },

  intro(id) {
    const a = ACTIVITIES[id];
    if (!a) return SCREENS.home();
    if (a.kind === 'draw' && !isGlasses()) {
      // On a touch screen she chooses first: paper (with an optional photo at the end) or the screen.
      const html = `${topBar(L(a.name), { sub: esc(t('nSteps', { n: a.steps.length })), lead: `<span class="artbox lead">${art(id, 0)}</span>` })}
        <h2 class="howdraw">${esc(t('howDraw'))}</h2>
        <div class="choices">
          <button class="choice" data-act="go" data-to="step:${id}:1" data-say="${esc(t('onPaperBtn'))}">${pics(['page_facing_up', 'crayon'])}<span>${esc(t('onPaperBtn'))}</span></button>
          <button class="choice" data-act="go" data-to="canvas:${id}:1" data-say="${esc(t('onScreenBtn'))}">${pics(['paintbrush'])}<span>${esc(t('onScreenBtn'))}</span></button>
        </div>
        <div class="bar">${homeBtn()}</div>`;
      return { html, say: `${L(a.name)}. ${t('howDraw')}`, focus: '.choice' };
    }
    const needs = a.kind === 'draw' ? DRAW_NEEDS : a.needs;
    const got = ticks[id] || (ticks[id] = new Set());
    const lead = a.kind === 'draw' ? `<span class="artbox lead">${art(id, 0)}</span>` : pics(a.hero, 'lead');
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
    const picture = a.kind === 'draw' ? `<span class="artbox big">${art(id, n)}</span>` : pics(stepPictures(st), 'step');
    const dots = Array.from({ length: total }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    let actions;
    if (last && a.kind === 'draw') {
      actions = `<button class="pill touch-only" data-act="photo" data-id="${id}">${pic('camera_with_flash')}<span>${esc(t('takePhoto'))}</span></button>
        <button class="primary big" data-act="paperdone" data-id="${id}">${esc(t('finish'))}<span class="check" aria-hidden="true"></span></button>`;
    } else {
      actions = `<button class="primary big" data-act="${last ? 'finish' : 'next'}" data-id="${id}">${esc(last ? t('finish') : t('next'))}<span class="${last ? 'check' : 'arrow'}" aria-hidden="true"></span></button>`;
    }
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
    const seen = item && item.kind === 'draw' && !!drawingOf(item);
    const praise = t(seen ? 'praiseSeen' : 'praiseDone');
    const line = Array.isArray(praise) ? praise[room.length % praise.length] : '';
    const madeText = a ? L(a.doneText) : L({ en: 'You made a drawing.', ur: 'آپ نے تصویر بنائی۔' });
    let hero;
    let keepText;
    let keepPic = '';
    if (item && item.kind === 'draw') {
      const d = drawingOf(item);
      hero = d && d.photo ? `<img class="drawn" src="${esc(d.photo)}" alt="">`
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
        <p class="praise">${esc(line)}</p>
        <p class="keeptext">${keepPic}<span>${esc(keepText)}</span></p>
      </div>
      <div class="bar">
        ${homeBtn()}
        ${readBtn(true)}
        <button class="primary big" data-act="go" data-to="room" data-replace="1">${pic('couch_and_lamp')}<span>${esc(t('seeRoom'))}</span></button>
      </div>`;
    return { html, say: `${madeText} ${line} ${keepText}`, focus: '.bar .primary' };
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

  canvas(id, nStr) {
    const a = ACTIVITIES[id] && ACTIVITIES[id].kind === 'draw' ? ACTIVITIES[id] : null;
    const n = a ? Math.min(Math.max(parseInt(nStr, 10) || 1, 1), a.steps.length) : 0;
    const html = `${a ? '' : `<p class="padhint">${esc(t('freeHint'))}</p>`}<div class="padarea${a ? '' : ' free'}">
        ${a ? `<div class="padguide" id="padguide">${guideHtml(id, n)}</div>` : ''}
        <div class="padwrap"><canvas id="pad" aria-label="${esc(a ? L(a.name) : t('free'))}"></canvas></div>
      </div>
      <div class="palette">
        <div class="swatches">${PAD_COLOURS.map((c, i) => `<button class="swatch${i === 0 ? ' on' : ''}" data-act="colour" data-i="${i}" style="--c:${c.css}" aria-label="${esc(L(c))}" aria-pressed="${i === 0}"></button>`).join('')}</div>
        <div class="padtools">
          <button class="pill" data-act="undo">${esc(t('undo'))}</button>
          <button class="pill" data-act="wipe">${esc(t('again'))}</button>
          ${homeBtn(false)}
          <button class="primary big" data-act="savedrawing" data-id="${esc(a ? id : 'free')}" disabled>${esc(t('done'))}<span class="check" aria-hidden="true"></span></button>
        </div>
      </div>`;
    const say = a ? `${L(a.name)}. ${t('stepSay', { n })} ${L(a.steps[n - 1])}` : t('freeHint');
    return { html, say, focus: '.swatch', after: () => pad.start(a ? id : 'free') };
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

function guideHtml(id, n) {
  const a = ACTIVITIES[id];
  const total = a.steps.length;
  return `<div class="guidehead"><span class="artbox">${art(id, n)}</span><p class="sub">${esc(t('stepOf', { n, t: total }))}</p></div>
    <p class="say">${esc(L(a.steps[n - 1]))}</p>
    <div class="padsteps">
      <button class="pill" data-act="padstep" data-n="${n - 1}" ${n === 1 ? 'disabled' : ''} aria-label="${esc(t('prev'))}"><span class="arrow back" aria-hidden="true"></span></button>
      ${readBtn(true)}
      <button class="pill" data-act="padstep" data-n="${n + 1}" ${n === total ? 'disabled' : ''} aria-label="${esc(t('next'))}"><span>${esc(t('next'))}</span><span class="arrow" aria-hidden="true"></span></button>
    </div>`;
}

function glassesLink() {
  const base = `${location.origin}${location.pathname.replace(/index\.html$/, '')}`;
  const { name, helperName, lang, greet, voice, autoRead, rate, size, show, hide, dayItems } = settings;
  return `${base}#s=${encodeSettings({ name, helperName, lang, greet, voice, autoRead, rate, size, show, hide, dayItems })}`;
}

const deepLink = () => `fb-viewapp://web_app_deep_link?appName=Gulzar&appUrl=${encodeURIComponent(glassesLink())}`;

function refreshLink() {
  const a = $('#addGlasses');
  if (a) a.href = deepLink();
}

// ---- drawing pad (touch screens only) ---------------------------------------------------------------------
const PAD_COLOURS = [
  { css: 'var(--ink)', en: 'Ink', ur: 'سیاہی' },
  { css: '#FF5A5A', en: 'Red', ur: 'لال' },
  { css: '#FFC830', en: 'Yellow', ur: 'پیلا' },
  { css: '#3FC46A', en: 'Green', ur: 'ہرا' },
  { css: '#3D9BFF', en: 'Blue', ur: 'نیلا' },
  { css: '#FF6FB0', en: 'Pink', ur: 'گلابی' },
];

const pad = {
  canvas: null, ctx: null, actions: [], colour: 0, live: null, dpr: 1, key: '', drafts: {},

  // A drawing in progress survives leaving the pad (Home, Back) until the app is closed.
  start(key) {
    this.canvas = $('#pad');
    if (!this.canvas) return;
    this.key = key;
    this.ctx = this.canvas.getContext('2d');
    this.actions = this.drafts[key] || [];
    this.drafts[key] = this.actions;
    this.colour = 0;
    this.fit();
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', () => this.up());
    c.addEventListener('pointercancel', () => this.up());
    c.addEventListener('pointerleave', () => this.up());
    this.updateDone();
  },

  forget(key) { delete this.drafts[key]; },

  updateDone() {
    const d = $('[data-act="savedrawing"]');
    if (d) d.disabled = this.visible().length === 0;
  },

  fit() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.w = r.width;
    this.h = r.height;
    this.redraw();
  },

  css(i) {
    const c = PAD_COLOURS[i].css;
    return c.startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#fff' : c;
  },

  point(e) {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  },

  down(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.live = { c: this.colour, pts: [this.point(e)] };
    this.actions.push(this.live);
    this.redraw();
    this.updateDone();
  },

  move(e) {
    if (!this.live) return;
    this.live.pts.push(this.point(e));
    this.stroke(this.live, true);
  },

  up() { this.live = null; },

  width() { return Math.max(8, Math.min(this.w, this.h) * 0.022); },

  stroke(s, tailOnly) {
    const ctx = this.ctx;
    const pts = s.pts;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.strokeStyle = this.css(s.c);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = this.width();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const P = ([x, y]) => [x * this.w, y * this.h];
    if (pts.length === 1) {
      const [x, y] = P(pts[0]);
      ctx.beginPath();
      ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const from = tailOnly ? Math.max(0, pts.length - 3) : 0;
      ctx.beginPath();
      let [x0, y0] = P(pts[from]);
      ctx.moveTo(x0, y0);
      for (let i = from + 1; i < pts.length; i += 1) {
        const [x1, y1] = P(pts[i]);
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
    this.visible().forEach((s) => this.stroke(s, false));
  },

  undo() {
    this.actions.pop();
    this.redraw();
    this.updateDone();
  },

  wipe() {
    if (this.actions.length && !this.actions[this.actions.length - 1].wipe) this.actions.push({ wipe: true });
    this.redraw();
    this.updateDone();
  },

  // The drawing as strokes, cropped to what was drawn (with a margin, in the frames' 4:3 shape) and scaled to
  // 1000 units across, so a small drawing still fills its frame.
  vectorSnapshot() {
    const shown = this.visible();
    const pts = shown.flatMap((st) => st.pts);
    const W = this.w;
    const H = this.h;
    let [sx, sy, sw, sh] = [0, 0, W, H];
    if (pts.length) {
      const margin = this.width() + Math.max(W, H) * 0.05;
      const x0 = Math.max(0, Math.min(...pts.map((q) => q[0])) * W - margin);
      const y0 = Math.max(0, Math.min(...pts.map((q) => q[1])) * H - margin);
      const x1 = Math.min(W, Math.max(...pts.map((q) => q[0])) * W + margin);
      const y1 = Math.min(H, Math.max(...pts.map((q) => q[1])) * H + margin);
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
      s: shown.map((st) => [st.c, st.pts.flatMap(([x, y]) => [Math.round((x * W - sx) * k), Math.round((y * H - sy) * k)])]),
    };
  },
};

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
      finishDrawing(id, await shrinkPhoto(file));
    } catch (e) {
      finishDrawing(id, '');
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

function render(route, { fromUser = false } = {}) {
  const [name, ...args] = String(route || 'home').split(':');
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
  resetTo(`done:${id}`);
}

// A drawing from the pad (strokes) or a photo (a small picture) is kept with the room; a drawing on paper
// without a photo gets an honest stand-in (a page and a crayon), never the app's own example picture.
function finishDrawing(id, payload) {
  const act = ACTIVITIES[id] ? id : 'free';
  const item = { kind: 'draw', act };
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
  pad.forget(act);
  resetTo(`done:${act}`);
}

addEventListener('pointerdown', () => { if (!toastEl.hidden && Date.now() - (toast.at || 0) > 300) toastEl.hidden = true; }, true);

function toast(msg, ms = 5000) {
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
  if (b.dataset.hold) {
    pressedHold(b);
    return;
  }
  const act = b.dataset.act;
  const [screen, id, n] = currentRoute().split(':');

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
      finishDrawing(b.dataset.id, '');
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
    case 'colour':
      pad.colour = Number(b.dataset.i);
      screenEl.querySelectorAll('.swatch').forEach((s) => { s.classList.toggle('on', s === b); s.setAttribute('aria-pressed', s === b); });
      break;
    case 'undo':
      pad.undo();
      break;
    case 'wipe':
      pad.wipe();
      break;
    case 'padstep': {
      const to = Number(b.dataset.n);
      history.replaceState({ ...history.state, route: `canvas:${id}:${to}` }, '');
      const guide = $('#padguide');
      if (guide) guide.innerHTML = guideHtml(id, to);
      current.say = `${t('stepSay', { n: to })} ${L(ACTIVITIES[id].steps[to - 1])}`;
      if (settings.autoRead) speech.say(current.say);
      const again = screenEl.querySelector(`[data-act="padstep"][data-n="${to + 1}"]:not([disabled])`) || screenEl.querySelector('[data-act="padstep"]:not([disabled])');
      if (again && (isGlasses() || lastInput === 'key')) again.focus();
      break;
    }
    case 'savedrawing':
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
screenEl.addEventListener('focusin', (e) => {
  if (!isGlasses() || !settings.autoRead || lastInput !== 'key') return;
  const el = e.target.closest('[data-say]');
  clearTimeout(focusTimer);
  if (el) focusTimer = setTimeout(() => speech.say(el.dataset.say), 450);
});

addEventListener('resize', () => {
  if (currentRoute().startsWith('canvas')) pad.fit();
  else if (document.documentElement.classList.contains('mode-glasses') !== isGlasses()) render(currentRoute());
});

// ---- start --------------------------------------------------------------------------------------------------
importFromLink();
if (!history.state || !history.state.route) history.replaceState({ route: 'home', depth: 0 }, '');
render(history.state.route);
wake();

// Voices can arrive after the first screen. Redraw only if that changes whether there is a voice to offer.
if (speech.ok) {
  const onVoices = () => {
    const screen = screenEl.dataset.screen;
    if (screen === 'helper') {
      const v = $('.voicestate');
      if (v) v.textContent = `${t('voiceStatus')}: ${speech.voiceFor('ur') ? t('voiceOk') : t('voiceNoUrdu')}`;
    } else if (screen !== 'canvas' && canVoice() !== lastCanVoice) {
      render(currentRoute());
    }
  };
  if (typeof speechSynthesis.addEventListener === 'function') speechSynthesis.addEventListener('voiceschanged', onVoices);
  else if ('onvoiceschanged' in speechSynthesis) speechSynthesis.onvoiceschanged = onVoices;
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
