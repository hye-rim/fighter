'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 작은 격투: 화면·입력·소리. 규칙은 logic.js (LOGIC_FT). 여기서는 규칙이 알려 주는 일(events)을 보고 소리·효과를 만든다.
const L = LOGIC_FT, $ = (id) => document.getElementById(id);
const TUT = /[?&]tutorial=1(&|$)/.test(location.search);
const VW = 300; let VH = 240, GY = 196;               // 그림 크기(가로는 고정, 세로와 땅 높이는 화면 비율에 맞춘다)
const cv = $('c'), ctx = cv.getContext('2d');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 계속 */ } },
};
let level = Math.max(0, Math.min(4, store.get('ftLevel', 0) | 0)), best = store.get('ftBest', 0) | 0, soundOn = store.get('ftSound', true);
let hero = Math.max(0, Math.min(2, store.get('ftHero', 0) | 0));
let M = null, screen = 'start', paused = false;      // screen: start | fight | end
let fx = [], pops = [], dust = [], ghosts = [[], []], shake = 0, flash = [0, 0], slow = 0, banner = null, camX = 200, camS = 1.2, matchEndT = 0, punch = 0, white = 0, hpShow = [100, 100], koZoom = 0, tnow = 0;

// ---------- 소리 ----------
let audio = null;
function tone(freq, dur, type = 'square', vol = 0.05, slide = 0, delay = 0) {
  if (!soundOn) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audio.currentTime + delay, o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audio.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  } catch (e) { /* 소리가 안 나도 게임은 계속 */ }
}
function noise(dur, vol = 0.06, freq = 1200, delay = 0) {
  if (!soundOn) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const n = Math.floor(audio.sampleRate * dur), buf = audio.createBuffer(1, n, audio.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = audio.createBufferSource(), fl = audio.createBiquadFilter(), g = audio.createGain(), t0 = audio.currentTime + delay;
    src.buffer = buf; fl.type = 'bandpass'; fl.frequency.value = freq; g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(fl); fl.connect(g); g.connect(audio.destination); src.start(t0);
  } catch (e) { /* 소리가 안 나도 게임은 계속 */ }
}
const sfx = {
  dash() { noise(0.12, 0.05, 2400); },
  swing(h) { tone(h ? 260 : 420, 0.08, 'sine', 0.03, -160); noise(h ? 0.1 : 0.06, 0.04, h ? 900 : 1800); },
  hit(big) { noise(big ? 0.14 : 0.08, big ? 0.12 : 0.08, big ? 500 : 900); tone(big ? 120 : 190, big ? 0.16 : 0.1, 'square', 0.07, -70); tone(big ? 70 : 110, 0.12, 'sawtooth', 0.05, -30, 0.01); },
  block() { tone(700, 0.05, 'triangle', 0.05, -200); },
  gbreak() { tone(300, 0.25, 'sawtooth', 0.06, -220); },
  special(kind) { tone(300, 0.3, 'sawtooth', 0.05, 500); if (kind === 'rise') noise(0.25, 0.07, 700); if (kind === 'rush') noise(0.2, 0.06, 1400); },
  jump() { tone(330, 0.1, 'sine', 0.03, 200); },
  ko() { tone(260, 0.5, 'sawtooth', 0.08, -220); tone(90, 0.5, 'square', 0.06, -30, 0.05); },
  round() { tone(440, 0.12, 'triangle', 0.06); tone(660, 0.18, 'triangle', 0.06, 0, 0.12); },
  fight() { tone(520, 0.1, 'square', 0.06, 200); tone(780, 0.22, 'square', 0.06, 0, 0.1); },
  win() { [523, 659, 784, 1046].forEach((f, k) => tone(f, 0.2, 'triangle', 0.06, 0, k * 0.1)); },
  lose() { [392, 330, 262].forEach((f, k) => tone(f, 0.3, 'triangle', 0.05, 0, k * 0.18)); },
};

// ---------- 입력 ----------
const KEYMAP = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'jump', w: 'jump', W: 'jump', j: 'light', J: 'light', z: 'light', Z: 'light', k: 'heavy', K: 'heavy', x: 'heavy', X: 'heavy', l: 'block', L: 'block', c: 'block', C: 'block', ArrowDown: 'block', s: 'block', S: 'block', u: 'special', U: 'special', v: 'special', V: 'special', ' ': 'special' };
const hold = L.idleInput(), padDown = {}, keyDown = {};
let lastTap = { k: null, t: 0 };
function setKey(k, on, from) {
  const was = hold[k];
  if (on && !was && (k === 'left' || k === 'right') && screen === 'fight' && !paused) {      // 같은 방향을 빠르게 두 번 누르면 대시
    const now = performance.now();
    if (lastTap.k === k && now - lastTap.t < 280) { hold.dash = k === 'right' ? 1 : -1; lastTap = { k: null, t: 0 }; } else lastTap = { k, t: now };
  } (from === 'pad' ? padDown : keyDown)[k] = on; hold[k] = !!(padDown[k] || keyDown[k]);
  if (on && !was && screen === 'fight' && !paused) {
    if (k === 'left' || k === 'right') tutorialSignal('move');
    else if (k === 'jump' || k === 'light' || k === 'heavy' || k === 'block') tutorialSignal(k);
  }
  const b = document.querySelector(`.pb[data-k="${k}"]`); if (b) b.classList.toggle('on', hold[k]);
}
document.querySelectorAll('.pb').forEach((b) => {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ } setKey(k, true, 'pad'); });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, () => setKey(k, false, 'pad'));
  b.addEventListener('contextmenu', (e) => e.preventDefault());
});
window.addEventListener('keydown', (e) => { const k = KEYMAP[e.key]; if (k) { e.preventDefault(); if (!e.repeat) setKey(k, true, 'key'); } });
window.addEventListener('keyup', (e) => { const k = KEYMAP[e.key]; if (k) setKey(k, false, 'key'); });
const releaseAll = () => { for (const k of Object.keys(hold)) { padDown[k] = keyDown[k] = false; hold[k] = false; const b = document.querySelector(`.pb[data-k="${k}"]`); if (b) b.classList.remove('on'); } };

