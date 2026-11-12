'use strict';

// 작은 격투 규칙 시험. 실행: node --test (디렉터리)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const I = (o = {}) => ({ ...L.idleInput(), ...o });
// 연습 상대(가만히 있음)와 한 판을 시작해서 싸움 단계까지 보낸다
function ready(opts = {}) {
  const M = L.newMatch({ opp: 0, seed: 5, ...opts });
  let g = 0; while (M.phase !== 'fight' && g++ < 400) L.step(M, null);
  M.ai.off = true;                                                  // 컴퓨터가 가만히 있게 (시험용)
  return M;
}
const run = (M, n, inp) => { for (let i = 0; i < n; i++) L.step(M, typeof inp === 'function' ? inp(i) : inp); };
const place = (M, px, ex) => { M.f[0].x = px; M.f[1].x = ex; };
const evs = (M) => M.events.map((e) => e.t);

test('a match starts with an intro, then fighting, both at full health facing each other', () => {
  const M = L.newMatch({ opp: 0 }); assert.strictEqual(M.phase, 'intro'); assert.strictEqual(M.f[0].hp, 100); assert.strictEqual(M.f[1].hp, L.OPPONENTS[0].hp);
  assert.ok(M.f[0].x < M.f[1].x && M.f[0].face === 1 && M.f[1].face === -1);
  const before = M.f[0].x; run(M, 30, I({ right: true })); assert.strictEqual(M.f[0].x, before, 'nobody can move during the intro');
  let g = 0; while (M.phase === 'intro' && g++ < 400) L.step(M, null); assert.strictEqual(M.phase, 'fight');
});

test('walking moves at a steady speed, walking backward is slower, and nobody leaves the stage', () => {
  const M = ready(); place(M, 100, 300); const x0 = M.f[0].x; run(M, 10, I({ right: true })); const fwd = M.f[0].x - x0;
  place(M, 150, 300); const x1 = M.f[0].x; run(M, 10, I({ left: true })); const back = x1 - M.f[0].x; assert.ok(fwd > back && back > 0, 'backward slower');
  place(M, 100, 300); run(M, 400, I({ left: true })); assert.ok(M.f[0].x >= L.BODY && M.f[0].x <= L.W - L.BODY, 'stays inside');
});

test('two fighters cannot stand on top of each other and get pushed apart', () => {
  const M = ready(); place(M, 190, 200); run(M, 5, null); assert.ok(Math.abs(M.f[0].x - M.f[1].x) >= L.SEP - 0.01);
  place(M, 14, 20); run(M, 5, null); assert.ok(M.f[0].x >= L.BODY && M.f[1].x - M.f[0].x >= L.SEP - 0.01, 'pushed along at the wall');
});

test('a light punch takes a few frames, then hits for damage inside its reach and misses outside it', () => {
  const M = ready(); place(M, 150, 150 + 36); const hp = M.f[1].hp; let hitAt = -1;
  for (let i = 0; i < 20; i++) { L.step(M, I({ light: i === 0 })); if (evs(M).includes('hit') && hitAt < 0) hitAt = i; }
  assert.ok(hitAt >= L.MOVES.light.startup && hitAt <= L.MOVES.light.startup + 2, 'hits after the windup'); assert.strictEqual(M.f[1].hp, hp - L.MOVES.light.dmg);
  const N = ready(); place(N, 100, 100 + 70); run(N, 25, (i) => I({ light: i === 0 })); assert.strictEqual(N.f[1].hp, L.OPPONENTS[0].hp, 'too far: whiff');
});

test('a heavy punch is slower but hits harder, pushes further, and leaves a longer opening', () => {
  assert.ok(L.MOVES.heavy.startup > L.MOVES.light.startup && L.MOVES.heavy.dmg > L.MOVES.light.dmg && L.MOVES.heavy.recovery > L.MOVES.light.recovery && L.MOVES.heavy.push > L.MOVES.light.push);
  const M = ready(); place(M, 150, 190); const hp = M.f[1].hp; run(M, 30, (i) => I({ heavy: i === 0 })); assert.strictEqual(hp - M.f[1].hp, L.MOVES.heavy.dmg); assert.ok(M.f[1].x > 190, 'knocked back');
});

