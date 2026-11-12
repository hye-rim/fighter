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
let M = null, screen = 'start', paused = false;      // screen: start | fight | end
let fx = [], pops = [], shake = 0, flash = [0, 0], slow = 0, banner = null, camX = 200, camS = 1.2, matchEndT = 0;

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
const sfx = {
  swing(h) { tone(h ? 260 : 420, 0.08, 'sine', 0.03, -160); },
  hit(big) { tone(big ? 120 : 190, big ? 0.16 : 0.1, 'square', 0.07, -70); tone(big ? 70 : 110, 0.12, 'sawtooth', 0.05, -30, 0.01); },
  block() { tone(700, 0.05, 'triangle', 0.05, -200); },
  gbreak() { tone(300, 0.25, 'sawtooth', 0.06, -220); },
  special() { tone(300, 0.3, 'sawtooth', 0.05, 500); },
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
function setKey(k, on, from) {
  const was = hold[k]; (from === 'pad' ? padDown : keyDown)[k] = on; hold[k] = !!(padDown[k] || keyDown[k]);
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
function showLadder() {
  $('ladder').innerHTML = L.OPPONENTS.map((o, i) => `<span class="${i < best ? 'done' : ''} ${i === level ? 'cur' : ''}">${o.emoji}</span>`).join('');
  const o = L.OPPONENTS[level];
  $('nextOpp').innerHTML = TUT ? '먼저 <b>연습 상대</b>와 해 볼까요?' : `다음 상대 <b>${level + 1}/5 · ${o.emoji} ${o.name}</b><br>${o.tag}` + (best >= 5 ? '<br>(모두 이겨 본 적이 있어요!)' : '');
}
function startMatch() {
  M = L.newMatch({ opp: level, seed: (Date.now() & 0xffff) + 1, tutorial: TUT });
  fx = []; pops = []; shake = 0; flash = [0, 0]; slow = 0; banner = null; matchEndT = 0; paused = false; screen = 'fight';
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
function handle(events) {
  for (const e of events) {
    if (e.t === 'swing') sfx.swing(e.move === 'heavy');
    else if (e.t === 'special') { sfx.special(); flash[e.id] = 0; }
    else if (e.t === 'jump') sfx.jump();
    else if (e.t === 'hit') {
      sfx.hit(e.big); flash[e.id] = 6; shake = Math.max(shake, e.big ? 7 : 3);
      fx.push({ x: e.x, y: e.y + 38, t: 0, kind: 'spark', big: e.big }); pops.push({ x: e.x, y: e.y + 62, t: 0, text: '-' + e.dmg, color: e.id === 0 ? '#ff7a6a' : '#ffe27a' });
      if (e.att === 0 && e.kind === 'melee') tutorialSignal(e.big ? 'hitH' : 'hitL'); else if (e.att === 0) tutorialSignal('hitBall');
    } else if (e.t === 'block') { sfx.block(); fx.push({ x: e.x, y: 38, t: 0, kind: 'guard' }); if (e.id === 0) tutorialSignal('guarded'); }
    else if (e.t === 'gbreak') { sfx.gbreak(); fx.push({ x: e.x, y: 38, t: 0, kind: 'guardbreak' }); pops.push({ x: e.x, y: 80, t: 0, text: '가드 깨짐!', color: '#ff9a3a' }); }
    else if (e.t === 'combo') { if (e.id === 0) pops.push({ x: M.f[1].x, y: 92, t: 0, text: e.n + ' 연타!', color: '#ffd23a' }); }
    else if (e.t === 'ko') { sfx.ko(); shake = 10; slow = 50; }
    else if (e.t === 'clash') fx.push({ x: e.x, y: 22, t: 0, kind: 'spark' });
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
  L.step(M, hold); handle(M.events);
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
function line(x0, y0, x1, y1, w, c) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, GY); g.addColorStop(0, '#2a1450'); g.addColorStop(0.7, '#8a3a6a'); g.addColorStop(1, '#e8864a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, GY);
  // 해
  ctx.fillStyle = '#ffd88a'; ctx.beginPath(); ctx.arc(VW * 0.5 - (camX - 200) * 0.05, 110, 34, 0, 7); ctx.fill();
  // 먼 산·지붕 (카메라보다 천천히 움직임)
  const ox = -(camX - 200) * 0.15;
  ctx.fillStyle = '#3a1a58';
  for (let i = -1; i < 6; i++) { const bx = ox + i * 70, h = 44 + ((i * 37) % 5) * 9; ctx.beginPath(); ctx.moveTo(bx, GY); ctx.lineTo(bx + 35, GY - h); ctx.lineTo(bx + 70, GY); ctx.fill(); }
  // 도장 기둥과 등
  const ox2 = -(camX - 200) * 0.4;
  for (const px of [30, 150, 270, 390, 510]) { const x = px + ox2 - 100; ctx.fillStyle = '#5a2a2a'; ctx.fillRect(x, GY - 100, 7, 100); ctx.fillStyle = '#ff5a4a'; ctx.beginPath(); ctx.arc(x + 3, GY - 96, 9, 0, 7); ctx.fill(); ctx.fillStyle = '#ffd86a'; ctx.fillRect(x - 1, GY - 108, 9, 3); }
  // 바닥
  const f = ctx.createLinearGradient(0, GY, 0, VH); f.addColorStop(0, '#c88a4a'); f.addColorStop(1, '#7a4a28'); ctx.fillStyle = f; ctx.fillRect(0, GY, VW, VH - GY);
  ctx.strokeStyle = 'rgba(80,40,10,.35)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = -10; i < 30; i++) { const x = sx(i * 40); ctx.moveTo(x, GY); ctx.lineTo(VW / 2 + (x - VW / 2) * 1.8, VH); } ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, GY + 1); ctx.lineTo(VW, GY + 1); ctx.strokeStyle = 'rgba(255,230,160,.5)'; ctx.stroke();
}

// 파이터 하나: 몸을 선으로 그린다. 로컬 좌표는 앞쪽이 +x, 위쪽이 +y (60 높이)
function drawFighter(f, look, flashT) {
  const S = camS * (look.big ? 1.12 : 1), fy = GY - f.y * camS, x = sx(f.x);
  // 그림자
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(x, GY + 2, 16 * S * Math.max(0.5, 1 - f.y / 140), 4 * S, 0, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(x, fy); ctx.scale(f.face * S, S);
  const Y = (v) => -v;                                                                  // 위로 v 만큼
  const t = f.t, move = f.move && L.MOVES[f.move];
  let hipY = 27, shY = 46, headX = 1, headY = 55, lean = 0;
  let fFoot = [10, 0], bFoot = [-9, 0], fKnee = [6, 14], bKnee = [-6, 14], fHand = [16, 44], bHand = [6, 40], fElb = [10, 40], bElb = [2, 38];
  const bob = Math.sin(f.frameNo / 14) * 1.2;
  if (f.st === 'idle' && f.walk) { const ph = Math.sin(f.frameNo / 4) * 8; fFoot = [8 + ph, 0]; bFoot = [-8 - ph, 0]; fKnee = [6 + ph / 2, 14]; bKnee = [-6 - ph / 2, 14]; }
  else if (f.st === 'idle') { hipY += bob; shY += bob; headY += bob; }
  if (f.st === 'air' || f.y > 0) { fFoot = [10, 10]; bFoot = [-8, 8]; fKnee = [10, 20]; bKnee = [-6, 19]; }
  if (f.st === 'block') { hipY = 23; shY = 41; headY = 50; fFoot = [12, 0]; bFoot = [-10, 0]; fKnee = [10, 12]; bKnee = [-6, 11]; fHand = [13, 50]; bHand = [10, 46]; fElb = [10, 40]; bElb = [4, 38]; }
  if (f.st === 'bs') { hipY = 24; shY = 42; headY = 51; lean = -3; fFoot = [12, 0]; bFoot = [-12, 0]; fHand = [13, 50]; bHand = [10, 46]; }
  if (f.st === 'gb') { lean = -9; headX = -8; headY = 48; fHand = [-6, 32]; bHand = [-14, 30]; fElb = [-2, 38]; bElb = [-8, 36]; }
  if (f.st === 'hit') { lean = -7; headX = -6; headY = 52; fHand = [-4, 36]; bHand = [-12, 34]; fElb = [0, 40]; bElb = [-6, 40]; }
  let kick = null, aura = 0;
  if (f.st === 'atk' && move) {
    const total = move.startup + move.active + move.recovery;
    const p = t <= move.startup ? t / move.startup : t <= move.startup + move.active ? 1 : 1 - (t - move.startup - move.active) / move.recovery;
    if (f.move === 'light') { fHand = [14 + 28 * p, 45]; fElb = [10 + 14 * p, 44]; bHand = [4, 40]; lean = 2 * p; }
    else if (f.move === 'heavy') { kick = [12 + 26 * p, 24 + 18 * p]; fKnee = [10 + 8 * p, 26 + 6 * p]; lean = -3 * p; fHand = [4, 44]; bHand = [-6, 40]; }
    else { fHand = [16 + 12 * p, 46]; bHand = [14 + 10 * p, 42]; fElb = [10, 46]; bElb = [8, 43]; aura = p; }
    void total;
  }
  if (f.st === 'ko') { ctx.rotate(-1.35); ctx.translate(-4, -2); hipY = 10; shY = 28; headY = 38; headX = 4; fHand = [8, 22]; bHand = [-2, 22]; fFoot = [10, 0]; bFoot = [-8, 0]; fKnee = [6, 6]; bKnee = [-6, 6]; }
  const skin = '#ffd9b0', gi = look.color, pants = look.pants || '#2a2038', hip = [lean * 0.3, Y(hipY)], sh = [lean, Y(shY)];
  const wob = flashT > 0 && Math.floor(flashT) % 2 === 0;
  const body = wob ? '#ffffff' : gi, legc = wob ? '#ffffff' : pants;
  // 뒤쪽 다리·팔
  line(hip[0], hip[1], bKnee[0], Y(bKnee[1]), 6, legc); line(bKnee[0], Y(bKnee[1]), bFoot[0], Y(bFoot[1]), 6, legc);
  line(sh[0], sh[1], bElb[0], Y(bElb[1]), 5, skin); line(bElb[0], Y(bElb[1]), bHand[0], Y(bHand[1]), 5, skin);
  // 몸통 (도복) + 띠
  line(hip[0], hip[1], sh[0], sh[1], 13, body);
  line(hip[0] - 5, hip[1] - 1, hip[0] + 5, hip[1] - 1, 3, wob ? '#fff' : (look.belt || '#c8302a'));
  // 앞쪽 다리
  if (kick) { line(hip[0], hip[1], fKnee[0], Y(fKnee[1]), 6, legc); line(fKnee[0], Y(fKnee[1]), kick[0], Y(kick[1]), 6, legc); ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(kick[0] + 2, Y(kick[1]), 3.4, 0, 7); ctx.fill(); }
  else { line(hip[0], hip[1], fKnee[0], Y(fKnee[1]), 6, legc); line(fKnee[0], Y(fKnee[1]), fFoot[0], Y(fFoot[1]), 6, legc); }
  // 앞쪽 팔
  line(sh[0], sh[1], fElb[0], Y(fElb[1]), 5.5, skin); line(fElb[0], Y(fElb[1]), fHand[0], Y(fHand[1]), 5.5, skin);
  ctx.fillStyle = look.glove || '#e8503a'; ctx.beginPath(); ctx.arc(fHand[0] + 1, Y(fHand[1]), 4.2, 0, 7); ctx.fill();
  if (aura > 0) { ctx.globalAlpha = 0.6 * aura; ctx.fillStyle = '#e6b8ff'; ctx.beginPath(); ctx.arc(fHand[0] + 8, Y(fHand[1]), 10 * aura + 2, 0, 7); ctx.fill(); ctx.globalAlpha = 1; }
  // 머리
  ctx.save(); ctx.translate(headX + lean, Y(headY)); ctx.scale(f.face, 1);
  if (look.emoji) { ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(look.emoji, 0, 0); }
  else { ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.fill(); ctx.fillStyle = '#e8302a'; ctx.fillRect(-9, -4, 18, 3.5); ctx.fillStyle = '#222'; ctx.fillRect(f.face > 0 ? 2 : -5, -1, 3, 3); ctx.fillRect(f.face > 0 ? -2 : -1, 5, 0, 0); }
  ctx.restore();
  ctx.restore();
}

function drawHud() {
  const p = M.f[0], e = M.f[1], o = M.P;
  const bar = (x, w, v, max, col, back, h, y, right) => { ctx.fillStyle = back; ctx.fillRect(x, y, w, h); const fw = Math.max(0, w * v / max); ctx.fillStyle = col; ctx.fillRect(right ? x + w - fw : x, y, fw, h); };
  // 체력
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(0, 0, VW, 36);
  bar(8, 118, p.hp, p.maxHp, p.hp / p.maxHp > 0.3 ? '#4ae86a' : '#ff5a4a', '#3a1a1a', 11, 8, false);
  bar(VW - 126, 118, e.hp, e.maxHp, e.hp / e.maxHp > 0.3 ? '#4ae86a' : '#ff5a4a', '#3a1a1a', 11, 8, true);
  ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.strokeRect(8, 8, 118, 11); ctx.strokeRect(VW - 126, 8, 118, 11);
  // 기와 가드
  bar(8, 118, p.energy, 100, p.energy >= 100 ? '#e6a0ff' : '#ffc83a', '#2a2210', 4, 22, false); bar(VW - 126, 118, e.energy, 100, e.energy >= 100 ? '#e6a0ff' : '#ffc83a', '#2a2210', 4, 22, true);
  if (p.guard > 4) bar(8, 118, p.guard, 100, '#ff8a3a', 'rgba(0,0,0,0)', 2, 28, false);
  if (e.guard > 4) bar(VW - 126, 118, e.guard, 100, '#ff8a3a', 'rgba(0,0,0,0)', 2, 28, true);
  ctx.font = '700 10px -apple-system, sans-serif'; ctx.textBaseline = 'top'; ctx.fillStyle = '#fff';
  ctx.textAlign = 'left'; ctx.fillText('나', 9, 29 - 0); ctx.textAlign = 'right'; ctx.fillText(`${o.emoji} ${o.name}`, VW - 9, 29);
  // 시간과 이긴 판
  ctx.textAlign = 'center'; ctx.font = '900 20px -apple-system, sans-serif'; ctx.fillStyle = '#ffd86a'; ctx.textBaseline = 'middle';
  ctx.fillText(M.tutorial ? '∞' : String(Math.max(0, Math.ceil(M.timer / 60))), VW / 2, 14);
  ctx.font = '12px sans-serif'; const dots = (n, x) => { for (let i = 0; i < 2; i++) { ctx.fillStyle = i < n ? '#ffd23a' : 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(x + i * 11, 33, 3.6, 0, 7); ctx.fill(); } };
  dots(M.wins[0], VW / 2 - 17); dots(M.wins[1], VW / 2 + 7);
}

function render(dt) {
  if (!ctx) return;
  ctx.save(); ctx.clearRect(0, 0, VW, VH);
  if (!M || screen === 'start') { camX = 200; camS = 1.1; drawBackground(); ctx.restore(); return; }
  // 카메라: 두 파이터가 다 보이게, 가까우면 확대
  const a = M.f[0].x, b = M.f[1].x, d = Math.abs(a - b), tgtS = Math.max(0.95, Math.min(1.7, VW * 1.1 / (d + 120))), tgtX = (a + b) / 2;
  camS += (tgtS - camS) * Math.min(1, dt * 6); camX += (tgtX - camX) * Math.min(1, dt * 8);
  const half = VW / 2 / camS; camX = Math.max(half, Math.min(L.W - half, camX));
  if (shake > 0) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake = Math.max(0, shake - dt * 40); }
  drawBackground();
  for (let i = 0; i < 2; i++) { const f = M.f[i]; f.frameNo = (f.frameNo || 0) + 1; if (flash[i] > 0) flash[i] -= dt * 60; }
  const look0 = { color: '#f4f4f4', belt: '#c8302a', glove: '#e8503a', pants: '#2a2038' };
  const look1 = { color: M.P.color, emoji: M.P.emoji, belt: '#222', glove: '#222', pants: '#2a2038', big: M.P.big };
  // 기파
  for (const p of M.proj) { const px = sx(p.x), py = GY - p.y * camS; const g = ctx.createRadialGradient(px, py, 1, px, py, 14 * camS); g.addColorStop(0, '#fff'); g.addColorStop(0.4, p.owner === 0 ? '#9ad8ff' : '#ff9ab8'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, 14 * camS, 0, 7); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(px - Math.sign(p.vx) * 28 * camS, py - 2, 24 * camS, 4); }
  const order = M.f[0].y > M.f[1].y ? [1, 0] : [0, 1];
  for (const i of order) drawFighter(M.f[i], i === 0 ? look0 : look1, flash[i]);
  // 효과
  for (const s of fx) { s.t += dt * 60; const px = sx(s.x), py = GY - s.y * camS, k = s.t / 12; if (k >= 1) continue; ctx.globalAlpha = 1 - k; ctx.strokeStyle = s.kind === 'guard' ? '#9ad8ff' : s.kind === 'guardbreak' ? '#ff9a3a' : '#fff6a0'; ctx.lineWidth = 2.4;
    const n = s.kind === 'spark' ? (s.big ? 9 : 6) : 5, r0 = 4 + k * (s.big ? 22 : 14); for (let i = 0; i < n; i++) { const an = i * 6.283 / n + 0.3; ctx.beginPath(); ctx.moveTo(px + Math.cos(an) * r0 * 0.5, py + Math.sin(an) * r0 * 0.5); ctx.lineTo(px + Math.cos(an) * r0, py + Math.sin(an) * r0); ctx.stroke(); } ctx.globalAlpha = 1; }
  fx = fx.filter((s) => s.t < 12);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 14px -apple-system, sans-serif';
  for (const p of pops) { p.t += dt * 60; const k = p.t / 40; if (k >= 1) continue; ctx.globalAlpha = 1 - k * k; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = p.color; const px = sx(p.x), py = GY - (p.y + k * 18) * camS; ctx.strokeText(p.text, px, py); ctx.fillText(p.text, px, py); ctx.globalAlpha = 1; }
  pops = pops.filter((p) => p.t < 40);
  ctx.restore();
  drawHud();
  // 글자 띠
  if (banner) { banner.t += dt * 60; const k = banner.t / 70; if (k >= 1) banner = null; else { const sc = k < 0.15 ? 0.5 + k / 0.15 * 0.6 : 1.1 - Math.min(0.1, (k - 0.15)); ctx.save(); ctx.translate(VW / 2, 100); ctx.scale(sc, sc); ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1; ctx.font = '900 38px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 7; ctx.strokeStyle = '#4a1a00'; ctx.fillStyle = '#ffd23a'; ctx.strokeText(banner.text, 0, 0); ctx.fillText(banner.text, 0, 0); if (banner.sub) { ctx.font = '800 14px -apple-system, sans-serif'; ctx.lineWidth = 4; ctx.strokeText(banner.sub, 0, 28); ctx.fillStyle = '#fff'; ctx.fillText(banner.sub, 0, 28); } ctx.restore(); } }
  $('bSp').classList.toggle('ready', M.f[0].energy >= 100);
}

showLadder(); resize(); requestAnimationFrame(frame);
setTimeout(resize, 50);

/* @test-hooks:start */
window.__ft = { get M() { return M; }, get screen() { return screen; }, get level() { return level; }, get best() { return best; }, tick, startMatch, hold, render, handle, get paused() { return paused; }, setPaused };
/* @test-hooks:end */