// ---------- 흐름 ----------
function showHeroes() {
  const box = $('heroes'); if (!box) return; box.classList.toggle('hidden', TUT);
  box.innerHTML = L.ROSTER.map((h, i) => `<button class="hc ${i === hero ? 'sel' : ''}" data-i="${i}"><canvas width="64" height="64"></canvas><b>${h.name}</b><small>${h.tag}</small></button>`).join('');
  box.querySelectorAll('.hc').forEach((b) => {
    const i = +b.dataset.i, c = b.querySelector('canvas').getContext('2d'); c.translate(32, 38); c.scale(2.6, 2.6); drawHead(c, HERO_LOOK[i], 'idle', 0, 8);
    b.onclick = () => { hero = i; store.set('ftHero', i); showHeroes(); };
  });
}
function showLadder() {
  showHeroes();
  $('ladder').innerHTML = L.OPPONENTS.map((o, i) => `<span class="${i < best ? 'done' : ''} ${i === level ? 'cur' : ''}">${o.emoji}</span>`).join('');
  const o = L.OPPONENTS[level];
  $('nextOpp').innerHTML = TUT ? '먼저 <b>연습 상대</b>와 해 볼까요?' : `다음 상대 <b>${level + 1}/5 · ${o.emoji} ${o.name}</b><br>${o.tag}` + (best >= 5 ? '<br>(모두 이겨 본 적이 있어요!)' : '');
}
function startMatch() {
  M = L.newMatch({ opp: level, hero, seed: (Date.now() & 0xffff) + 1, tutorial: TUT });
  fx = []; pops = []; dust = []; ghosts = [[], []]; white = 0; punch = 0; hpShow = [M.f[0].maxHp, M.f[1].maxHp]; shake = 0; flash = [0, 0]; slow = 0; banner = null; matchEndT = 0; paused = false; screen = 'fight';
  $('ovStart').classList.add('hidden'); $('ovEnd').classList.add('hidden'); $('ovPause').classList.add('hidden'); releaseAll();
  camX = 200; camS = 1.2;
}
function toStart() { screen = 'start'; M = null; showLadder(); $('ovEnd').classList.add('hidden'); $('ovPause').classList.add('hidden'); $('ovStart').classList.remove('hidden'); }
function showEnd() {
  const win = M.result === 'win', o = M.P, cleared = win && level >= 4;
  if (win && !TUT) { best = Math.max(best, level + 1); store.set('ftBest', best); if (level < 4) { level++; store.set('ftLevel', level); } }
  $('endTitle').textContent = cleared ? '🏆 모두 이겼어요!' : win ? '승리!' : '졌어요…';
  $('vsRow').textContent = win ? '🥋 > ' + o.emoji : o.emoji + ' > 🥋';
  $('endText').innerHTML = cleared ? '5명을 모두 쓰러뜨렸어요. 진짜 격투왕이에요!' : win ? `<b>${o.name}</b>에게 이겼어요! 다음 상대는 <b>${L.OPPONENTS[level].emoji} ${L.OPPONENTS[level].name}</b>.` : `<b>${o.name}</b>에게 졌어요. 막기와 거리 조절을 써 보세요.`;
  $('btnNext').textContent = cleared ? '처음부터 다시' : win ? '다음 상대' : '다시 도전';
  $('btnNext').dataset.act = cleared ? 'reset' : 'go';
  screen = 'end'; $('ovEnd').classList.remove('hidden'); win ? sfx.win() : sfx.lose();
}
$('btnStart').onclick = startMatch;
$('btnNext').onclick = () => { if ($('btnNext').dataset.act === 'reset') { level = 0; store.set('ftLevel', 0); } startMatch(); };
$('btnMenu').onclick = toStart;
$('pause').onclick = () => setPaused(true);
$('btnResume').onclick = () => setPaused(false);
$('btnQuit').onclick = toStart;
function setPaused(p) { if (screen !== 'fight') return; paused = p; $('ovPause').classList.toggle('hidden', !p); if (p) releaseAll(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
window.addEventListener('blur', () => setPaused(true));

// ---------- 규칙이 알려 준 일 → 소리와 효과 ----------
const addFx = (o) => fx.push({ rot: Math.random() * 6.28, t: 0, ...o });
const puff = (x, n = 5, spread = 0.6) => { for (let i = 0; i < n; i++) dust.push({ x: x + (Math.random() - 0.5) * 10, t: 0, life: 22 + Math.random() * 10, vx: (Math.random() - 0.5) * spread, vy: Math.random() * 0.3, sz: 0.8 + Math.random() * 0.5 }); };
function handle(events) {
  for (const e of events) {
    if (e.t === 'swing') sfx.swing(e.move === 'heavy');
    else if (e.t === 'special') { sfx.special(e.kind); flash[e.id] = 0; punch = Math.max(punch, 0.5); if (e.kind !== 'special') puff(M.f[e.id].x, 4); }
    else if (e.t === 'jump') { sfx.jump(); puff(e.x, 3, 0.4); }
    else if (e.t === 'land') puff(e.x, 5, 0.9);
    else if (e.t === 'dash') { sfx.dash(); puff(e.x, 5, 1.1); if (e.id === 0) tutorialSignal('dash'); }
    else if (e.t === 'hit') {
      sfx.hit(e.big); flash[e.id] = 6; shake = Math.max(shake, e.big ? 7 : 3); punch = Math.max(punch, e.big ? 1 : 0.5);
      addFx({ x: e.x, y: e.y + 38, kind: 'spark', big: e.big }); if (e.big) addFx({ x: e.x, y: e.y + 38, kind: 'ring' });
      pops.push({ x: e.x, y: e.y + 62, t: 0, text: '-' + e.dmg, color: e.id === 0 ? '#ff7a6a' : '#ffe27a' });
      if (e.att === 0 && e.kind === 'melee') tutorialSignal(e.big ? 'hitH' : 'hitL'); else if (e.att === 0) tutorialSignal('hitBall');
    } else if (e.t === 'block') { sfx.block(); addFx({ x: e.x, y: 38, kind: 'guard' }); if (e.id === 0) tutorialSignal('guarded'); }
    else if (e.t === 'gbreak') { sfx.gbreak(); addFx({ x: e.x, y: 38, kind: 'guardbreak' }); pops.push({ x: e.x, y: 80, t: 0, text: '가드 깨짐!', color: '#ff9a3a' }); }
    else if (e.t === 'combo') { if (e.id === 0) pops.push({ x: M.f[1].x, y: 96, t: 0, text: e.n + ' 연타!', color: '#ffd23a' }); }
    else if (e.t === 'ko') { sfx.ko(); shake = 10; slow = 60; white = 0.9; punch = 1.4; }
    else if (e.t === 'clash') addFx({ x: e.x, y: 22, kind: 'spark' });
    else if (e.t === 'fight') { sfx.fight(); banner = { text: 'FIGHT!', t: 0 }; }
    else if (e.t === 'round') { sfx.round(); }
    else if (e.t === 'roundEnd') banner = { text: e.winner < 0 ? (e.time ? 'DRAW' : 'DOUBLE K.O.') : (e.time ? 'TIME!' : 'K.O.!'), t: 0, sub: e.winner === 0 ? '내가 이겼어요' : e.winner === 1 ? '상대가 이겼어요' : '' };
    else if (e.t === 'matchEnd') matchEndT = 1;
    if (e.t === 'special' && e.id === 0) tutorialSignal('special');
  }
}

// ---------- 반복 ----------
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (screen === 'fight' && !paused && M) {
    acc += dt * (slow > 0 ? 0.35 : 1);
    let n = 0;
    while (acc >= 1 / 60 && n++ < 6) { acc -= 1 / 60; tick(); }
  }
  render(dt); requestAnimationFrame(frame);
}
function tick() {
  if (!M || M.phase === 'match') return;
  L.step(M, hold); hold.dash = 0; handle(M.events);
  if (M.phase === 'fight' && M.hs === 0) for (const f of M.f) if (f.st === 'idle' && f.walk && f.frameNo % 9 === 0) dust.push({ x: f.x - f.walk * 6, t: 0, life: 20, vx: -f.walk * 0.1, vy: 0.15, sz: 0.6 });
  if (slow > 0) slow--;
  if (M.phase === 'intro' && M.pt === 1 && M.round >= 1) banner = { text: 'ROUND ' + M.round, t: 0 };
  if (matchEndT && M.phase === 'match') { matchEndT = 0; setTimeout(() => { if (screen === 'fight' && M && M.phase === 'match') showEnd(); }, 500); }
}

// ---------- 그리기 ----------
function resize() {
  const wrap = $('stageWrap'), W = wrap.clientWidth, H = wrap.clientHeight;
  const r = Math.max(0.8, Math.min(1.45, H / W)), w = Math.max(220, Math.floor(Math.min(W, H / r))), h = Math.floor(w * r), dpr = Math.min(window.devicePixelRatio || 1, 2);
  VH = VW * h / w; GY = VH - Math.max(38, VH * 0.17);
  cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr);
  ctx.setTransform(cv.width / VW, 0, 0, cv.height / VH, 0, 0); $('pause').style.right = Math.max(6, (W - w) / 2 + 6) + 'px';
}
window.addEventListener('resize', resize);