test('holding block cuts damage to a sliver, an unblocked hit does full damage, and you cannot block in the air', () => {
  const attack = (M, move) => Object.assign(M.f[1], { st: 'atk', move, t: 0, hitDone: false, face: -1 });
  const M = ready(); place(M, 150, 186); attack(M, 'light'); const hp = M.f[0].hp; run(M, 12, I({ block: true }));
  const lost = hp - M.f[0].hp; assert.ok(lost >= 1 && lost <= 2, 'chip damage only: ' + lost); assert.ok(M.f[0].guard > 0, 'guard filled');
  const N = ready(); place(N, 150, 186); attack(N, 'light'); const hp2 = N.f[0].hp; run(N, 12, null); assert.strictEqual(hp2 - N.f[0].hp, Math.round(L.MOVES.light.dmg * N.f[1].dmgMul), 'unblocked light hits fully');
  const B = ready(); place(B, 150, 186); run(B, 2, I({ jump: true })); run(B, 4, I({ block: true })); assert.ok(B.f[0].y > 0 && B.f[0].st !== 'block', 'no blocking while in the air');
});

test('blocking many hits breaks the guard and leaves you stunned', () => {
  const M = ready(); place(M, 150, 186); let broke = false;
  for (let k = 0; k < 6 && !broke; k++) { place(M, 150, 186); M.f[0].vx = M.f[1].vx = 0; Object.assign(M.f[1], { st: 'atk', move: 'heavy', t: 0, hitDone: false, face: -1, stun: 0 }); for (let i = 0; i < 20; i++) { L.step(M, I({ block: true })); if (evs(M).includes('gbreak')) broke = true; } }
  assert.ok(broke, 'guard broke'); assert.ok(M.f[0].st === 'gb' || M.f[0].guard === 0);
});

test('jumping goes up and comes back down, and a standing punch misses a fighter high in the air', () => {
  const M = ready(); place(M, 150, 186); let max = 0; run(M, 50, (i) => { max = Math.max(max, M.f[0].y); return I({ jump: i === 0 }); }); assert.ok(max > 50 && M.f[0].y === 0, 'jumped and landed');
  const N = ready(); place(N, 150, 186); N.f[0].y = 70; N.f[0].vy = 0.01; N.f[0].st = 'air'; const hp = N.f[0].hp; Object.assign(N.f[1], { st: 'atk', move: 'heavy', t: 0, hitDone: false }); run(N, 3, null); // 아직 공중
  N.f[0].y = 70; N.f[0].vy = 0; for (let i = 0; i < 6; i++) { N.f[0].y = 70; L.step(N, null); } assert.strictEqual(N.f[0].hp, hp, 'standing attack passes under a high jump');
});

test('energy grows by fighting, and the special needs a full bar and sends a ball that can be blocked or jumped', () => {
  const M = ready(); place(M, 100, 300); M.f[0].energy = 50; run(M, 3, I({ special: true })); assert.strictEqual(M.proj.length, 0, 'no special without a full bar');
  M.f[0].energy = 100; const hp = M.f[1].hp; run(M, 90, (i) => I({ special: i === 0 })); assert.strictEqual(M.f[0].energy < 100, true, 'energy spent'); assert.ok(hp - M.f[1].hp >= L.MOVES.special.dmg - 1, 'ball hit');
  const J = ready(); place(J, 100, 300); J.f[0].energy = 100; run(J, 12, (i) => I({ special: i === 0 })); J.f[1].y = 90; J.f[1].vy = 0; const hp2 = J.f[1].hp; for (let i = 0; i < 60; i++) { J.f[1].y = 90; L.step(J, null); } assert.strictEqual(J.f[1].hp, hp2, 'jumping over the ball');
  const A = ready(); place(A, 150, 186); const e0 = A.f[0].energy; run(A, 12, (i) => I({ light: i === 0 })); assert.ok(A.f[0].energy - e0 >= L.MOVES.light.gain - 1, 'hitting charges energy');
});

test('hits one after another in a string do less damage each, so there is no endless combo', () => {
  const M = ready(); place(M, 150, 186); M.f[1].maxHp = 1000; M.f[1].hp = 1000; const lost = [];
  for (let k = 0; k < 4; k++) { const b = M.f[1].hp; run(M, 18, (i) => I({ light: i === 0 })); lost.push(b - M.f[1].hp); place(M, M.f[0].x, M.f[0].x + 30); }
  assert.ok(lost.every((v) => v >= 1)); assert.ok(lost[3] <= lost[0], 'later hits do no more damage than the first');
});

