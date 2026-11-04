// `npm run check`: 챔피언 데이터 검사 + 짧은 게임 시뮬레이션 + 평타 타이머 규칙 검사
import { CHAMPIONS } from '../champions/index.js';
import { validateChampion } from '../champions/validate.js';
import { createGameState, addPlayer } from '../state.js';
import { createPlayer } from '../player.js';
import { update } from '../update.js';
import { TICK_DT } from '../constants.js';
import { armorMultiplier, physicalDamage } from '../damage.js';

let failed = false;
const fail = (msg) => {
  failed = true;
  console.log(`✗ ${msg}`);
};

// 두 캐릭터를 놓은 상태 (b는 a의 사거리 안)
function duel(championId, gap = 300) {
  let s = createGameState();
  const { blue } = s.map.spawns;
  s = addPlayer(s, createPlayer({ id: 'a', name: 'A', team: 'blue', x: blue.x, y: blue.y, championId }));
  s = addPlayer(s, createPlayer({ id: 'b', name: 'B', team: 'red', x: blue.x + gap, y: blue.y, championId, isDummy: true }));
  return s;
}
const step = (s, inputs = []) => update(s, inputs, TICK_DT);
const attackB = { playerId: 'a', type: 'attack', targetId: 'b' };

// 1. 데이터 검사
for (const id in CHAMPIONS) {
  const errors = validateChampion(CHAMPIONS[id]);
  if (errors.length) {
    fail(id);
    for (const e of errors) console.log(`    - ${e}`);
  } else {
    console.log(`✓ ${id} 데이터`);
  }
}