const sx = (x) => (x - camX) * camS + VW / 2;
const OUT = '#1c0f1c';
function line(c, x0, y0, x1, y1, w, col) { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
// 테두리가 있는 팔다리·몸통
function limb(c, x0, y0, x1, y1, w, col) { line(c, x0, y0, x1, y1, w + 2.6, OUT); line(c, x0, y0, x1, y1, w, col); }
function disc(c, x, y, r, col, out) { c.beginPath(); c.arc(x, y, r, 0, 7); if (out) { c.fillStyle = OUT; c.fill(); c.beginPath(); c.arc(x, y, r - 1.2, 0, 7); } c.fillStyle = col; c.fill(); }
function ell(c, x, y, rx, ry, col, rot = 0) { c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, 7); c.fillStyle = col; c.fill(); }
function poly(c, pts, col) { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath(); c.fillStyle = col; c.fill(); }

// 누구를 그릴지: 내 파이터 3명, 컴퓨터 5명 (머리 모양과 색)
const HERO_LOOK = [
  { kind: 'hero', skin: '#ffd9b0', hair: '#2a1a14', band: '#e8302a' },
  { kind: 'ninja', skin: '#f2c9a0', hair: '#111', band: '#ffd23a' },
  { kind: 'bear', skin: '#b8743e', hair: '#5a3a22', wide: true },
];
const OPP_LOOK = [
  { kind: 'chick', skin: '#ffd23a', color: '#ff9a3a', belt: '#fff', glove: '#ff9a3a', pants: '#8a4a1a' },
  { kind: 'boar', skin: '#b2704a', color: '#e8503a', belt: '#222', glove: '#4a2a1a', pants: '#3a1a1a', wide: true },
  { kind: 'turtle', skin: '#6ac878', color: '#3aa860', belt: '#ffe27a', glove: '#2a7a40', pants: '#1a4a2a', shell: true },
  { kind: 'rabbit', skin: '#f4f0ff', color: '#4a9bff', belt: '#fff', glove: '#ff8aa8', pants: '#1a3a7a', tail: true },
  { kind: 'lion', skin: '#e8b058', color: '#a860e8', belt: '#ffd23a', glove: '#2a1a3a', pants: '#2a1a48', wide: true, big: true },
];
function lookFor(id) {
  if (id === 0) { const H = L.ROSTER[M ? M.hero : hero], k = HERO_LOOK[M ? M.hero : hero]; return { ...k, color: H.color, belt: H.belt, glove: H.glove, pants: '#2a2038' }; }
  return OPP_LOOK[Math.max(0, M ? M.opp : 0)];
}

// 머리 (원점이 머리 가운데, 앞이 +x). expr: idle | atk | hit | ko | block
function drawHead(c, look, expr, t, r = 8) {
  const sk = look.skin, fl = Math.sin(t / 5) * 2;
  const eye = (x, y) => {
    if (expr === 'ko') { line(c, x - 2, y - 2, x + 2, y + 2, 1.2, '#222'); line(c, x + 2, y - 2, x - 2, y + 2, 1.2, '#222'); }
    else if (expr === 'hit') { line(c, x - 2, y - 2, x + 1.5, y, 1.3, '#222'); line(c, x - 2, y + 2, x + 1.5, y, 1.3, '#222'); }
    else { disc(c, x, y, 1.9, '#fff'); disc(c, x + 0.6, y, 1.1, '#222'); if (expr === 'atk') line(c, x - 3.2, y - 3.6, x + 2.6, y - 1.8, 1.4, '#222'); }
  };
  switch (look.kind) {
    case 'hero':
      line(c, -r * 0.6, -r * 0.2, -r - 6, -3 + fl, 3, look.band); line(c, -r * 0.6, 0, -r - 5, 3 - fl, 2.6, look.band);
      poly(c, [[-r, -1], [-r - 4, -r - 1], [-3, -r - 6], [1, -r - 9], [4, -r - 4], [r * 0.9, -r + 1], [r, -2]], look.hair);
      disc(c, 0, 0, r, sk, true); poly(c, [[-r, -1], [-r * 0.5, -r + 1], [0, -r - 3], [r * 0.6, -r + 1], [r * 0.95, -2], [-r * 0.2, -3]], look.hair);
      c.fillStyle = look.band; c.fillRect(-r, -3.4, r * 2, 3.4); c.strokeStyle = OUT; c.lineWidth = 0.8; c.strokeRect(-r, -3.4, r * 2, 3.4);
      eye(3.2, 1.8); ell(c, 5.6, 4.6, 1.8, 0.8, '#c05a4a'); break;
    case 'ninja':
      line(c, -r * 0.5, 2, -r - 9, 2 + fl * 1.5, 3.4, look.band); line(c, -r * 0.5, 4, -r - 7, 6 - fl, 2.8, look.band);
      disc(c, 0, 0, r, '#2b3a7a', true); c.fillStyle = sk; c.fillRect(-1, -3.6, r + 1, 5.2); eye(3.6, -0.9);
      c.fillStyle = look.band; c.fillRect(-r, 2.6, r * 2, 2.4); break;
    case 'bear':
      disc(c, -4.5, -r + 0.5, 3.6, look.hair, true); disc(c, 4.5, -r + 0.5, 3.6, look.hair, true);
      disc(c, 0, 0, r + 1, sk, true); ell(c, 4.8, 3, 4.6, 3.4, '#e8c898'); disc(c, 7.4, 1.8, 1.5, '#222'); eye(2.2, -2.4); break;
    case 'chick':
      line(c, -1, -r, -3, -r - 5, 1.6, '#ffb020'); line(c, 1, -r, 1, -r - 6, 1.6, '#ffb020'); line(c, 3, -r, 5, -r - 4.5, 1.6, '#ffb020');
      disc(c, 0, 0, r + 0.5, sk, true); poly(c, [[r - 1, 0], [r + 6, 2.2], [r - 1, 4.4]], '#ff8a1a'); ell(c, -1.5, 3.8, 2.6, 1.8, 'rgba(255,120,80,.45)'); eye(3.4, -1.6); break;
    case 'boar':
      poly(c, [[-5, -r + 1], [-8, -r - 5], [-1, -r - 1]], look.skin); poly(c, [[1, -r], [3, -r - 6], [6, -r + 1]], look.skin);
      disc(c, 0, 0, r + 0.5, sk, true); ell(c, 6.6, 2.6, 4.2, 3.2, '#e89a8a'); disc(c, 7.2, 1.8, 0.9, '#5a2a22'); disc(c, 9, 2.4, 0.9, '#5a2a22');
      poly(c, [[5, 5.2], [6.4, 8.6], [8, 5.2]], '#fff'); eye(2.2, -2.2); line(c, -1.5, -5, 4.8, -3.4, 1.6, '#222'); break;
    case 'turtle':
      disc(c, 0, 0, r, sk, true); ell(c, 5.6, 3.4, 3.8, 2.4, '#a8e8b0'); line(c, 3.6, 4.4, 7.6, 4.4, 1, '#2a5a30'); eye(3, -1.8); break;
    case 'rabbit':
      ell(c, -3.5, -r - 7, 2.7, 8.5, OUT, -0.3 + fl * 0.03); ell(c, -3.5, -r - 7, 1.7, 7.4, look.skin, -0.3 + fl * 0.03); ell(c, -3.5, -r - 6, 0.9, 5, '#ff9ab8', -0.3 + fl * 0.03);
      ell(c, 3, -r - 8, 2.7, 8.5, OUT, 0.15 - fl * 0.03); ell(c, 3, -r - 8, 1.7, 7.4, look.skin, 0.15 - fl * 0.03); ell(c, 3, -r - 7, 0.9, 5, '#ff9ab8', 0.15 - fl * 0.03);
      disc(c, 0, 0, r, sk, true); disc(c, 7.4, 2.4, 1.3, '#ff7a9a'); ell(c, -1.5, 4.6, 2.4, 1.6, 'rgba(255,140,170,.5)'); eye(3.2, -1.2); break;
    case 'lion':
      for (let i = 0; i < 12; i++) { const a = i * 0.5236; poly(c, [[Math.cos(a - 0.2) * 10, Math.sin(a - 0.2) * 10], [Math.cos(a) * (15 + (i % 2) * 2), Math.sin(a) * (15 + (i % 2) * 2)], [Math.cos(a + 0.2) * 10, Math.sin(a + 0.2) * 10]], '#a85a1a'); }
      disc(c, 0, 0, 11, '#c8782a', true); disc(c, 0.8, 0.8, 8, sk, true); ell(c, 5, 3.4, 3.2, 2.4, '#f4d498'); disc(c, 7, 2.4, 1.3, '#4a2a1a'); eye(2.4, -2); line(c, -1, -5.2, 5, -3.8, 1.6, '#222'); break;
    default: disc(c, 0, 0, r, sk, true); eye(3, -1);
  }
}

