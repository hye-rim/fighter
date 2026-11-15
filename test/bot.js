'use strict';
// 시험용 봇 (사람처럼 반응이 느리고 가끔 막는다). 테스트에서만 쓴다.
const L = require('../logic.js');
function bot(skill) {
  const st = { wait: 0, inp: L.idleInput(), seen: 0 };
  return (M, r) => {
    const me = M.f[0], en = M.f[1], inp = st.inp;
    inp.light = inp.heavy = inp.jump = inp.special = false;
    if (!L.free(me)) return inp;
    const dist = Math.abs(en.x - me.x), toward = Math.sign(en.x - me.x) || 1;
    const atk = en.st === 'atk' && en.move !== 'special';
    st.seen = atk && dist < 60 ? st.seen + 1 : 0;
    if (atk && en.move === 'heavy' && st.seen >= skill.react && r() < skill.block) { inp.block = true; inp.left = inp.right = false; st.wait = 8; return inp; }
    if (M.proj.some((p) => p.owner === 1 && Math.abs(p.x - me.x) < 90)) { if (r() < skill.block) { inp.block = true; return inp; } }
    if (st.wait > 0) { st.wait--; return inp; }
    st.wait = Math.round(skill.tick * (0.6 + r() * 0.8));
    inp.left = inp.right = inp.block = false;
    if (me.energy >= 100 && dist > 90 && r() < 0.6) { inp.special = true; return inp; }
    if (dist > 56) { if (toward > 0) inp.right = true; else inp.left = true; return inp; }
    if (dist <= 50) { const x = r(); if (x < 0.5) inp.light = true; else if (x < 0.75) inp.heavy = true; else if (x < 0.85) inp.block = true; else { if (toward > 0) inp.left = true; else inp.right = true; } return inp; }
    if (toward > 0) inp.right = true; else inp.left = true;
    return inp;
  };
}
function fight(opp, skill, seed, hero = 0) {
  const M = L.newMatch({ opp, seed, hero }); const r = L.rng(seed * 7 + 1), b = bot(skill);
  let n = 0; while (M.phase !== 'match' && n++ < 60 * 60 * 8) L.step(M, b(M, r));
  return { win: M.result === 'win', frames: n };
}
module.exports = { fight, bot };
