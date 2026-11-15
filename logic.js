'use strict';
// 작은 격투의 규칙. 화면이 없고, 1/60초 한 칸씩 진행한다 (같은 입력이면 언제나 같은 결과).
// 세계는 가로 0~400 (왼쪽에서 오른쪽), y 는 땅에서 얼마나 떠 있나. 파이터 둘이 마주 서서 싸운다.
const LOGIC_FT = (() => {
  const W = 400, BODY = 14, SEP = 30, GRAV = 0.55, JUMPV = 9.5, FPS = 60;
  const ROUND_FRAMES = 60 * 60, INTRO = 100, END = 150, MAXHP = 100;
  // 기술: startup=맞추기 전 준비, active=맞는 구간, recovery=끝나고 빈틈. reach=닿는 거리(몸 가운데끼리)
  const MOVES = {
    light: { startup: 4, active: 3, recovery: 8, dmg: 6, reach: 40, hitstun: 16, blockstun: 8, push: 2.5, gain: 8, guard: 10, hs: 4 },
    heavy: { startup: 11, active: 4, recovery: 20, dmg: 14, reach: 50, hitstun: 24, blockstun: 14, push: 6.5, gain: 12, guard: 34, hs: 8 },
    // 필살기 세 가지: special=기파(멀리 날아감), rush=돌진 펀치(앞으로 달려 침), rise=승룡(위로 솟으며 침, 솟는 동안 무적)
    special: { startup: 12, active: 1, recovery: 26, dmg: 22, reach: 0, hitstun: 30, blockstun: 12, push: 7, gain: 0, guard: 26, speed: 5, hs: 9 },
    rush: { startup: 10, active: 12, recovery: 24, dmg: 18, reach: 38, hitstun: 30, blockstun: 14, push: 8, gain: 0, guard: 36, speed: 4.6, hs: 9, hi: 50 },
    rise: { startup: 5, active: 6, recovery: 30, dmg: 20, reach: 34, hitstun: 46, blockstun: 16, push: 3, gain: 0, guard: 40, hs: 10, hi: 105, launch: 9, inv: 11 },
  };
  const SPECIAL_MOVES = { special: 1, rush: 1, rise: 1 };
  // 내가 고르는 파이터 3명 (체력·걷기 속도·공격 세기가 다르고 필살기가 달라요)
  const ROSTER = [
    { name: '도장 제자', emoji: '🥋', tag: '고르게 강해요 · 필살 기파', hp: 100, speed: 1.0, dmg: 1.0, spk: 'special', color: '#f4f4f4', belt: '#c8302a', glove: '#e8503a', hair: '#2a1a14' },
    { name: '번개 닌자', emoji: '🥷', tag: '빠르고 가벼워요 · 필살 돌진', hp: 88, speed: 1.18, dmg: 0.95, spk: 'rush', color: '#2b3a7a', belt: '#ffd23a', glove: '#4a6aff', hair: '#111' },
    { name: '철권 곰', emoji: '🐻', tag: '느리지만 튼튼해요 · 필살 승룡', hp: 118, speed: 0.86, dmg: 1.12, spk: 'rise', color: '#8a4a2a', belt: '#222', glove: '#c8302a', hair: '#5a3a22' },
  ];
  const CHIP = 0.12, GUARD_MAX = 100, GB_STUN = 50, DASH_F = 12, DASH_B = 14;

  // 컴퓨터 상대 5명. react=결정하는 간격(작을수록 빠름), aggr=다가갈 확률, pL/pH=약/강 비율, pBlock=막을 확률, pJump=점프 확률
  const OPPONENTS = [
    { name: '꼬마', emoji: '🐣', color: '#ffd23a', tag: '아직 서툴러요', hp: 80, dmg: 0.8, react: 26, aggr: 0.4, pL: 0.8, pH: 0.2, pBlock: 0.08, pJump: 0.04, spec: false, spk: 'special', dash: 0, punish: 0.1, space: 44, speed: 0.9 },
    { name: '돌진이', emoji: '🐗', color: '#e8503a', tag: '무조건 달려들어요', hp: 100, dmg: 1.0, react: 18, aggr: 0.9, pL: 0.3, pH: 0.7, pBlock: 0.05, pJump: 0.1, spec: true, spk: 'rush', dash: 0.2, punish: 0.2, space: 40, speed: 1.0 },
    { name: '거북이', emoji: '🐢', color: '#3aa860', tag: '막고 있다 한 방', hp: 100, dmg: 1.0, react: 12, aggr: 0.5, pL: 0.4, pH: 0.6, pBlock: 0.75, pJump: 0.04, spec: true, spk: 'rise', dash: 0, punish: 0.75, space: 58, speed: 0.95 },
    { name: '날쌘돌이', emoji: '🐇', color: '#4a9bff', tag: '뛰어오르며 몰아쳐요', hp: 100, dmg: 1.0, react: 9, aggr: 0.85, pL: 0.8, pH: 0.2, pBlock: 0.3, pJump: 0.3, spec: true, spk: 'special', dash: 0.3, punish: 0.45, space: 44, speed: 1.15 },
    { name: '대장', emoji: '🦁', color: '#a860e8', tag: '모든 걸 다 해요', hp: 120, dmg: 1.1, react: 9, aggr: 0.7, pL: 0.5, pH: 0.5, pBlock: 0.45, pJump: 0.18, spec: true, spk: 'mix', dash: 0.2, punish: 0.6, space: 46, speed: 1.05, big: true },
  ];
  // 튜토리얼의 연습 상대: 맞아도 거의 안 아프고, 가만히 있다가 가끔 약하게 친다
  const DUMMY = { name: '연습 상대', emoji: '🥋', color: '#bbbbbb', tag: '연습', hp: 400, dmg: 0.1, react: 60, aggr: 0.05, pL: 1, pH: 0, pBlock: 0, pJump: 0, spec: false, spk: 'special', dash: 0, punish: 0, space: 44, speed: 0.6, passive: true };

  const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  function mkFighter(id, x, face, maxHp, dmgMul) {
    return { id, x, y: 0, vy: 0, vx: 0, face, hp: maxHp, maxHp, energy: 0, guard: 0, st: 'idle', t: 0, move: null, hitDone: false, connected: false, chain: 0, inv: 0, dd: 0, dlen: 0, stun: 0, hitCount: 0, walk: 0, prev: {}, buf: { light: 0, heavy: 0, jump: 0, special: 0, dash: 0 }, dmgMul, speedMul: 1, spk: 'special' };
  }
  const idleInput = () => ({ left: false, right: false, light: false, heavy: false, block: false, jump: false, special: false, dash: 0 });

  // opts: { opp: 0~4 | -1(연습), seed, tutorial }
  function newMatch(opts = {}) {
    const tutorial = !!opts.tutorial, oi = tutorial ? -1 : (opts.opp || 0);
    const P = tutorial ? DUMMY : OPPONENTS[oi], hi = tutorial ? 0 : Math.max(0, Math.min(ROSTER.length - 1, opts.hero | 0)), H = ROSTER[hi];
    const M = { opp: oi, P, hero: hi, H, tutorial, hs: 0, rng: rng(opts.seed == null ? 1 : opts.seed), f: [mkFighter(0, 140, 1, H.hp, H.dmg), mkFighter(1, 260, -1, P.hp, P.dmg)], proj: [], phase: 'intro', pt: 0, round: 1, wins: [0, 0], timer: ROUND_FRAMES, events: [], result: null, winner: null, frame: 0, ai: { inp: idleInput(), wait: 0, seen: 0 } };
    M.f[0].speedMul = H.speed; M.f[0].spk = H.spk; M.f[1].spk = P.spk || 'special';
    if (tutorial) { M.f[0].dmgMul = 1; M.f[1].dmgMul = 0.1; M.introLen = 20; }
    return M;
  }
  function resetRound(M) {
    const p = M.f[0], e = M.f[1];
    for (const [f, x, face] of [[p, 140, 1], [e, 260, -1]]) { Object.assign(f, { x, y: 0, vy: 0, vx: 0, face, hp: f.maxHp, guard: 0, st: 'idle', t: 0, move: null, hitDone: false, connected: false, chain: 0, inv: 0, dd: 0, stun: 0, hitCount: 0, walk: 0 }); f.buf = { light: 0, heavy: 0, jump: 0, special: 0, dash: 0 }; f.prev = {}; }
    M.hs = 0; M.proj = []; M.timer = ROUND_FRAMES; M.winner = null; M.phase = 'intro'; M.pt = 0; M.ai.wait = 20; M.ai.inp = idleInput();
  }

  const free = (f) => f.st === 'idle' || f.st === 'block' || f.st === 'air';
  function startAttack(M, f, name) {
    f.st = 'atk'; f.move = name; f.t = 0; f.hitDone = false; f.connected = false; f.walk = 0;
    f.buf.light = f.buf.heavy = f.buf.special = 0;
    if (MOVES[name].inv) f.inv = MOVES[name].inv;
    if (SPECIAL_MOVES[name]) { f.energy = 0; M.events.push({ t: 'special', id: f.id, kind: name }); }
    else M.events.push({ t: 'swing', id: f.id, move: name });
  }
  function startDash(M, f, dir) {
    const fwd = dir === f.face;
    f.st = 'dash'; f.t = 0; f.dd = dir; f.dlen = fwd ? DASH_F : DASH_B; f.walk = 0; f.buf.dash = 0; f.buf.jump = 0;
    if (!fwd) f.inv = 7;
    M.events.push({ t: 'dash', id: f.id, dir, back: !fwd, x: f.x });
  }
  // 버튼을 누른 순간을 몇 칸 동안 기억해 둔다 (멈춤 중에도 눌린 것이 사라지지 않게)
  function readBuf(f, inp, decay) {
    for (const k of ['light', 'heavy', 'jump', 'special', 'dash']) if (decay && f.buf[k] > 0) f.buf[k]--;
    for (const k of ['light', 'heavy', 'jump', 'special']) { if (inp[k] && !f.prev[k]) f.buf[k] = 7; f.prev[k] = !!inp[k]; }
    if (inp.dash) { f.buf.dash = 7; f.dd = inp.dash > 0 ? 1 : -1; }
  }
  function fighterStep(M, f, o, inp) {
    readBuf(f, inp, true);
    f.t++; if (f.inv > 0) f.inv--;
    f.energy = Math.min(100, f.energy + (M.tutorial && f.id === 0 ? 1.5 : 0.045));
    if (f.st !== 'block' && f.st !== 'bs') f.guard = Math.max(0, f.guard - 0.3);
    if (f.st === 'ko') { /* 물리만 */ }
    else if (f.stun > 0) { f.stun--; if (f.stun === 0) f.st = f.y > 0 ? 'air' : 'idle'; }
    else if (f.st === 'atk') {
      const m = MOVES[f.move], act = f.t > m.startup && f.t <= m.startup + m.active;
      if (f.move === 'special' && f.t === m.startup) M.proj.push({ owner: f.id, x: f.x + f.face * 22, y: 22, vx: f.face * m.speed, dmg: m.dmg * f.dmgMul });
      if (f.move === 'rush' && act && (Math.abs(o.x - f.x) > SEP - 2 || o.y > 50)) f.x += f.face * m.speed;
      if (f.move === 'rise' && f.t === m.startup) { f.vy = 7.5; f.y = Math.max(f.y, 0.5); }
      // 맞혔으면 끊어서 다음 기술로 (약→약→약, 약→강, 아무 기술→필살기)
      if (f.connected && f.t > m.startup + m.active - 1 && f.y === 0) {
        if (f.buf.special && f.energy >= 100 && !SPECIAL_MOVES[f.move]) startAttack(M, f, f.spk);
        else if (f.move === 'light' && f.buf.heavy) startAttack(M, f, 'heavy');
        else if (f.move === 'light' && f.buf.light && f.chain < 2) { f.chain++; startAttack(M, f, 'light'); }
      }
      if (f.st === 'atk' && f.t >= MOVES[f.move].startup + MOVES[f.move].active + MOVES[f.move].recovery) { f.st = f.y > 0 ? 'air' : 'idle'; f.move = null; }
    } else if (f.st === 'dash') {
      const fwd = f.dd === f.face, sp = (fwd ? 5.4 : 4.8) * (1 - 0.45 * f.t / f.dlen) * (f.speedMul || 1);
      f.x += f.dd * sp;
      if (fwd && f.t >= 5 && (f.buf.heavy || f.buf.light)) startAttack(M, f, f.buf.heavy ? 'heavy' : 'light');
      else if (f.t >= f.dlen) f.st = 'idle';
    } else {
      // 할 수 있는 상태: 기술, 점프, 막기, 걷기
      f.chain = 0;
      if (f.y === 0 && f.st !== 'air') f.face = Math.sign(o.x - f.x) || f.face;
      if (f.buf.special && f.energy >= 100 && f.y === 0) startAttack(M, f, f.spk);
      else if (f.buf.heavy) startAttack(M, f, 'heavy');
      else if (f.buf.light) startAttack(M, f, 'light');
      else if (f.buf.dash && f.y === 0 && f.st !== 'air') startDash(M, f, f.dd || f.face);
      else if (f.buf.jump && f.y === 0) { f.vy = JUMPV; f.st = 'air'; f.buf.jump = 0; f.walk = 0; M.events.push({ t: 'jump', id: f.id, x: f.x }); }
      else if (inp.block && f.y === 0 && f.st !== 'air') { f.st = 'block'; f.walk = 0; }
      else {
        if (f.st === 'block') f.st = 'idle';
        const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), sp = (f.y > 0 ? 1.7 : 2.3) * (f.speedMul || 1) * (dir === -f.face ? 0.8 : 1);
        f.x += dir * sp; f.walk = dir;
      }
    }
    // 물리
    if (f.y > 0 || f.vy !== 0) { f.y += f.vy; f.vy -= GRAV; if (f.y <= 0) { const hard = f.vy < -5; f.y = 0; f.vy = 0; if (f.st === 'air') f.st = 'idle'; if (f.st === 'ko') f.vx = 0; if (hard) M.events.push({ t: 'land', id: f.id, x: f.x }); } }
    f.x += f.vx; f.vx *= 0.8; if (Math.abs(f.vx) < 0.05) f.vx = 0;
    f.x = Math.max(BODY, Math.min(W - BODY, f.x));
    if (f.st !== 'hit' && f.st !== 'ko') f.hitCount = 0;
  }

  // 맞았을 때 (막았는지, 몇 대째인지 따져서 피해를 준다). 돌려주는 것: 'hit' | 'block' | 'gbreak'
  function applyHit(M, att, def, mv, dmgBase, kind) {
    const dir = Math.sign(def.x - att.x) || att.face;
    const guarding = def.st === 'block' && def.y === 0 && def.face === -dir;
    if (guarding) {
      const chip = Math.max(1, Math.round(dmgBase * CHIP)); def.hp = Math.max(1, def.hp - chip);
      def.guard += mv.guard; def.vx += dir * mv.push * 0.5; att.vx -= dir * (kind === 'proj' ? 0 : 1.2);
      def.stun = mv.blockstun; def.energy = Math.min(100, def.energy + 3); M.hs = Math.max(M.hs, 3 + (mv.hs > 7 ? 2 : 0));
      if (def.guard >= GUARD_MAX) { def.guard = 0; def.st = 'gb'; def.stun = GB_STUN; M.events.push({ t: 'gbreak', id: def.id, x: def.x }); return 'gbreak'; }
      def.st = 'bs';
      M.events.push({ t: 'block', id: def.id, x: def.x, att: att.id }); return 'block';
    }
    const scale = Math.max(0.4, 1 - 0.2 * def.hitCount);
    const dmg = Math.max(1, Math.round(dmgBase * scale));
    def.hp = Math.max(0, def.hp - dmg); def.hitCount++; def.st = 'hit'; def.stun = mv.hitstun; def.move = null; def.vx += dir * mv.push;
    if (def.y > 0) def.vy = Math.max(def.vy, 3);
    if (mv.launch) { def.vy = mv.launch; def.y = Math.max(def.y, 0.5); def.vx += dir * 1.5; }
    M.hs = Math.max(M.hs, mv.hs || 4);
    att.energy = Math.min(100, att.energy + mv.gain); def.energy = Math.min(100, def.energy + 5);
    M.events.push({ t: 'hit', id: def.id, att: att.id, dmg, x: def.x, y: def.y, kind, big: mv.dmg >= 14, launch: !!mv.launch, move: kind === 'proj' ? 'special' : att.move });
    if (def.hitCount >= 2) M.events.push({ t: 'combo', id: att.id, n: def.hitCount });
    if (def.hp <= 0) { def.st = 'ko'; def.stun = 0; def.vy = 6; def.vx = dir * 6; M.hs = 20; M.events.push({ t: 'ko', id: def.id }); }
    return 'hit';
  }
  function resolveAttacks(M) {
    for (const f of M.f) {
      if (f.st !== 'atk' || f.hitDone || f.move === 'special') continue;
      const m = MOVES[f.move];
      if (f.t <= m.startup || f.t > m.startup + m.active) continue;
      const d = M.f[1 - f.id]; if (d.st === 'ko' || d.inv > 0) continue;
      const dist = (d.x - f.x) * f.face;
      const lo = f.y > 0 ? f.y - 15 : 0, hi = f.y + (m.hi || 45);
      if (dist >= -5 && dist <= m.reach && hi >= d.y && lo <= d.y + 60) { f.hitDone = true; if (applyHit(M, f, d, m, m.dmg * f.dmgMul, 'melee') === 'hit') f.connected = true; }
    }
  }
  function stepProj(M) {
    for (const p of M.proj) p.x += p.vx;
    for (let i = 0; i < M.proj.length; i++) for (let j = i + 1; j < M.proj.length; j++) {
      const a = M.proj[i], b = M.proj[j]; if (a.owner !== b.owner && !a.dead && !b.dead && Math.abs(a.x - b.x) < 14) { a.dead = b.dead = true; M.events.push({ t: 'clash', x: (a.x + b.x) / 2 }); }
    }
    for (const p of M.proj) {
      if (p.dead) continue;
      if (p.x < -10 || p.x > W + 10) { p.dead = true; continue; }
      const d = M.f[1 - p.owner]; if (d.st === 'ko' || d.inv > 0) continue;
      if (Math.abs(p.x - d.x) < BODY + 6 && d.y <= 45) { p.dead = true; applyHit(M, M.f[p.owner], d, MOVES.special, p.dmg, 'proj'); }
    }
    M.proj = M.proj.filter((p) => !p.dead);
  }
  function separate(M) {
    const a = M.f[0], b = M.f[1];
    if (Math.abs(a.y - b.y) > 50) return;
    const dx = b.x - a.x, ov = SEP - Math.abs(dx); if (ov <= 0) return;
    const dir = dx !== 0 ? Math.sign(dx) : (a.face || 1);
    a.x -= dir * ov / 2; b.x += dir * ov / 2;
    // 벽에 몰리면 남은 만큼 상대가 더 밀려난다
    if (a.x < BODY) { b.x += BODY - a.x; a.x = BODY; }
    if (b.x > W - BODY) { a.x -= b.x - (W - BODY); b.x = W - BODY; }
    if (a.x > W - BODY) { b.x -= a.x - (W - BODY); a.x = W - BODY; }
    if (b.x < BODY) { a.x += BODY - b.x; b.x = BODY; }
    a.x = Math.max(BODY, Math.min(W - BODY, a.x)); b.x = Math.max(BODY, Math.min(W - BODY, b.x));
  }

  // ---------- 컴퓨터 ----------
  function incomingProj(M, me) { return M.proj.some((p) => p.owner !== me.id && Math.abs(p.x - me.x) < 120 && Math.sign(me.x - p.x) === Math.sign(p.vx)); }
  function aiInput(M) {
    const a = M.ai, P = M.P, me = M.f[1], pl = M.f[0], r = M.rng, inp = a.inp;
    inp.light = inp.heavy = inp.jump = inp.special = false; inp.dash = 0;
    if (a.off) { inp.left = inp.right = inp.block = false; return inp; }      // 시험용: 컴퓨터를 끈다
    if (P.passive) {                                                         // 연습 상대: 제자리에 서서 가끔 약하게 친다 (움직이지 않아야 처음 하는 사람도 맞힌다)
      inp.left = inp.right = inp.block = false;
      if (Math.abs(pl.x - me.x) > MOVES.light.reach + 6) a.seen = 0; else if (free(me) && ++a.seen > 100) { inp.light = true; a.seen = 0; }   // 가까이 온 지 1.7초 뒤에야 약하게 친다
      return inp;
    }
    me.speedMul = P.speed;
    const dist = Math.abs(pl.x - me.x), toward = Math.sign(pl.x - me.x) || 1;
    const plAtk = pl.st === 'atk' && pl.move !== 'special', mv = plAtk ? MOVES[pl.move] : null;
    const threat = plAtk && dist <= mv.reach + 14 && pl.t <= mv.startup + mv.active;
    a.seen = threat ? a.seen + 1 : 0;
    if (!free(me)) return inp;
    // 빠르게 반응해야 하는 것: 강공격(준비가 길다)이나 날아오는 기파
    if ((threat && (pl.move === 'heavy' || pl.move === 'rush') && a.seen >= Math.max(2, P.react * 0.4) && r() < P.pBlock + 0.15) || (incomingProj(M, me) && a.blockT === undefined && r() < 0.5 + P.pBlock * 0.4)) {
      if (incomingProj(M, me) && r() < P.pJump + 0.2) { inp.jump = true; inp.left = inp.right = false; } else { inp.block = true; inp.left = inp.right = false; a.wait = 10; }
      return inp;
    }
    if (a.wait > 0) { a.wait--; return inp; }
    a.wait = Math.round(P.react * (0.6 + r() * 0.8));
    inp.left = inp.right = inp.block = false;
    // 상대가 크게 헛친 뒤(끝 동작)를 노린다
    if (pl.st === 'atk' && pl.t > MOVES[pl.move || 'light'].startup + MOVES[pl.move || 'light'].active && dist <= 52 && pl.move !== 'special' && r() < P.punish) { inp[P.pH > 0.5 && r() < 0.7 ? 'heavy' : 'light'] = true; a.wait = 6; return inp; }
    if (P.spec && me.energy >= 100) {                       // 필살기: 종류마다 쓰는 거리가 달라요
      const kind = P.spk === 'mix' ? (dist > 110 ? 'special' : dist > 56 ? 'rush' : 'rise') : P.spk;
      const ok = kind === 'special' ? dist > 80 && r() < 0.7 : kind === 'rush' ? dist > 52 && dist < 150 && r() < 0.5 : dist <= 56 && (pl.y > 0 || (pl.st === 'atk' && pl.t > 3) || r() < 0.2);
      if (ok) { me.spk = kind; inp.special = true; a.wait = 24; return inp; }
    }
    if (P.dash && dist > 110 && r() < P.dash) { inp.dash = toward; a.wait = 16; return inp; }
    if (dist > MOVES.heavy.reach) { if (r() < P.aggr) { if (toward > 0) inp.right = true; else inp.left = true; a.wait = Math.max(a.wait, 8); } else if (r() < P.pBlock * 0.3) inp.block = true; return inp; }
    if (dist <= MOVES.heavy.reach) {
      const roll = r();
      if (roll < 0.12 + P.pBlock * 0.35 && P.pBlock > 0.1) { inp.block = true; a.wait = Math.max(a.wait, 12); }
      else if (roll < 0.12 + P.pBlock * 0.35 + P.pJump * 0.5) { inp.jump = true; if (toward > 0) inp.right = true; else inp.left = true; }
      else if (roll < 0.35 + P.aggr * 0.6) { const kind = r() < P.pL ? 'light' : 'heavy'; if (dist <= MOVES[kind].reach + 4) inp[kind] = true; else { if (toward > 0) inp.right = true; else inp.left = true; } }
      else { if (toward > 0) inp.left = true; else inp.right = true; }   // 한 걸음 물러남
      return inp;
    }
    return inp;
  }

  // ---------- 한 칸 진행 ----------
  // humanInput: { left,right,light,heavy,block,jump,special } (플레이어). 돌려주는 것: M (events 에 이번 칸 일이 담긴다)
  function step(M, humanInput) {
    M.events = []; M.frame++;
    const hi = humanInput || idleInput();
    if (M.phase === 'intro') {
      M.pt++; if (M.pt >= (M.introLen || INTRO)) { M.phase = 'fight'; M.pt = 0; M.events.push({ t: 'fight' }); }
      return M;
    }
    if (M.phase === 'fight' || M.phase === 'end') {
      const fighting = M.phase === 'fight';
      if (M.hs > 0) { M.hs--; readBuf(M.f[0], fighting ? hi : idleInput(), false); return M; }      // 때린 순간 잠깐 멈춤 (타격감)
      const ei = fighting ? aiInput(M) : idleInput();
      fighterStep(M, M.f[0], M.f[1], fighting ? hi : idleInput());
      fighterStep(M, M.f[1], M.f[0], ei);
      if (fighting) resolveAttacks(M);
      stepProj(M); separate(M);
      if (fighting) {
        if (!M.tutorial) M.timer--;
        const p = M.f[0], e = M.f[1];
        if (p.hp <= 0 || e.hp <= 0 || M.timer <= 0) endRound(M);
        if (M.tutorial && p.hp <= 0) p.hp = 1;      // 연습에서는 쓰러지지 않는다
      } else {
        M.pt++;
        if (M.pt >= END) afterRound(M);
      }
    }
    return M;
  }
  function endRound(M) {
    const p = M.f[0], e = M.f[1];
    let w = -1;
    if (p.hp <= 0 && e.hp <= 0) w = -1; else if (e.hp <= 0) w = 0; else if (p.hp <= 0) w = 1;
    else { const pr = p.hp / p.maxHp, er = e.hp / e.maxHp; w = Math.abs(pr - er) < 1e-9 ? -1 : (pr > er ? 0 : 1); }
    M.winner = w; M.phase = 'end'; M.pt = 0;
    if (w >= 0) M.wins[w]++; else { M.wins[0]++; M.wins[1]++; }
    M.events.push({ t: 'roundEnd', winner: w, time: M.timer <= 0 });
  }
  function afterRound(M) {
    const [a, b] = M.wins;
    if (((a >= 2 || b >= 2) && a !== b) || M.round >= 7) {
      M.phase = 'match'; M.result = a > b ? 'win' : 'lose'; M.events.push({ t: 'matchEnd', result: M.result });
    } else { M.round++; resetRound(M); M.events.push({ t: 'round', n: M.round }); }
  }

  return { W, BODY, SEP, FPS, ROUND_FRAMES, MOVES, ROSTER, SPECIAL_MOVES, OPPONENTS, DUMMY, MAXHP, GUARD_MAX, rng, newMatch, step, idleInput, free, resetRound };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = LOGIC_FT;