// 파이터 하나. 로컬 좌표: 앞쪽이 +x, 위쪽이 +y (키 60). alpha<1 이면 잔상
function drawFighter(f, look, flashT, alpha = 1, shakeX = 0) {
  const S = camS * (look.big ? 1.12 : 1), fy = GY - f.y * camS, x = sx(f.x) + shakeX;
  if (alpha >= 1) { ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x, GY + 3, 17 * S * Math.max(0.45, 1 - f.y / 150), 4.2 * S, 0, 0, 7); ctx.fill(); }
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, fy); ctx.scale(f.face * S, S);
  const Y = (v) => -v;
  const t = f.t, move = f.move && L.MOVES[f.move], fn = f.frameNo || 0;
  let hipY = 27, shY = 46, headX = 1, headY = 55, lean = 0, expr = 'idle';
  let fFoot = [10, 0], bFoot = [-9, 0], fKnee = [6, 14], bKnee = [-6, 14], fHand = [16, 44], bHand = [6, 40], fElb = [10, 40], bElb = [2, 38];
  const bob = Math.sin(fn / 14) * 1.3, wide = look.wide ? 3 : 0;
  if (f.st === 'idle' && f.walk) { const ph = Math.sin(fn / 3.2) * 8; fFoot = [8 + ph, Math.max(0, -ph * 0.5)]; bFoot = [-8 - ph, Math.max(0, ph * 0.5)]; fKnee = [6 + ph / 2, 14]; bKnee = [-6 - ph / 2, 14]; hipY += Math.abs(ph) * 0.12; shY += Math.abs(ph) * 0.12; headY += Math.abs(ph) * 0.12; lean = f.walk === f.face ? 2 : -1; }
  else if (f.st === 'idle') { hipY += bob; shY += bob; headY += bob; fHand[1] += bob * 0.5; }
  if (f.st === 'air' || f.y > 0) { fFoot = [10, 10]; bFoot = [-8, 8]; fKnee = [10, 20]; bKnee = [-6, 19]; if (f.vy < 0) { fHand = [14, 50]; bHand = [-2, 48]; } else { fHand = [14, 38]; bHand = [2, 36]; } }
  if (f.st === 'block') { hipY = 23; shY = 41; headY = 50; fFoot = [12, 0]; bFoot = [-10, 0]; fKnee = [10, 12]; bKnee = [-6, 11]; fHand = [13, 51]; bHand = [10, 47]; fElb = [10, 40]; bElb = [4, 38]; expr = 'block'; }
  if (f.st === 'bs') { hipY = 24; shY = 42; headY = 51; lean = -3; fFoot = [12, 0]; bFoot = [-12, 0]; fHand = [13, 51]; bHand = [10, 47]; expr = 'block'; }
  if (f.st === 'gb') { lean = -9; headX = -8; headY = 48; fHand = [-6, 32]; bHand = [-14, 30]; fElb = [-2, 38]; bElb = [-8, 36]; expr = 'hit'; }
  if (f.st === 'hit') { lean = -7; headX = -6; headY = 52; fHand = [-4, 36]; bHand = [-12, 34]; fElb = [0, 40]; bElb = [-6, 40]; expr = 'hit'; if (f.y > 0) { fFoot = [4, 14]; bFoot = [-10, 18]; lean = -12; } }
  if (f.st === 'dash') { const fw = f.dd === f.face; lean = fw ? 7 : -5; hipY = 24; shY = 41; headY = 49; headX = fw ? 5 : -3; fFoot = [fw ? 16 : 8, 0]; bFoot = [fw ? -14 : -8, 3]; fKnee = [fw ? 12 : 6, 12]; bKnee = [fw ? -8 : -6, 13]; fHand = [fw ? 20 : 12, 40]; bHand = [fw ? -4 : 2, 36]; }
  let kick = null, aura = 0, swoosh = 0;
  if (f.st === 'atk' && move) {
    const p = t <= move.startup ? t / move.startup : t <= move.startup + move.active ? 1 : 1 - (t - move.startup - move.active) / move.recovery;
    expr = 'atk'; swoosh = t > move.startup - 1 && t <= move.startup + move.active + 3 ? 1 : 0;
    if (f.move === 'light') { fHand = [14 + 28 * p, 45]; fElb = [10 + 14 * p, 44]; bHand = [4, 40]; lean = 2 * p; headX = 1 + 2 * p; }
    else if (f.move === 'heavy') { kick = [12 + 28 * p, 24 + 20 * p]; fKnee = [10 + 8 * p, 26 + 6 * p]; lean = -4 * p; fHand = [4, 44]; bHand = [-6, 40]; hipY -= 2 * p; }
    else if (f.move === 'rush') { lean = 8 * p; hipY = 24; shY = 41; headY = 49; headX = 5; fHand = [14 + 26 * p, 42]; fElb = [10 + 12 * p, 41]; bHand = [-6, 36]; fFoot = [16 * p + 6, 0]; bFoot = [-15, 2]; fKnee = [12, 12]; bKnee = [-8, 13]; aura = p; }
    else if (f.move === 'rise') { fHand = [10 + 4 * p, 46 + 28 * p]; fElb = [9, 46 + 13 * p]; bHand = [-2, 40]; lean = 3 * p; headY += 2 * p; fFoot = [8, 4]; bFoot = [-6, 2]; fKnee = [8, 16]; bKnee = [-5, 15]; aura = p; }
    else { fHand = [16 + 12 * p, 46]; fElb = [10, 46]; bHand = [14 + 10 * p, 42]; bElb = [8, 43]; aura = p; }
  }
  if (f.st === 'ko') { expr = 'ko'; ctx.rotate(-1.35); ctx.translate(-4, -2); hipY = 10; shY = 28; headY = 38; headX = 4; fHand = [8, 22]; bHand = [-2, 22]; fFoot = [10, 0]; bFoot = [-8, 0]; fKnee = [6, 6]; bKnee = [-6, 6]; }
  const skin = look.skin, gi = look.color, pants = look.pants || '#2a2038', hip = [lean * 0.3, Y(hipY)], sh = [lean, Y(shY)];
  const wob = flashT > 0 && Math.floor(flashT) % 2 === 0, body = wob ? '#ffffff' : gi, legc = wob ? '#ffffff' : pants, arm = wob ? '#ffffff' : skin;
  // 등 뒤 물건 (거북 등딱지, 토끼 꼬리)
  if (look.shell) { ell(ctx, lean - 7, Y(shY - 7), 9, 12, OUT, -0.2); ell(ctx, lean - 7, Y(shY - 7), 7.8, 10.8, wob ? '#fff' : '#8a6a3a', -0.2); line(ctx, lean - 11, Y(shY - 2), lean - 4, Y(shY - 12), 1.2, '#5a4220'); line(ctx, lean - 12, Y(shY - 10), lean - 3, Y(shY - 4), 1.2, '#5a4220'); }
  if (look.tail) disc(ctx, hip[0] - 9, hip[1] + 1, 4, '#fff', true);
  // 허리띠 끝 (펄럭)
  const beltC = wob ? '#fff' : (look.belt || '#c8302a'), flap = Math.sin(fn / 6) * 2 + (f.st === 'dash' ? -5 : 0);
  line(ctx, hip[0] - 4, hip[1], hip[0] - 11, hip[1] + 7 + flap, 2.6, beltC); line(ctx, hip[0] - 3, hip[1], hip[0] - 9, hip[1] + 11 - flap, 2.4, beltC);
  // 뒤쪽 다리·팔
  limb(ctx, hip[0], hip[1], bKnee[0], Y(bKnee[1]), 6 + wide * 0.4, legc); limb(ctx, bKnee[0], Y(bKnee[1]), bFoot[0], Y(bFoot[1]), 6 + wide * 0.4, legc);
  disc(ctx, bFoot[0] + 2, Y(bFoot[1]) - 0.5, 3.2, '#2a1a22');
  limb(ctx, sh[0], sh[1], bElb[0], Y(bElb[1]), 5 + wide * 0.3, arm); limb(ctx, bElb[0], Y(bElb[1]), bHand[0], Y(bHand[1]), 5 + wide * 0.3, arm); disc(ctx, bHand[0] + 1, Y(bHand[1]), 3.6, wob ? '#fff' : (look.glove || '#e8503a'), true);
  // 몸통 (도복) + 깃 + 띠
  limb(ctx, hip[0], hip[1], sh[0], sh[1], 13 + wide, body);
  line(ctx, sh[0] + 2, sh[1] + 1, hip[0] + 4, hip[1] - 9, 1.6, 'rgba(0,0,0,.35)'); line(ctx, sh[0] - 3, sh[1] + 2, hip[0] + 4, hip[1] - 9, 1.6, 'rgba(0,0,0,.35)');
  line(ctx, hip[0] - 6.5 - wide / 2, hip[1] - 1, hip[0] + 6.5 + wide / 2, hip[1] - 1, 3.4, OUT); line(ctx, hip[0] - 6 - wide / 2, hip[1] - 1, hip[0] + 6 + wide / 2, hip[1] - 1, 2.4, beltC);
  // 앞쪽 다리
  if (kick) { limb(ctx, hip[0], hip[1], fKnee[0], Y(fKnee[1]), 6.4, legc); limb(ctx, fKnee[0], Y(fKnee[1]), kick[0], Y(kick[1]), 6.4, legc); disc(ctx, kick[0] + 2, Y(kick[1]), 3.8, '#2a1a22', true); }
  else { limb(ctx, hip[0], hip[1], fKnee[0], Y(fKnee[1]), 6.4 + wide * 0.4, legc); limb(ctx, fKnee[0], Y(fKnee[1]), fFoot[0], Y(fFoot[1]), 6.4 + wide * 0.4, legc); disc(ctx, fFoot[0] + 2.4, Y(fFoot[1]) - 0.5, 3.4, '#2a1a22'); }
  // 앞쪽 팔
  limb(ctx, sh[0], sh[1], fElb[0], Y(fElb[1]), 5.6 + wide * 0.3, arm); limb(ctx, fElb[0], Y(fElb[1]), fHand[0], Y(fHand[1]), 5.6 + wide * 0.3, arm);
  disc(ctx, fHand[0] + 1, Y(fHand[1]), 4.6, wob ? '#fff' : (look.glove || '#e8503a'), true);
  // 머리
  ctx.save(); ctx.translate(headX + lean, Y(headY)); if (f.st === 'ko') ctx.rotate(0.3); drawHead(ctx, wob ? { ...look, skin: '#fff' } : look, expr, fn, look.kind === 'lion' ? 7.5 : 8); ctx.restore();
  // 휘두르는 바람 자국
  if (swoosh && alpha >= 1) {
    ctx.save(); ctx.globalAlpha = 0.75; ctx.lineCap = 'round';
    if (f.move === 'light') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sh[0] + 8, sh[1] + 2, 26, -0.7, 0.5); ctx.stroke(); }
    else if (f.move === 'heavy') { ctx.strokeStyle = '#ffd890'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(hip[0] + 4, hip[1] - 8, 34, -1.0, 0.35); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hip[0] + 4, hip[1] - 8, 30, -0.9, 0.2); ctx.stroke(); }
    else if (f.move === 'rise') { for (let i = 0; i < 3; i++) { ctx.strokeStyle = i ? '#9ad8ff' : '#fff'; ctx.lineWidth = 3 - i; ctx.beginPath(); ctx.arc(10 + i * 2, Y(48), 20 + i * 5, -2.6, 0.2); ctx.stroke(); } }
    else if (f.move === 'rush') { for (let i = 0; i < 4; i++) line(ctx, -14 - i * 7, Y(18 + i * 9), -34 - i * 8, Y(18 + i * 9), 2, '#fff'); }
    ctx.restore();
  }
  // 필살기 기운
  if (aura > 0 && alpha >= 1) { ctx.globalAlpha = 0.65 * aura; const g = ctx.createRadialGradient(fHand[0] + 6, Y(fHand[1]), 1, fHand[0] + 6, Y(fHand[1]), 14); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(200,140,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fHand[0] + 6, Y(fHand[1]), 14, 0, 7); ctx.fill(); }
  ctx.restore();
}