if (!failed) {
  for (const id in CHAMPIONS) {
    // 2. 시뮬레이션: 20초 동안 추격·평타가 오류 없이 돌아가는지
    try {
      let s = duel(id, 1100);
      const startHp = s.players.b.hp;
      for (let i = 0; i < 30 * 20; i++) {
        s = step(s, i === 0 ? [attackB] : []);
        for (const pid in s.players) {
          const p = s.players[pid];
          if (![p.x, p.y, p.hp, p.mana, p.moveSpeed, p.attackSpeed].every(Number.isFinite)) throw new Error(`${pid}의 값이 숫자가 아닙니다`);
        }
      }
      if (CHAMPIONS[id].attack.damage > 0 && s.players.b.hp >= startHp) throw new Error('20초 동안 평타가 한 번도 맞지 않았습니다');
      console.log(`✓ ${id} 시뮬레이션 (20초 평타 후 상대 체력 ${startHp} → ${Math.ceil(s.players.b.hp)})`);
    } catch (e) {
      fail(`${id} 시뮬레이션: ${e.message}`);
    }

    // 3. 평타 타이머 규칙
    try {
      // 선딜레이 도중 이동 → 평타 취소, 타이머 0
      let s = step(duel(id), [attackB]);
      if (s.players.a.attackWindup === null) throw new Error('평타 명령 후 선딜레이가 시작되지 않았습니다');
      s = step(s, [{ playerId: 'a', type: 'move', x: 100, y: 100 }]);
      if (s.players.a.attackTimer !== 0) throw new Error('선딜레이 취소 후 공격 타이머가 0이 아닙니다');
      // 발사 후 이동 → 타이머 유지
      s = step(duel(id), [attackB]);
      while (s.players.a.attackWindup !== null) s = step(s);
      const timer = s.players.a.attackTimer;
      s = step(s, [{ playerId: 'a', type: 'move', x: 100, y: 100 }]);
      if (!(s.players.a.attackTimer > 0 && s.players.a.attackTimer < timer)) throw new Error('발사 후 이동했는데 쿨다운이 유지되지 않았습니다');
      console.log(`✓ ${id} 평타 타이머 규칙 (선딜레이 취소 시 초기화, 발사 후 쿨다운 유지)`);
    } catch (e) {
      fail(`${id} 평타 타이머: ${e.message}`);
    }

    // 4. 평타 상태·취소 조건·틱 타이밍 규칙
    try {
      const moveAway = { playerId: 'a', type: 'move', x: 100, y: 100 };
      const setPos = (s, pid, dx) => ({ ...s, players: { ...s.players, [pid]: { ...s.players[pid], x: s.players[pid].x + dx } } });
      const withPlayer = (s, pid, patch) => ({ ...s, players: { ...s.players, [pid]: { ...s.players[pid], ...patch } } });

      // 상태 순서: chase → windup → cooldown
      let s = step(duel(id, 1100), [attackB]);
      const seen = [s.players.a.attackState];
      for (let i = 0; i < 30 * 6; i++) {
        s = step(s);
        if (seen.at(-1) !== s.players.a.attackState) seen.push(s.players.a.attackState);
      }
      if (seen.slice(0, 3).join('>') !== 'chase>windup>cooldown') throw new Error(`상태 순서가 다릅니다: ${seen.join(' > ')}`);

      // 선딜레이 마지막 1틱은 이동 명령으로 취소되지 않는다
      s = step(duel(id), [attackB]);
      while (s.players.a.attackWindup > TICK_DT + 1e-6) s = step(s);
      const before = s.projectiles.length + (s.players.b.hp < s.players.b.maxHp ? 1 : 0);
      s = step(s, [moveAway]);
      const after = s.projectiles.length + (s.players.b.hp < s.players.b.maxHp ? 1 : 0);
      if (after <= before) throw new Error('선딜레이 마지막 틱에 이동했더니 평타가 취소되었습니다');

      // 발사 직후 1틱 동안의 명령은 다음 틱으로 미뤄진다
      // 발사 틱에 들어온 이동 명령은 잠금 전에 처리되므로 미뤄지지 않고 바로 이동 목표가 된다
      if (s.deferredInputs.length !== 0 || s.players.a.target === null) throw new Error('발사 틱의 이동 명령이 처리되지 않았습니다');
      s = step(duel(id), [attackB]);
      while (s.players.a.attackWindup !== null) s = step(s);
      s = step(s, [moveAway]); // 발사 다음 틱
      if (s.players.a.target !== null || s.deferredInputs.length !== 1) throw new Error('발사 직후 틱의 명령이 미뤄지지 않았습니다');
      s = step(s);
      if (s.players.a.target === null) throw new Error('미뤄진 명령이 다음 틱에 처리되지 않았습니다');

      // 대상이 조금 멀어지면(여유 거리 안) 선딜레이 유지, 많이 멀어지면 취소
      s = step(duel(id), [attackB]);
      const range = CHAMPIONS[id].attack.range;
      const gap = s.players.b.x - s.players.a.x - s.players.a.gameplayRadius - s.players.b.gameplayRadius;
      let t = setPos(s, 'b', range - gap + 50);
      t = step(t);
      if (t.players.a.attackWindup === null && t.players.a.attackState !== 'cooldown') throw new Error('여유 거리 안인데 선딜레이가 취소되었습니다');
      t = setPos(step(duel(id), [attackB]), 'b', range - gap + 200);
      t = step(t);
      if (t.players.a.attackWindup !== null || t.players.a.attackTimer !== 0) throw new Error('대상이 너무 멀어졌는데 선딜레이가 유지되었습니다');
      if (t.players.a.attackState !== 'chase') throw new Error('평타가 끊긴 뒤 다시 추적하지 않았습니다');

      // 대상이 타겟 불가가 되면 선딜레이와 명령이 끊긴다
      t = withPlayer(step(duel(id), [attackB]), 'b', { targetable: false });
      t = step(t);
      if (t.players.a.attackWindup !== null || t.players.a.attackTargetId !== null) throw new Error('타겟 불가 대상에게 평타가 계속되었습니다');

      console.log(`✓ ${id} 평타 상태·취소·틱 규칙 (chase>windup>cooldown, 마지막 틱 취소 불가, 발사 후 명령 지연, 여유 거리, 타겟 불가)`);
    } catch (e) {
      fail(`${id} 평타 상태·취소·틱 규칙: ${e.message}`);
    }
  }

  // 5. 어택땅·정지
  try {
    const id = Object.keys(CHAMPIONS)[0];
    const range = CHAMPIONS[id].attack.range;
    const reach = range + 2 * CHAMPIONS[id].gameplayRadius; // 중심 거리 기준 사거리
    // 사거리 안의 적 두 명 중 내 위치에 가까운 적을 고른다
    let s = duel(id, reach - 50);
    const { blue } = s.map.spawns;
    s = addPlayer(s, createPlayer({ id: 'c', name: 'C', team: 'red', x: blue.x + 200, y: blue.y + 100, championId: id, isDummy: true }));
    s = step(s, [{ playerId: 'a', type: 'attackMove', x: blue.x + 2000, y: blue.y }]);
    if (s.players.a.attackTargetId !== 'c') throw new Error(`가장 가까운 적(c)이 아니라 ${s.players.a.attackTargetId}를 골랐습니다`);

    // 사거리 안에 적이 없으면 목적지로 가다가, 적이 사거리에 들어오면 공격
    s = duel(id, reach + 600);
    s = step(s, [{ playerId: 'a', type: 'attackMove', x: blue.x + 3000, y: blue.y }]);
    if (s.players.a.attackTargetId !== null || !s.players.a.target) throw new Error('사거리 밖인데 이동하지 않았습니다');
    let ticks = 0;
    while (s.players.a.attackTargetId === null && ticks < 300) {
      s = step(s);
      ticks++;
    }
    if (s.players.a.attackTargetId !== 'b') throw new Error('이동 중 사거리에 들어온 적을 공격하지 않았습니다');
    const traveled = s.players.a.x - blue.x;
    if (Math.abs(traveled - 600) > 30) throw new Error(`사거리 경계가 아닌 곳에서 공격을 시작했습니다 (이동 거리 ${traveled.toFixed(0)}, 예상 약 600)`);

    // 대상이 죽으면 다시 목적지로 간다
    s = { ...s, players: { ...s.players, b: { ...s.players.b, hp: 0 } } };
    s = step(s);
    s = step(s);
    if (!s.players.a.target || s.players.a.attackMoveTarget === null) throw new Error('대상이 죽은 뒤 목적지로 다시 가지 않았습니다');

    // 정지: 이동·어택땅 해제, 선딜레이 취소
    s = step(s, [{ playerId: 'a', type: 'stop' }]);
    if (s.players.a.target || s.players.a.attackMoveTarget || s.players.a.attackTargetId) throw new Error('정지 후에도 이동·공격 명령이 남아 있습니다');
    s = step(duel(id), [attackB]);
    s = step(s, [{ playerId: 'a', type: 'stop' }]);
    if (s.players.a.attackWindup !== null || s.players.a.attackTimer !== 0) throw new Error('정지 명령으로 선딜레이가 취소되지 않았습니다');

    console.log('✓ 어택땅·정지 (가장 가까운 적 선택, 이동 중 적 탐색, 대상 사망 후 재출발, 정지)');
  } catch (e) {
    fail(`어택땅·정지: ${e.message}`);
  }

  // 6. 데미지 공식: 방어력, 치명타, 같은 시드면 같은 결과
  try {
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    if (!near(armorMultiplier(0), 1) || !near(armorMultiplier(100), 0.5) || !near(armorMultiplier(-100), 1.5)) {
      throw new Error('방어력 배율 공식이 다릅니다');
    }
    const id = Object.keys(CHAMPIONS)[0];
    const champ = CHAMPIONS[id];
    const firstHit = (s) => {
      for (let i = 0; i < 90; i++) {
        s = step(s, i === 0 ? [attackB] : []);
        const ev = s.events.find((e) => e.type === 'damage');
        if (ev) return ev;
      }
      throw new Error('3초 안에 평타가 맞지 않았습니다');
    };
    // 일반 평타: 공격력 × 100/(100+방어력)
    let ev = firstHit(duel(id));
    if (ev.crit || !near(ev.amount, physicalDamage(champ.attack.damage, champ.armor))) throw new Error(`일반 평타 피해가 다릅니다 (${ev.amount})`);
    // 치명타 확률 100%: × critDamage
    let s = duel(id);
    s = { ...s, players: { ...s.players, a: { ...s.players.a, critChance: 1 } } };
    ev = firstHit(s);
    if (!ev.crit || !near(ev.amount, physicalDamage(champ.attack.damage * champ.critDamage, champ.armor))) throw new Error(`치명타 피해가 다릅니다 (${ev.amount})`);
    // 치명타 확률 50%: 같은 시드면 같은 결과, 대략 절반
    const crits = (seed) => {
      let t = createGameState({ seed });
      const { blue } = t.map.spawns;
      t = addPlayer(t, { ...createPlayer({ id: 'a', name: 'A', team: 'blue', x: blue.x, y: blue.y, championId: id }), critChance: 0.5 });
      t = addPlayer(t, { ...createPlayer({ id: 'b', name: 'B', team: 'red', x: blue.x + 300, y: blue.y, championId: id, isDummy: true }), maxHp: 1e9, hp: 1e9 });
      t = { ...t, players: { ...t.players, a: { ...t.players.a, effects: [{ kind: 'attackSpeed', value: 10, remaining: 1e9 }] } } };
      const out = [];
      for (let i = 0; i < 30 * 60; i++) {
        t = step(t, i === 0 ? [attackB] : []);
        for (const e of t.events) if (e.type === 'damage') out.push(e.crit ? 1 : 0);
      }
      return out;
    };
    const a1 = crits(42).join('');
    const a2 = crits(42).join('');
    if (a1 !== a2) throw new Error('같은 시드인데 치명타 결과가 다릅니다');
    const rate = a1.split('').filter((c) => c === '1').length / a1.length;
    if (rate < 0.4 || rate > 0.6) throw new Error(`치명타 50%인데 실제 비율이 ${(rate * 100).toFixed(1)}%입니다`);
    console.log(`✓ 데미지 공식 (방어력 감소, 치명타 ×${champ.critDamage}, 같은 시드 같은 결과, 50% 확률 → 실제 ${(rate * 100).toFixed(1)}% / ${a1.length}회)`);
  } catch (e) {
    fail(`데미지 공식: ${e.message}`);
  }

  // 7. 근접 평타: 투사체 없이 즉시 적중 (검사용 임시 챔피언)
  try {
    const base = CHAMPIONS[Object.keys(CHAMPIONS)[0]];
    CHAMPIONS.__melee = { ...base, attack: { type: 'melee', range: 125, damage: 10, attackSpeed: 1, windupRatio: 0.25 } };
    let s = step(duel('__melee', 140), [attackB]);
    let ticks = 1;
    while (s.players.b.hp === s.players.b.maxHp && ticks < 60) {
      s = step(s);
      ticks++;
    }
    if (s.projectiles.length) throw new Error('근접 평타가 투사체를 만들었습니다');
    const expected = s.players.b.maxHp - physicalDamage(10, s.players.b.armor);
    if (Math.abs(s.players.b.hp - expected) > 1e-9) throw new Error('근접 평타가 맞지 않았습니다');
    console.log(`✓ 근접 평타 즉시 적중 (${ticks}틱 = ${(ticks / 30).toFixed(2)}초, 선딜레이 0.25초)`);
  } catch (e) {
    fail(`근접 평타: ${e.message}`);
  } finally {
    delete CHAMPIONS.__melee;
  }
}

if (failed) {
  console.log('\n검사 실패: 위 항목을 고친 뒤 다시 실행하세요.');
  process.exit(1);
}
console.log('\n검사 통과');