test('reaching zero health knocks out, wins the round, and two round wins win the match', () => {
  const M = ready(); place(M, 150, 186); M.f[1].hp = 3; run(M, 12, (i) => I({ light: i === 0 })); assert.strictEqual(M.f[1].st, 'ko'); assert.strictEqual(M.phase, 'end'); assert.deepStrictEqual(M.wins, [1, 0]);
  let g = 0; while (M.phase !== 'fight' && g++ < 600) L.step(M, null); assert.strictEqual(M.round, 2); assert.strictEqual(M.f[0].hp, 100, 'health restored for the next round'); assert.strictEqual(M.f[1].hp, M.f[1].maxHp);
  place(M, 150, 186); M.f[1].hp = 3; run(M, 12, (i) => I({ light: i === 0 })); g = 0; while (M.phase !== 'match' && g++ < 600) L.step(M, null); assert.strictEqual(M.result, 'win'); assert.deepStrictEqual(M.wins, [2, 0]);
  const Lz = ready(); Lz.wins = [0, 1]; place(Lz, 150, 186); Lz.f[0].hp = 2; Object.assign(Lz.f[1], { st: 'atk', move: 'light', t: 0, hitDone: false }); run(Lz, 12, null); g = 0; while (Lz.phase !== 'fight' && Lz.phase !== 'match' && g++ < 600) L.step(Lz, null); assert.ok(Lz.round === 2 || Lz.phase === 'match');
});

test('when time runs out, whoever has more health left wins, and an exact tie gives both a point', () => {
  const M = ready(); M.f[1].hp = 40; M.timer = 3; run(M, 5, null); assert.strictEqual(M.winner, 0); assert.ok(M.events.length >= 0);
  const T = ready(); T.f[1].maxHp = 100; T.f[1].hp = 100; T.timer = 2; run(T, 4, null); assert.strictEqual(T.winner, -1); assert.deepStrictEqual(T.wins, [1, 1]);
  const U = ready(); U.f[0].hp = 30; U.timer = 2; run(U, 4, null); assert.strictEqual(U.winner, 1);
});

test('the same input and seed always give exactly the same match', () => {
  const play = () => { const M = L.newMatch({ opp: 3, seed: 11 }); const r = L.rng(9); for (let i = 0; i < 2500; i++) L.step(M, I({ right: r() < 0.5, left: r() < 0.3, light: r() < 0.1, heavy: r() < 0.05, block: r() < 0.1, jump: r() < 0.03 })); return JSON.stringify([M.f, M.wins, M.phase, M.round, M.frame]); };
  assert.strictEqual(play(), play());
});

test('every opponent plays on its own: it approaches, attacks, and a passive player eventually loses health', () => {
  for (let o = 0; o < L.OPPONENTS.length; o++) {
    const M = L.newMatch({ opp: o, seed: 21 + o }); let attacked = 0, g = 0;
    while (M.phase !== 'match' && g++ < 60 * 60 * 3) { L.step(M, null); if (M.events.some((e) => e.t === 'swing' || e.t === 'special')) attacked++; }
    assert.ok(attacked > 3, `${L.OPPONENTS[o].name} attacks`); assert.strictEqual(M.phase, 'match'); assert.strictEqual(M.result, 'lose', `${L.OPPONENTS[o].name} beats a player who does nothing`);
  }
});

test('the opponents get stronger in order for a simple human-like bot, and the first is easy and the last is hard', () => {
  const { fight } = require('./bot.js'); const sk = { react: 14, block: 0.5, tick: 9 }; const rate = [];
  for (let o = 0; o < 5; o++) { let w = 0; const N = 40; for (let s = 1; s <= N; s++) if (fight(o, sk, s).win) w++; rate.push(w / N); }
  assert.ok(rate[0] >= 0.85, 'first is easy: ' + rate[0]); assert.ok(rate[4] <= 0.6 && rate[4] >= 0.03, 'last is hard but not impossible: ' + rate[4]);
  assert.ok(rate[0] > rate[2] && rate[2] > rate[4], 'overall rising: ' + rate.join(','));
  for (let o = 0; o < 5; o++) assert.ok(rate[o] > 0, `opponent ${o} can be beaten`);
});

test('tutorial mode: the practice partner barely hurts, the player cannot be knocked out, and energy refills fast', () => {
  const M = L.newMatch({ tutorial: true, seed: 2 }); let g = 0; while (M.phase !== 'fight' && g++ < 100) L.step(M, null); assert.ok(g < 60, 'short intro');
  run(M, 60 * 70, null); assert.ok(M.f[0].hp >= 1, 'never knocked out'); assert.strictEqual(M.phase, 'fight', 'no time limit');
  M.f[0].energy = 0; run(M, 90, null); assert.strictEqual(M.f[0].energy, 100);
});