// ---------- 무대 5곳 (상대마다 다른 곳) ----------
const STAGES = [
  { sky: ['#2a1450', '#8a3a6a', '#e8864a'], orb: ['#ffd88a', 0.5, 108, 34], far: '#3a1a58', mid: 'lantern', floor: ['#c88a4a', '#7a4a28'], line: 'rgba(80,40,10,.35)' },
  { sky: ['#0e2a2a', '#2a6a5a', '#b4e29a'], orb: ['#f4ffd0', 0.25, 90, 26], far: '#18453c', mid: 'bamboo', floor: ['#8a7a4a', '#4a4228'], line: 'rgba(30,40,10,.35)' },
  { sky: ['#16305a', '#3a78a8', '#b0e4ec'], orb: ['#fffbe0', 0.7, 80, 22], far: '#2a5a7a', mid: 'pond', floor: ['#a0a4aa', '#5a5e68'], line: 'rgba(30,30,50,.3)' },
  { sky: ['#050a22', '#1a2a6a', '#5a6ab0'], orb: ['#f4f4ff', 0.3, 70, 30], far: '#0e1640', mid: 'roof', floor: ['#4a5a78', '#20283e'], line: 'rgba(0,0,20,.4)', stars: true },
  { sky: ['#2a0a0a', '#6a1a1a', '#d85a2a'], orb: ['#ffb060', 0.5, 104, 40], far: '#3a0e12', mid: 'banner', floor: ['#7a3a2a', '#3a1a14'], line: 'rgba(255,200,100,.25)' },
];
function drawBackground() {
  const st = STAGES[Math.max(0, M ? M.opp : 0)], cx = camX - 200;
  const g = ctx.createLinearGradient(0, 0, 0, GY); g.addColorStop(0, st.sky[0]); g.addColorStop(0.65, st.sky[1]); g.addColorStop(1, st.sky[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, GY);
  if (st.stars) { ctx.fillStyle = '#fff'; for (let i = 0; i < 28; i++) { const x = (i * 83 + 17) % VW, y = (i * 47 + 9) % (GY * 0.6); ctx.globalAlpha = 0.4 + 0.5 * Math.abs(Math.sin(tnow / 600 + i)); ctx.fillRect(x, y, 1.4, 1.4); } ctx.globalAlpha = 1; }
  ctx.fillStyle = st.orb[0]; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(VW * st.orb[1] - cx * 0.05, st.orb[2], st.orb[3] + 12, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(VW * st.orb[1] - cx * 0.05, st.orb[2], st.orb[3], 0, 7); ctx.fill();
  // 먼 산·지붕
  const ox = -cx * 0.15; ctx.fillStyle = st.far;
  if (st.mid === 'roof') { for (let i = -1; i < 7; i++) { const bx = ox + i * 64, h = 34 + ((i * 53) % 4) * 12; ctx.fillRect(bx, GY - h, 50, h); poly(ctx, [[bx - 6, GY - h], [bx + 25, GY - h - 14], [bx + 56, GY - h]], st.far); } }
  else for (let i = -1; i < 6; i++) { const bx = ox + i * 70, h = 44 + ((i * 37) % 5) * 9; ctx.beginPath(); ctx.moveTo(bx, GY); ctx.lineTo(bx + 35, GY - h); ctx.lineTo(bx + 70, GY); ctx.fill(); }
  // 가운데 장식
  const ox2 = -cx * 0.4, glow = 0.7 + 0.3 * Math.sin(tnow / 300);
  if (st.mid === 'lantern') for (const px of [30, 150, 270, 390, 510]) { const x = px + ox2 - 100; ctx.fillStyle = '#5a2a2a'; ctx.fillRect(x, GY - 100, 7, 100); const lg = ctx.createRadialGradient(x + 3, GY - 96, 2, x + 3, GY - 96, 26); lg.addColorStop(0, `rgba(255,150,80,${0.55 * glow})`); lg.addColorStop(1, 'rgba(255,150,80,0)'); ctx.fillStyle = lg; ctx.fillRect(x - 24, GY - 124, 54, 54); ctx.fillStyle = '#ff5a4a'; ctx.beginPath(); ctx.arc(x + 3, GY - 96, 9, 0, 7); ctx.fill(); ctx.fillStyle = '#ffd86a'; ctx.fillRect(x - 1, GY - 108, 9, 3); ctx.fillRect(x - 1, GY - 87, 9, 3); }
  else if (st.mid === 'bamboo') for (let i = 0; i < 9; i++) { const x = ((i * 52 + 10) + ox2 * 1.4) % 420 - 40, h = 110 + (i * 29) % 40; ctx.fillStyle = i % 2 ? '#3a8a5a' : '#2a6a48'; ctx.fillRect(x, GY - h, 6, h); ctx.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 1; k < 5; k++) ctx.fillRect(x, GY - h * k / 5, 6, 1.5); ctx.fillStyle = '#6ac888'; poly(ctx, [[x + 6, GY - h * 0.7], [x + 22, GY - h * 0.7 - 6], [x + 8, GY - h * 0.7 + 4]], '#6ac888'); }
  else if (st.mid === 'pond') { ctx.fillStyle = 'rgba(120,200,230,.45)'; ctx.fillRect(0, GY - 26, VW, 26); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; for (let i = 0; i < 7; i++) { const y = GY - 22 + (i % 4) * 5, x = (i * 61 + tnow / 40) % (VW + 40) - 20; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 24, y); ctx.stroke(); } for (const px of [60, 220, 380]) { const x = px + ox2 - 80; ctx.fillStyle = '#7a7e86'; ctx.fillRect(x, GY - 50, 10, 50); ctx.fillRect(x - 5, GY - 58, 20, 8); ctx.fillStyle = '#ffe9a0'; ctx.fillRect(x + 1, GY - 46, 8, 8); } }
  else if (st.mid === 'roof') { for (const px of [40, 200, 360]) { const x = px + ox2 - 80; ctx.fillStyle = '#1a2250'; ctx.fillRect(x, GY - 60, 4, 60); ctx.fillStyle = '#2a3a8a'; poly(ctx, [[x - 18, GY - 60], [x + 2, GY - 76], [x + 22, GY - 60]], '#2a3a8a'); } }
  else if (st.mid === 'banner') for (const px of [20, 190, 360, 530]) { const x = px + ox2 - 100; ctx.fillStyle = '#c8302a'; ctx.fillRect(x, GY - 118, 26, 70); poly(ctx, [[x, GY - 48], [x + 13, GY - 58], [x + 26, GY - 48], [x + 26, GY - 42], [x, GY - 42]], '#c8302a'); ctx.fillStyle = '#ffd23a'; ctx.font = '900 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('武', x + 13, GY - 86); ctx.fillStyle = '#4a2a1a'; ctx.fillRect(x - 3, GY - 120, 32, 4); const fy = GY - 20 - Math.sin(tnow / 120 + px) * 2; const tg = ctx.createRadialGradient(x + 13, fy - 8, 1, x + 13, fy - 8, 22); tg.addColorStop(0, `rgba(255,170,60,${0.5 * glow})`); tg.addColorStop(1, 'rgba(255,170,60,0)'); ctx.fillStyle = tg; ctx.fillRect(x - 12, fy - 32, 50, 50); }
  // 바닥
  const f = ctx.createLinearGradient(0, GY, 0, VH); f.addColorStop(0, st.floor[0]); f.addColorStop(1, st.floor[1]); ctx.fillStyle = f; ctx.fillRect(0, GY, VW, VH - GY);
  ctx.strokeStyle = st.line; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = -10; i < 30; i++) { const x = sx(i * 40); ctx.moveTo(x, GY); ctx.lineTo(VW / 2 + (x - VW / 2) * 1.8, VH); } ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, GY + 1); ctx.lineTo(VW, GY + 1); ctx.strokeStyle = 'rgba(255,230,160,.5)'; ctx.stroke();
}

// ---------- 화면 위쪽 (체력·기·시간) ----------
function drawHead2(x, y, look, expr, r = 1) { ctx.save(); ctx.translate(x, y); ctx.scale(r, r); drawHead(ctx, look, expr, tnow / 16, look.kind === 'lion' ? 7 : 8); ctx.restore(); }
function drawHud(dt) {
  const p = M.f[0], e = M.f[1], o = M.P, BW = 108;
  hpShow[0] += (p.hp - hpShow[0]) * Math.min(1, dt * 3); hpShow[1] += (e.hp - hpShow[1]) * Math.min(1, dt * 3);
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, VW, 40);
  const hpBar = (x, w, f, show, right) => {
    const fr = Math.max(0, f.hp / f.maxHp), sh = Math.max(0, show / f.maxHp), y = 7, h = 12;
    ctx.fillStyle = '#220c14'; ctx.fillRect(x, y, w, h);
    const wb = (v) => right ? [x + w - w * v, w * v] : [x, w * v];
    ctx.fillStyle = '#ff7a3a'; ctx.fillRect(...[wb(sh)[0], y, wb(sh)[1], h]);
    const gr = ctx.createLinearGradient(0, y, 0, y + h); const col = fr > 0.3 ? ['#9aff8a', '#2aa84a'] : ['#ff9a8a', '#c8302a']; gr.addColorStop(0, col[0]); gr.addColorStop(1, col[1]);
    ctx.fillStyle = gr; ctx.fillRect(wb(fr)[0], y, wb(fr)[1], h);
    ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(wb(fr)[0], y, wb(fr)[1], 3);
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.2; ctx.strokeRect(x, y, w, h);
    // 기 막대 (칸마다 나뉨)
    const ey = y + h + 3, ev = f.energy / 100, ready = f.energy >= 100;
    ctx.fillStyle = '#1e1808'; ctx.fillRect(x, ey, w, 5); ctx.fillStyle = ready ? `rgba(230,160,255,${0.75 + 0.25 * Math.sin(tnow / 90)})` : '#ffc83a'; ctx.fillRect(wb(ev)[0], ey, wb(ev)[1], 5);
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; for (let i = 1; i < 4; i++) { const xx = x + w * i / 4; ctx.beginPath(); ctx.moveTo(xx, ey); ctx.lineTo(xx, ey + 5); ctx.stroke(); }
    if (f.guard > 4) { ctx.fillStyle = '#ff8a3a'; ctx.fillRect(wb(f.guard / 100)[0], ey + 6, wb(f.guard / 100)[1], 2.5); }
  };
  hpBar(36, BW, p, hpShow[0], false); hpBar(VW - 36 - BW, BW, e, hpShow[1], true);
  // 얼굴 동그라미
  for (const [cx, f, look] of [[17, p, lookFor(0)], [VW - 17, e, lookFor(1)]]) { ctx.save(); ctx.beginPath(); ctx.arc(cx, 20, 15, 0, 7); ctx.fillStyle = '#2a1a3a'; ctx.fill(); ctx.clip(); drawHead2(cx + (cx < VW / 2 ? 1 : -1), 22, look, f.st === 'hit' || f.st === 'gb' ? 'hit' : f.st === 'ko' ? 'ko' : 'idle', 1.05); ctx.restore(); ctx.beginPath(); ctx.arc(cx, 20, 15, 0, 7); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.stroke(); }
  ctx.font = '700 9px -apple-system, sans-serif'; ctx.textBaseline = 'top'; ctx.fillStyle = '#fff';
  ctx.textAlign = 'left'; ctx.fillText(L.ROSTER[M.hero].name, 37, 30); ctx.textAlign = 'right'; ctx.fillText(o.name, VW - 37, 30);
  // 시간과 이긴 판
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2a1408'; ctx.beginPath(); ctx.moveTo(VW / 2 - 17, 1); ctx.lineTo(VW / 2 + 17, 1); ctx.lineTo(VW / 2 + 13, 27); ctx.lineTo(VW / 2 - 13, 27); ctx.fill();
  const sec = Math.max(0, Math.ceil(M.timer / 60)); ctx.font = '900 19px -apple-system, sans-serif'; ctx.fillStyle = !M.tutorial && sec <= 10 ? '#ff6a5a' : '#ffd86a'; ctx.fillText(M.tutorial ? '∞' : String(sec), VW / 2, 14);
  const dots = (n, x) => { for (let i = 0; i < 2; i++) { ctx.fillStyle = i < n ? '#ffd23a' : 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(x + i * 10, 34, 3.4, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke(); } };
  dots(M.wins[0], VW / 2 - 15); dots(M.wins[1], VW / 2 + 5);
}

function render(dt) {
  if (!ctx) return;
  tnow = performance.now();
  ctx.save(); ctx.clearRect(0, 0, VW, VH);
  if (!M || screen === 'start') { camX = 200; camS = 1.1; drawBackground(); ctx.restore(); return; }
  // 카메라: 두 파이터가 다 보이게, 가까우면 확대. 세게 맞으면 살짝 확 줌, KO 되면 쓰러진 쪽으로 다가감
  const a = M.f[0].x, b = M.f[1].x, d = Math.abs(a - b);
  let tgtS = Math.max(0.95, Math.min(1.7, VW * 1.1 / (d + 120))), tgtX = (a + b) / 2;
  if (M.phase === 'end' && M.winner >= 0 && M.pt < 90) { const lo = M.f[1 - M.winner]; if (lo.st === 'ko') { tgtS = 1.85; tgtX = (lo.x * 2 + (a + b) / 2) / 3; } }
  punch = Math.max(0, punch - dt * 5);
  camS += (tgtS - camS) * Math.min(1, dt * 6); camX += (tgtX - camX) * Math.min(1, dt * 8);
  const half = VW / 2 / (camS * (1 + punch * 0.05)); camX = Math.max(half, Math.min(L.W - half, camX));
  const zs = 1 + punch * 0.05;
  if (shake > 0) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake = Math.max(0, shake - dt * 40); }
  const keepS = camS; camS = camS * zs;
  drawBackground();
  for (let i = 0; i < 2; i++) { const f = M.f[i]; f.frameNo = (f.frameNo || 0) + 1; if (flash[i] > 0) flash[i] -= dt * 60; }
  // 먼지 (걷기·착지·대시)
  for (const dp of dust) { dp.t += dt * 60; const k = dp.t / dp.life; if (k >= 1) continue; ctx.globalAlpha = 0.5 * (1 - k); ctx.fillStyle = '#e8dcc0'; ctx.beginPath(); ctx.arc(sx(dp.x + dp.vx * dp.t), GY - 2 - dp.vy * dp.t, (2 + k * 5) * camS * dp.sz, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  dust = dust.filter((q) => q.t < q.life);
  // 잔상
  for (let i = 0; i < 2; i++) {
    const f = M.f[i], moving = f.st === 'dash' || (f.st === 'atk' && (f.move === 'rush' || f.move === 'rise'));
    if (moving && (f.frameNo % 2 === 0)) ghosts[i].push({ ...f, frameNo: f.frameNo, a: 0.4 });
    for (const gh of ghosts[i]) { gh.a -= dt * 2.2; if (gh.a > 0) drawFighter(gh, lookFor(i), 0, gh.a * 0.7); }
    ghosts[i] = ghosts[i].filter((gh) => gh.a > 0);
  }
  // 기파
  for (const p of M.proj) {
    const px = sx(p.x), py = GY - p.y * camS, col = p.owner === 0 ? ['#9ad8ff', '#3a8ae8'] : ['#ff9ab8', '#e83a6a'], dir = Math.sign(p.vx), rr = 15 * camS;
    for (let k = 1; k <= 5; k++) { ctx.globalAlpha = 0.5 - k * 0.08; ctx.fillStyle = col[0]; ctx.beginPath(); ctx.arc(px - dir * k * 7 * camS, py, rr * (1 - k * 0.14), 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1; const g = ctx.createRadialGradient(px, py, 1, px, py, rr * 1.3); g.addColorStop(0, '#fff'); g.addColorStop(0.35, col[0]); g.addColorStop(0.7, col[1]); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rr * 1.3, 0, 7); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(px, py, rr * 0.7, tnow / 60, tnow / 60 + 4); ctx.stroke();
  }
  const order = M.f[0].y > M.f[1].y ? [1, 0] : [0, 1];
  for (const i of order) { const jit = M.hs > 0 && flash[i] > 0 ? (Math.random() - 0.5) * 3 : 0; drawFighter(M.f[i], lookFor(i), flash[i], 1, jit); }
  // 효과
  for (const s of fx) {
    s.t += dt * 60; const px = sx(s.x), py = GY - s.y * camS, life = s.kind === 'ring' ? 14 : 12, k = s.t / life; if (k >= 1) continue;
    ctx.globalAlpha = 1 - k;
    if (s.kind === 'spark' || s.kind === 'burst') {
      const n = s.big ? 10 : 7, R = (s.big ? 30 : 18) * (0.4 + k) * camS * 0.8, pts = [];
      for (let i = 0; i < n * 2; i++) { const an = i * Math.PI / n + s.rot, rr = i % 2 ? R * 0.35 : R * (0.8 + 0.4 * ((i * 7) % 3) / 2); pts.push([px + Math.cos(an) * rr, py + Math.sin(an) * rr]); }
      poly(ctx, pts, s.big ? '#ffe27a' : '#fff6c0'); ctx.globalAlpha = (1 - k) * 0.9; ctx.strokeStyle = '#ff7a2a'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(px, py, R * 0.5, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.4; for (let i = 0; i < 5; i++) { const an = s.rot + i * 1.257 + 0.4, r0 = R * 0.9, r1 = R * (1.3 + k); ctx.beginPath(); ctx.moveTo(px + Math.cos(an) * r0, py + Math.sin(an) * r0); ctx.lineTo(px + Math.cos(an) * r1, py + Math.sin(an) * r1); ctx.stroke(); }
    } else if (s.kind === 'guard' || s.kind === 'guardbreak' || s.kind === 'ring') {
      const col = s.kind === 'guard' ? '#9ad8ff' : s.kind === 'guardbreak' ? '#ff9a3a' : '#fff'; ctx.strokeStyle = col; ctx.lineWidth = 3 - k * 2; ctx.beginPath(); ctx.arc(px, py, (6 + k * 22) * camS * 0.8, 0, 7); ctx.stroke();
      if (s.kind !== 'ring') { ctx.lineWidth = 2; for (let i = 0; i < 6; i++) { const an = i * 1.047 + s.rot; ctx.beginPath(); ctx.moveTo(px + Math.cos(an) * (8 + k * 12), py + Math.sin(an) * (8 + k * 12)); ctx.lineTo(px + Math.cos(an) * (14 + k * 20), py + Math.sin(an) * (14 + k * 20)); ctx.stroke(); } }
    }
    ctx.globalAlpha = 1;
  }
  fx = fx.filter((s) => s.t < 14);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 14px -apple-system, sans-serif';
  for (const p of pops) { p.t += dt * 60; const k = p.t / 44; if (k >= 1) continue; const pop = k < 0.12 ? 0.6 + k / 0.12 * 0.7 : 1.3 - Math.min(0.3, (k - 0.12) * 1.2); ctx.save(); ctx.globalAlpha = 1 - k * k; ctx.translate(sx(p.x), GY - (p.y + k * 20) * camS); ctx.scale(pop, pop); ctx.lineWidth = 3.4; ctx.strokeStyle = '#000'; ctx.fillStyle = p.color; ctx.strokeText(p.text, 0, 0); ctx.fillText(p.text, 0, 0); ctx.restore(); }
  pops = pops.filter((p) => p.t < 44);
  camS = keepS;
  ctx.restore();
  // 끝에 가까워지면 화면 가장자리를 어둡게, KO 순간엔 하얗게
  if (white > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.85, white)})`; ctx.fillRect(0, 0, VW, VH); white = Math.max(0, white - dt * 3.5); }
  const vg = ctx.createRadialGradient(VW / 2, VH * 0.5, VH * 0.3, VW / 2, VH * 0.5, VH * 0.85); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.35)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);
  drawHud(dt);
  // 글자 띠
  if (banner) {
    banner.t += dt * 60; const k = banner.t / 70;
    if (k >= 1) banner = null;
    else { const sc = k < 0.15 ? 0.5 + k / 0.15 * 0.6 : 1.1 - Math.min(0.1, (k - 0.15)); ctx.save(); ctx.translate(VW / 2, 100); ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(-VW / 2, -26, VW, 52 + (banner.sub ? 14 : 0)); ctx.scale(sc, sc);
      ctx.font = '900 38px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 7; ctx.strokeStyle = '#4a1a00'; ctx.fillStyle = '#ffd23a'; ctx.strokeText(banner.text, 0, 0); ctx.fillText(banner.text, 0, 0);
      if (banner.sub) { ctx.font = '800 14px -apple-system, sans-serif'; ctx.lineWidth = 4; ctx.strokeText(banner.sub, 0, 30); ctx.fillStyle = '#fff'; ctx.fillText(banner.sub, 0, 30); } ctx.restore(); }
  }
  $('bSp').classList.toggle('ready', M.f[0].energy >= 100);
}

showLadder(); resize(); requestAnimationFrame(frame);
setTimeout(resize, 50);

/* @test-hooks:start */
window.__ft = { get M() { return M; }, get screen() { return screen; }, get level() { return level; }, get best() { return best; }, tick, startMatch, hold, render, handle, get paused() { return paused; }, setPaused };
/* @test-hooks:end */
