// `npm run check`: 챔피언 데이터 검사 + 짧은 게임 시뮬레이션 + 평타 타이머 규칙 검사
import { CHAMPIONS } from '../champions/index.js';
import { validateChampion } from '../champions/validate.js';
import { createGameState as createRealGameState, addPlayer } from '../state.js';
import { createLaneMap, clampToMap, worldToLane, laneDirection, laneToWorld as laneToWorldReal } from '../map.js';
import { SUMMONER_SPELLS } from '../summoners.js';
import { createPlayer } from '../player.js';
import { update } from '../update.js';
import { TICK_DT } from '../constants.js';
import { armorMultiplier, physicalDamage, mitigate, damageRaw } from '../damage.js';
import { TURRET, turretAttackDamage, turretResist, updateTurret } from '../turret.js';
import { MINIONS, MINION_WAVES, MINION_COMBAT, createWaveState, updateWaves, upgradeCount, minionStat, waveInterval, createMinion, minionPriority } from '../minions.js';

// 대부분의 검사는 같은 맵 코드를 '가로 통로'(각도 0)에서 돌린다: 좌표를 x 방향 거리로 쓰기 쉽게.
// 실제 게임의 대각선 통로는 아래 '대각선 맵' 검사에서 따로 확인한다.
const TEST_MAP = createLaneMap({ angle: 0, margin: 0 });
// 기존 테스트는 포탑·미니언 없이 (포탑 테스트는 turrets: true, 미니언 테스트는 minions: true)
const createGameState = (opts = {}) => createRealGameState({ map: TEST_MAP, turrets: false, minions: false, ...opts });

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
const run3 = (s, n) => {
  for (let i = 0; i < n; i++) s = step(s);
  return s;
};
const laneToWorldTest = (u, v = 0) => ({ x: TEST_MAP.lane.x0 + u * TEST_MAP.lane.dirX - v * TEST_MAP.lane.dirY, y: TEST_MAP.lane.y0 + u * TEST_MAP.lane.dirY + v * TEST_MAP.lane.dirX });

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
      if (s.players.a.queuedCommand !== null || s.players.a.target === null) throw new Error('발사 틱의 이동 명령이 처리되지 않았습니다');
      s = step(duel(id), [attackB]);
      while (s.players.a.attackWindup !== null) s = step(s);
      s = step(s, [moveAway]); // 발사 다음 틱
      if (s.players.a.target !== null || s.players.a.queuedCommand?.type !== 'move') throw new Error('발사 직후 틱의 명령이 선입력으로 저장되지 않았습니다');
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

    // 벽 밖·막힌 목적지: 멈추면 어택땅이 끝난다 (목적지가 남아 있으면 안 됨)
    s = duel(id, 3000);
    s = step(s, [{ playerId: 'a', type: 'attackMove', x: -500, y: blue.y }]);
    for (let i = 0; i < 90; i++) s = step(s);
    if (s.players.a.attackMoveTarget) throw new Error('벽 밖을 어택땅했는데 벽 앞에서 멈춘 뒤에도 어택땅이 끝나지 않았습니다');
    s = duel(id, 3000);
    s = addPlayer(s, createPlayer({ id: 'ally', name: 'Ally', team: 'blue', x: blue.x + 400, y: blue.y, championId: id, isDummy: true }));
    s = step(s, [{ playerId: 'a', type: 'attackMove', x: blue.x + 400, y: blue.y }]);
    for (let i = 0; i < 90; i++) s = step(s);
    if (s.players.a.attackMoveTarget) throw new Error('아군에 막힌 목적지에서 멈춘 뒤에도 어택땅이 끝나지 않았습니다');

    console.log('✓ 어택땅·정지 (가장 가까운 적 선택, 이동 중 적 탐색, 대상 사망 후 재출발, 벽 밖·막힌 목적지에서 종료, 정지)');
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

  // 7. 개발자 모드 기능: 허수아비 행동, 무적, 무한 마나, 순간이동
  try {
    const id = Object.keys(CHAMPIONS)[0];
    const dbg = (input) => ({ playerId: 'a', type: 'debug', ...input });
    // 왔다 갔다: 기준 위치 좌우로 움직인다
    let s = step(duel(id, 1100), [dbg({ action: 'setDummyMode', targetId: 'b', mode: 'patrol' })]);
    const anchor = s.players.b.x;
    let minX = anchor;
    let maxX = anchor;
    for (let i = 0; i < 30 * 6; i++) {
      s = step(s);
      minX = Math.min(minX, s.players.b.x);
      maxX = Math.max(maxX, s.players.b.x);
    }
    if (maxX - anchor < 250 || anchor - minX < 250) throw new Error(`왔다 갔다 범위가 좁습니다 (${(minX - anchor).toFixed(0)} ~ ${(maxX - anchor).toFixed(0)})`);
    // 나를 공격: 허수아비가 쫓아와서 때린다
    s = step(duel(id, 1100), [dbg({ action: 'setDummyMode', targetId: 'b', mode: 'attack' })]);
    for (let i = 0; i < 30 * 5; i++) s = step(s);
    if (s.players.a.hp >= s.players.a.maxHp) throw new Error('공격 모드 허수아비가 나를 때리지 않았습니다');
    // 무적: 맞아도 체력이 그대로, 데미지 이벤트는 0
    s = step(duel(id), [dbg({ action: 'setFlag', targetId: 'b', flag: 'invulnerable', value: true }), attackB]);
    let ev = null;
    for (let i = 0; i < 60 && !ev; i++) {
      s = step(s);
      ev = s.events.find((e) => e.type === 'damage');
    }
    if (!ev || ev.amount !== 0 || s.players.b.hp !== s.players.b.maxHp) throw new Error('무적인데 피해를 받았습니다');
    // 무한 마나
    s = step(duel(id), [dbg({ action: 'setFlag', flag: 'infiniteMana', value: true }), dbg({ action: 'spendMana' })]);
    if (s.players.a.mana !== s.players.a.maxMana) throw new Error('무한 마나인데 마나가 줄었습니다');
    // 순간이동: 벽 밖을 찍으면 벽 안쪽으로
    s = step(duel(id), [dbg({ action: 'teleport', targetId: 'b', x: -500, y: 99999 })]);
    const b = s.players.b;
    if (b.x !== b.pathingRadius || b.y !== s.map.height - b.pathingRadius) throw new Error(`순간이동 위치가 벽 안쪽이 아닙니다 (${b.x}, ${b.y})`);
    console.log('✓ 개발자 모드 기능 (허수아비 왔다 갔다·공격, 무적, 무한 마나, 순간이동)');
  } catch (e) {
    fail(`개발자 모드 기능: ${e.message}`);
  }

  // 8. 스킬 (방향 지정 + 투사체): 시전 조건, 마나·쿨타임, 충돌 방식, 피해 공식, 적중 시 쿨타임 감소
  for (const id in CHAMPIONS) {
    for (const key in CHAMPIONS[id].skills ?? {}) {
      const data = CHAMPIONS[id].skills[key];
      const proj = data.effects.find((e) => e.type === 'projectile');
      if (data.targeting.type !== 'direction' || !proj) continue;
      const dmg = proj.onHit.find((e) => e.type === 'damage');
      if (!dmg) continue; // 적중 시 피해가 없는 스킬(예: 표식만 붙이는 스킬)은 아래 표식 검사에서 확인
      const cdr = proj.onHit.find((e) => e.type === 'reduceCooldowns')?.amount ?? 0;
      try {
        const cast = (s, x, y) => step(s, [{ playerId: 'a', type: 'cast', skill: key, x, y }]);
        const firstSkillHit = (s) => {
          for (let i = 0; i < 120; i++) {
            s = step(s);
            const ev = s.events.find((e) => e.type === 'damage' && e.skill === key);
            if (ev) return { s, ev };
            if (!s.projectiles.length && !s.players.a.casting) break;
          }
          return { s, ev: null };
        };
        // 시전: 마나 소모, 쿨타임 시작, 시전 시간 뒤 투사체 발사
        let s = duel(id, 600);
        const { blue } = s.map.spawns;
        s = cast(s, blue.x + 1000, blue.y);
        const a = s.players.a;
        if (a.mana !== a.maxMana - data.manaCost[0]) throw new Error('마나가 소모되지 않았습니다');
        if (!(a.skills[key].cooldown > data.cooldown[0] - 0.05)) throw new Error('쿨타임이 시작되지 않았습니다');
        if (!a.casting || s.projectiles.length) throw new Error('시전 시간 없이 바로 발사되었습니다');
        // 쿨타임 중 재시전 불가
        const before = s.players.a.mana;
        s = cast(s, blue.x + 1000, blue.y);
        if (s.players.a.mana !== before) throw new Error('쿨타임 중에 다시 시전되었습니다');
        // 적중: 피해 공식, 적중 시 쿨타임 감소
        const cdBeforeHit = s.players.a.skills[key].cooldown;
        let r = firstSkillHit(s);
        if (!r.ev) throw new Error('앞에 있는 적을 맞히지 못했습니다');
        // 기대값: 기본 + 총 공격력 × adRatio + 추가 공격력 × bonusAdRatio + 주문력 × apRatio → 피해 종류별 저항 적용
        const a0 = s.players.a;
        const raw = dmg.base[0] + a0.attackDamage * (dmg.adRatio ?? 0) + (a0.attackDamage - a0.baseAttackDamage) * (dmg.bonusAdRatio ?? 0) + a0.abilityPower * (dmg.apRatio ?? 0);
        const expectAmount = mitigate(raw, dmg.damageType, r.s.players.b);
        if (!Number.isFinite(expectAmount) || Math.abs(r.ev.amount - expectAmount) > 1e-9 || r.ev.damageType !== dmg.damageType) {
          throw new Error(`피해가 공식과 다릅니다 (${r.ev.amount}, 예상 ${expectAmount})`);
        }
        const elapsed = r.s.time - s.time;
        const expectCd = Math.max(0, cdBeforeHit - elapsed - cdr);
        if (Math.abs(r.s.players.a.skills[key].cooldown - expectCd) > 1e-6) throw new Error(`적중 시 쿨타임 감소가 다릅니다 (${r.s.players.a.skills[key].cooldown.toFixed(3)}, 예상 ${expectCd.toFixed(3)})`);
        // 충돌 방식: 일직선에 적 둘 → first면 앞의 적만, pierce면 둘 다
        s = duel(id, 400);
        s = addPlayer(s, createPlayer({ id: 'c', name: 'C', team: 'red', x: blue.x + 700, y: blue.y, championId: id, isDummy: true }));
        r = firstSkillHit(cast(s, blue.x + 1000, blue.y));
        for (let i = 0; i < 30; i++) r.s = step(r.s);
        const bHit = r.s.players.b.hp < r.s.players.b.maxHp;
        const cHit = r.s.players.c.hp < r.s.players.c.maxHp;
        if (proj.collision === 'first' && !(bHit && !cHit)) throw new Error('처음 맞은 적 하나만 맞아야 합니다');
        if (proj.collision === 'pierce' && !(bHit && cHit)) throw new Error('관통 투사체가 두 적을 모두 맞혀야 합니다');
        // 사거리 밖 적은 맞지 않고, 투사체는 사거리만큼 날아간 뒤 사라진다
        // (비행 시간 = 시전 시간 + 사거리 ÷ 속도 만큼 지켜본다. 사거리가 길면 오래 걸림)
        s = duel(id, data.targeting.range + 300);
        s = cast(s, blue.x + 5000, blue.y);
        const flightTicks = Math.ceil((data.activation.castTime + data.targeting.range / proj.speed) * 30) + 5;
        let hitFar = false;
        for (let i = 0; i < flightTicks; i++) {
          s = step(s);
          if (s.events.some((e) => e.type === 'damage' && e.skill === key)) hitFar = true;
        }
        if (hitFar) throw new Error('사거리 밖의 적을 맞혔습니다');
        if (s.projectiles.some((p) => p.skill === key)) throw new Error(`투사체가 사거리(${data.targeting.range})를 날아간 뒤에도 사라지지 않았습니다`);
        // 마나 부족이면 시전 불가
        s = duel(id);
        s = { ...s, players: { ...s.players, a: { ...s.players.a, mana: data.manaCost[0] - 1 } } };
        s = cast(s, blue.x + 1000, blue.y);
        if (s.players.a.casting) throw new Error('마나가 부족한데 시전되었습니다');
        console.log(`✓ ${id} ${key} ${data.name} (방향 지정 + ${data.activation.type} + 투사체 ${proj.collision}: 마나·쿨타임, 시전 시간, 피해 공식, 적중 시 쿨타임 -${cdr}초, 사거리, 마나 부족)`);
      } catch (e) {
        fail(`${id} ${key} 스킬: ${e.message}`);
      }
    }
  }

  // 9. 표식 스킬: 부착(피해 없음), 같은 스킬로 갱신, 평타·다른 스킬로 터짐(피해 + 마나 회복), 시간 만료, 챔피언만
  for (const id in CHAMPIONS) {
    for (const key in CHAMPIONS[id].skills ?? {}) {
      const data = CHAMPIONS[id].skills[key];
      const proj = data.effects.find((e) => e.type === 'projectile');
      const markSpec = proj?.onHit.find((e) => e.type === 'applyMark');
      if (!markSpec) continue;
      try {
        const dmg = markSpec.onDetonate.find((e) => e.type === 'damage');
        const mana = markSpec.onDetonate.find((e) => e.type === 'restoreMana');
        const noCd = (s) => ({ ...s, players: { ...s.players, a: { ...s.players.a, noCooldown: true } } });
        const run = (s, n) => {
          const evs = [];
          for (let i = 0; i < n; i++) {
            s = step(s);
            evs.push(...s.events);
          }
          return { s, evs };
        };
        const { blue } = createGameState().map.spawns;
        const castAt = (s, k) => step(s, [{ playerId: 'a', type: 'cast', skill: k, x: blue.x + 1000, y: blue.y }]);

        // 부착: 피해 없이 표식만
        let s = noCd(duel(id, 400));
        let r = run(castAt(s, key), 30);
        const mark = r.s.players.b.marks.find((m) => m.ownerId === 'a' && m.skill === key);
        if (!mark) throw new Error('표식이 붙지 않았습니다');
        if (r.s.players.b.hp !== r.s.players.b.maxHp) throw new Error('구체가 맞는 순간 피해가 들어갔습니다');
        // 같은 스킬로 다시 맞히면 갱신만 (터지지 않음)
        r = run(castAt(r.s, key), 30);
        if (r.evs.some((e) => e.type === 'markDetonate')) throw new Error('같은 스킬로 맞혔는데 표식이 터졌습니다');
        if (!(r.s.players.b.marks[0]?.remaining > markSpec.duration - 1)) throw new Error('같은 스킬로 맞혔는데 표식 시간이 갱신되지 않았습니다');

        // 평타로 터짐: 마법 피해 + 마나 회복(평타는 마나 소모 0)
        s = { ...r.s, players: { ...r.s.players, a: { ...r.s.players.a, mana: 100 } } };
        r = run(step(s, [attackB]), 60);
        const det = r.evs.find((e) => e.type === 'damage' && e.mark);
        if (!det) throw new Error('평타로 표식이 터지지 않았습니다');
        const a = r.s.players.a;
        const expectRaw = dmg.base[0] + (a.attackDamage - a.baseAttackDamage) * (dmg.bonusAdRatio ?? 0) + a.attackDamage * (dmg.adRatio ?? 0) + a.abilityPower * (dmg.apRatio ?? 0);
        if (Math.abs(det.raw - expectRaw) > 1e-9 || det.damageType !== dmg.damageType) throw new Error(`표식 피해가 다릅니다 (${det.raw})`);
        const target = r.s.players.b;
        const expectAmount = dmg.damageType === 'magic' ? physicalDamage(expectRaw, target.magicResist) : physicalDamage(expectRaw, target.armor);
        if (Math.abs(det.amount - expectAmount) > 1e-9) throw new Error(`표식 피해의 저항 적용이 다릅니다 (${det.amount}, 예상 ${expectAmount})`);
        const restored = r.evs.filter((e) => e.type === 'manaRestore').reduce((n, e) => n + e.amount, 0);
        if (mana && restored !== mana.base) throw new Error(`평타로 터뜨렸을 때 마나 회복이 다릅니다 (${restored})`);
        if (r.s.players.b.marks.length) throw new Error('터진 뒤에도 표식이 남아 있습니다');

        // 다른 스킬로 터짐: 그 스킬 피해 + 표식 피해 + 마나 (base + 그 스킬 마나 소모량)
        const otherKey = Object.keys(CHAMPIONS[id].skills).find((k) => k !== key && CHAMPIONS[id].skills[k].effects.some((e) => e.type === 'projectile' && e.onHit.some((h) => h.type === 'damage')));
        if (otherKey) {
          s = noCd(duel(id, 400));
          r = run(castAt(s, key), 30);
          s = { ...r.s, players: { ...r.s.players, a: { ...r.s.players.a, mana: 100 } } };
          r = run(castAt(s, otherKey), 30);
          const kinds = r.evs.filter((e) => e.type === 'damage').map((e) => (e.mark ? 'mark' : e.skill));
          if (kinds.join(',') !== `${otherKey},mark`) throw new Error(`다른 스킬로 맞혔을 때 순서가 다릅니다 (${kinds.join(',')})`);
          const cost = CHAMPIONS[id].skills[otherKey].manaCost[0];
          const got = r.evs.filter((e) => e.type === 'manaRestore').reduce((n, e) => n + e.amount, 0);
          if (mana && got !== mana.base + (mana.plusTriggerCost ? cost : 0)) throw new Error(`스킬로 터뜨렸을 때 마나 회복이 다릅니다 (${got})`);
        }

        // 시간이 지나면 사라짐
        s = noCd(duel(id, 400));
        r = run(castAt(s, key), Math.ceil((markSpec.duration + 1) * 30));
        if (r.s.players.b.marks.length) throw new Error('표식 시간이 지나도 남아 있습니다');

        // 챔피언만 맞는 투사체는 다른 유닛을 통과
        if (proj.targets === 'champions') {
          s = noCd(duel(id, 600));
          s = addPlayer(s, { ...createPlayer({ id: 'm', name: 'M', team: 'red', x: blue.x + 300, y: blue.y, championId: id, isDummy: true }), unitType: 'minion' });
          r = run(castAt(s, key), 30);
          if (r.s.players.m.marks.length || !r.s.players.b.marks.length) throw new Error('챔피언이 아닌 유닛을 통과하지 않았습니다');
        }
        console.log(`✓ ${id} ${key} ${data.name} (표식 부착·갱신, 평타·${otherKey ?? '-'}로 터짐: ${dmg.damageType} 피해 + 마나 회복, ${markSpec.duration}초 만료${proj.targets === 'champions' ? ', 챔피언만' : ''})`);
      } catch (e) {
        fail(`${id} ${key} 표식 스킬: ${e.message}`);
      }
    }
  }

  // 10. 선입력: ① 행동 불가 중(슬롯 하나, 마지막 입력) ② 쿨타임 선입력(스킬별, 이동으로 안 지워짐), 정지, castBuffer 'deny'
  for (const id in CHAMPIONS) {
    const skills = CHAMPIONS[id].skills ?? {};
    const keys = Object.keys(skills);
    if (!keys.length) continue;
    try {
      const { blue } = createGameState().map.spawns;
      const cast = (k, x = blue.x + 1000) => ({ playerId: 'a', type: 'cast', skill: k, x, y: blue.y });
      const withA = (s, patch) => ({ ...s, players: { ...s.players, a: { ...s.players.a, ...patch } } });
      const setCd = (s, k, cd) => withA(s, { skills: { ...s.players.a.skills, [k]: { ...s.players.a.skills[k], cooldown: cd } } });

      for (const k of keys) {
        const q = skills[k].queueTime ?? 0;
        // 허용 시간 밖: 저장 안 됨
        let s = step(setCd(duel(id, 2000), k, q + 0.2), [cast(k)]);
        if (s.players.a.queuedCasts[k] || s.players.a.queuedCommand) throw new Error(`${k}: 쿨타임이 ${(q + 0.2).toFixed(2)}초 남았는데 선입력이 저장되었습니다`);
        if (q > 0) {
          // 허용 시간 안: 저장 → 쿨타임이 끝나는 틱에 시전
          s = step(setCd(duel(id, 2000), k, q), [cast(k)]);
          if (!s.players.a.queuedCasts[k]) throw new Error(`${k}: 쿨타임 ${q}초 남았을 때 쿨타임 선입력이 저장되지 않았습니다`);
          let ticks = 1;
          while (!s.players.a.casting && ticks < 60) {
            s = step(s);
            ticks++;
          }
          const expected = Math.ceil(q * 30 - 1e-6) + (Math.abs(q * 30 - Math.round(q * 30)) < 1e-6 ? 1 : 0);
          if (!s.players.a.casting) throw new Error(`${k}: 쿨타임 선입력이 실행되지 않았습니다`);
          if (Math.abs(ticks - expected) > 1) throw new Error(`${k}: 쿨타임이 끝난 틱에 바로 시전되지 않았습니다 (${ticks}틱)`);
        }
      }

      const [k1, k2] = keys;
      const move = (dy) => ({ playerId: 'a', type: 'move', x: blue.x, y: blue.y + dy });
      const qKey = keys.find((k) => (skills[k].queueTime ?? 0) >= 0.2);
      if (qKey) {
        const q = skills[qKey].queueTime;
        // 쿨타임 선입력은 이동·평타 명령으로 지워지지 않는다
        let t = step(setCd(duel(id, 2000), qKey, q - 0.05), [cast(qKey)]);
        t = step(t, [move(300)]);
        t = step(t, [move(-300)]);
        t = step(t, [{ playerId: 'a', type: 'attack', targetId: 'b' }]);
        if (!t.players.a.queuedCasts[qKey]) throw new Error('이동·평타 명령에 쿨타임 선입력이 지워졌습니다');
        let fired = false;
        for (let i = 0; i < 30 && !fired; i++) {
          t = step(t);
          fired = t.players.a.casting?.skill === qKey;
        }
        if (!fired) throw new Error('무빙 중에 저장한 쿨타임 선입력이 실행되지 않았습니다');
        // 정지(S)로 취소
        t = step(setCd(duel(id, 2000), qKey, q - 0.05), [cast(qKey), { playerId: 'a', type: 'stop' }]);
        if (t.players.a.queuedCasts[qKey]) throw new Error('정지로 쿨타임 선입력이 취소되지 않았습니다');
        // 다른 스킬이 실제로 시전되면 취소
        const other = keys.find((k) => k !== qKey);
        if (other) {
          t = step(setCd(duel(id, 2000), qKey, q - 0.05), [cast(qKey)]);
          t = step(t, [cast(other)]);
          if (t.players.a.casting?.skill !== other || t.players.a.queuedCasts[qKey]) throw new Error('다른 스킬이 시전됐는데 쿨타임 선입력이 남아 있습니다');
          // 다른 스킬이 쿨타임 중이라 나가지 않으면 유지
          t = step(setCd(setCd(duel(id, 2000), qKey, q - 0.05), other, 3), [cast(qKey)]);
          t = step(t, [cast(other)]);
          if (!t.players.a.queuedCasts[qKey]) throw new Error('다른 스킬이 시전되지 않았는데 쿨타임 선입력이 취소되었습니다');
        }
        // 평타 발사 직후 1틱의 스킬 입력: 행동 불가 슬롯 → 다음 틱에 쿨타임 중이면 쿨타임 선입력으로 옮겨짐
        t = duel(id, 400);
        t = step(t, [attackB]);
        while (t.players.a.attackWindup !== null) t = step(t);
        t = setCd(t, qKey, q - 0.05);
        t = step(t, [cast(qKey)]);
        if (t.players.a.queuedCommand?.skill !== qKey || t.players.a.queuedCasts[qKey]) throw new Error('발사 직후 틱의 스킬 입력이 행동 불가 슬롯에 들어가지 않았습니다');
        t = step(t);
        if (t.players.a.queuedCommand || !t.players.a.queuedCasts[qKey]) throw new Error('잠금이 풀린 뒤 쿨타임 중인 스킬이 쿨타임 선입력으로 옮겨지지 않았습니다');
      }
      // 시전 중 선입력: 시전 중 이동 → 시전이 끝나는 틱에 이동 시작
      let s = step(duel(id, 2000), [cast(k1)]);
      s = step(s, [{ playerId: 'a', type: 'move', x: blue.x, y: blue.y + 500 }]);
      if (s.players.a.queuedCommand?.type !== 'move' || s.players.a.target) throw new Error('시전 중 이동 명령이 행동 불가 선입력으로 저장되지 않았습니다');
      while (s.players.a.casting) s = step(s);
      if (!s.players.a.target || s.players.a.queuedCommand) throw new Error('시전이 끝난 틱에 선입력된 이동이 실행되지 않았습니다');
      // 마지막 입력이 이김: 시전 중 이동 → 다른 스킬 → 시전이 끝나면 스킬만
      if (k2) {
        s = step(duel(id, 2000), [cast(k1)]);
        s = step(s, [{ playerId: 'a', type: 'move', x: blue.x, y: blue.y + 500 }]);
        s = step(s, [cast(k2)]);
        while (s.players.a.casting?.skill === k1) s = step(s);
        if (s.players.a.casting?.skill !== k2 || s.players.a.target) throw new Error('마지막 입력(스킬)이 이전 선입력(이동)을 덮어쓰지 않았습니다');
      }
      // 정지는 저장하지 않고 바로: 선입력도 지운다
      s = step(duel(id, 2000), [cast(k1)]);
      s = step(s, [{ playerId: 'a', type: 'move', x: blue.x, y: blue.y + 500 }]);
      s = step(s, [{ playerId: 'a', type: 'stop' }]);
      if (s.players.a.queuedCommand) throw new Error('정지가 선입력을 지우지 않았습니다');
      while (s.players.a.casting) s = step(s);
      if (s.players.a.target) throw new Error('정지했는데 시전 후 이동했습니다');
      // castBuffer 'deny': 시전 중 명령은 버린다 (검사용으로 잠시 바꿈)
      const act = skills[k1].activation;
      const saved = act.castBuffer;
      act.castBuffer = 'deny';
      try {
        s = step(duel(id, 2000), [cast(k1)]);
        s = step(s, [{ playerId: 'a', type: 'move', x: blue.x, y: blue.y + 500 }]);
        if (s.players.a.queuedCommand) throw new Error("castBuffer 'deny'인데 선입력이 저장되었습니다");
      } finally {
        if (saved === undefined) delete act.castBuffer;
        else act.castBuffer = saved;
      }
      console.log(`✓ ${id} 선입력 (쿨타임 선입력 ${keys.map((k) => `${k} ${skills[k].queueTime ?? 0}초`).join(', ')}: 무빙에 유지·정지/다른 스킬 시전으로 취소·발사 직후 틱 분리 / 행동 불가: 시전 종료 틱 실행·마지막 입력·정지·deny)`);
    } catch (e) {
      fail(`${id} 선입력: ${e.message}`);
    }
  }

  // 11. 위치 지정 + 순간이동 → 유도 투사체 스킬
  for (const id in CHAMPIONS) {
    for (const key in CHAMPIONS[id].skills ?? {}) {
      const data = CHAMPIONS[id].skills[key];
      const homing = data.effects.find((e) => e.type === 'homingProjectile');
      if (data.targeting.type !== 'location' || !data.effects.some((e) => e.type === 'blink')) continue;
      try {
        const range = data.targeting.range;
        const run = (s, n) => {
          const evs = [];
          for (let i = 0; i < n; i++) {
            s = step(s);
            evs.push(...s.events);
          }
          return { s, evs };
        };
        const patch = (s, pid, p) => ({ ...s, players: { ...s.players, [pid]: { ...s.players[pid], ...p } } });
        const castAt = (s, x, y) => step(s, [{ playerId: 'a', type: 'cast', skill: key, x, y }]);
        const until = (s) => {
          while (s.players.a.casting) s = step(s);
          return s;
        };
        // 상대를 멀리 둔 기본 상태 (사거리 밖이라 투사체가 안 나감)
        const far = () => {
          let s = duel(id, 100);
          return patch(s, 'b', { x: 4000, y: 2400 });
        };
        const start = far().players.a;

        // 사거리 밖 클릭 → 그 방향으로 최대 사거리
        let s = until(castAt(far(), start.x + 1000, start.y));
        if (Math.abs(s.players.a.x - (start.x + range)) > 1e-6) throw new Error(`사거리 밖 클릭인데 ${(s.players.a.x - start.x).toFixed(1)}만큼 이동했습니다 (예상 ${range})`);
        if (s.projectiles.length) throw new Error('범위 안에 적이 없는데 투사체가 나갔습니다');
        // 사거리 안 클릭 → 그 지점
        s = until(castAt(far(), start.x + 300, start.y));
        if (Math.abs(s.players.a.x - (start.x + 300)) > 1e-6) throw new Error('사거리 안 클릭 지점으로 이동하지 않았습니다');
        // 벽 쪽 → 가장 가까운 벽 밖
        s = until(castAt(patch(far(), 'a', { x: 100 }), -500, start.y));
        if (s.players.a.x !== s.players.a.pathingRadius) throw new Error(`벽 밖으로 나갔습니다 (${s.players.a.x})`);
        // 시전 중 밀리면 밀린 위치에서 처음 정한 방향·거리만큼 (300 조준 → 100 밀림 → 400)
        s = castAt(far(), start.x + 300, start.y);
        s = patch(s, 'a', { x: start.x + 100 });
        s = until(s);
        if (Math.abs(s.players.a.x - (start.x + 400)) > 1e-6) throw new Error(`시전 중 밀린 위치에서 처음 방향·거리로 이동하지 않았습니다 (${(s.players.a.x - start.x).toFixed(1)}, 예상 400)`);
        // 시전 중 점멸: 같은 방향이면 점멸 거리 + 순간이동 거리, 반대 방향이면 점멸한 자리에서 처음 방향으로
        s = castAt(far(), start.x + 1000, start.y);
        s = step(s, [{ playerId: 'a', type: 'summoner', slot: 'F', x: start.x + 1000, y: start.y }]);
        const flashed = s.players.a.x - start.x;
        s = until(s);
        if (Math.abs(s.players.a.x - (start.x + flashed + range)) > 1e-6) throw new Error(`시전 중 같은 방향 점멸 뒤 총 이동이 ${(s.players.a.x - start.x).toFixed(1)}입니다 (예상 ${flashed + range})`);
        s = castAt(far(), start.x + 1000, start.y);
        s = step(s, [{ playerId: 'a', type: 'summoner', slot: 'F', x: start.x - 1000, y: start.y }]);
        const back = s.players.a.x;
        s = until(s);
        if (Math.abs(s.players.a.x - (back + range)) > 1e-6) throw new Error('시전 중 반대 방향 점멸 뒤 처음 방향으로 이동하지 않았습니다');

        if (homing) {
          const { blue } = createGameState().map.spawns;
          // 대상 우선순위: 내 표식이 붙은 적 우선, 없으면 가장 가까운 적
          const twoEnemies = (markB) => {
            let t = duel(id, 600);
            t = addPlayer(t, createPlayer({ id: 'c', name: 'C', team: 'red', x: blue.x + 300, y: blue.y + 200, championId: id, isDummy: true }));
            if (markB) t = patch(t, 'b', { marks: [{ ownerId: 'a', skill: 'X', remaining: 5 }] });
            return t;
          };
          const firstTarget = (t) => {
            t = castAt(t, blue.x, blue.y + 1);
            while (t.players.a.casting) t = step(t);
            return t.projectiles.find((p) => p.kind === 'homingSkill')?.targetId;
          };
          if (firstTarget(twoEnemies(false)) !== 'c') throw new Error('표식이 없을 때 가장 가까운 적을 고르지 않았습니다');
          if (homing.priority === 'markedFirst' && firstTarget(twoEnemies(true)) !== 'b') throw new Error('표식이 붙은 적을 우선하지 않았습니다');
          // 범위 밖 적에게는 나가지 않는다
          let t = patch(duel(id, 100), 'b', { x: blue.x + homing.acquireRadius + 200 });
          t = until(castAt(t, blue.x, blue.y + 1));
          if (t.projectiles.length) throw new Error('찾는 범위 밖의 적에게 투사체가 나갔습니다');
          // 피해 공식 (추가 공격력 반영)
          const dmg = homing.onHit.find((e) => e.type === 'damage');
          t = patch(duel(id, 500), 'a', { attackDamage: start.attackDamage + 40 });
          let r = run(castAt(t, blue.x, blue.y + 1), 60);
          const ev = r.evs.find((e) => e.type === 'damage' && e.skill === key);
          if (!ev) throw new Error('유도 투사체가 맞지 않았습니다');
          const raw = dmg.base[0] + 40 * (dmg.bonusAdRatio ?? 0) + (start.attackDamage + 40) * (dmg.adRatio ?? 0);
          if (Math.abs(ev.raw - raw) > 1e-9 || ev.damageType !== dmg.damageType) throw new Error(`피해가 공식과 다릅니다 (${ev.raw}, 예상 ${raw})`);
          if (homing.onHit.some((e) => e.type === 'reveal') && !(r.s.players.b.revealed >= 0)) throw new Error('시야 기록이 없습니다');
          // 다른 스킬의 표식을 터뜨린다: 마나 = 표식의 base + 이 스킬 마나 소모량
          const markKey = Object.keys(CHAMPIONS[id].skills).find((k) => CHAMPIONS[id].skills[k].effects.some((e) => e.onHit?.some((h) => h.type === 'applyMark')));
          if (markKey) {
            t = patch(duel(id, 500), 'b', { marks: [{ ownerId: 'a', skill: markKey, remaining: 3 }] });
            t = patch(t, 'a', { mana: 100 });
            r = run(castAt(t, blue.x, blue.y + 1), 60);
            const restored = r.evs.filter((e) => e.type === 'manaRestore').reduce((n, e) => n + e.amount, 0);
            const markSpec = CHAMPIONS[id].skills[markKey].effects.flatMap((e) => e.onHit ?? []).find((h) => h.type === 'applyMark');
            const manaSpec = markSpec.onDetonate.find((e) => e.type === 'restoreMana');
            if (!r.evs.some((e) => e.type === 'markDetonate')) throw new Error(`${markKey} 표식이 터지지 않았습니다`);
            if (manaSpec && restored !== manaSpec.base + data.manaCost[0]) throw new Error(`표식을 터뜨렸을 때 마나 회복이 다릅니다 (${restored})`);
          }
        }
        console.log(`✓ ${id} ${key} ${data.name} (위치 지정: 최대 ${range}·사거리 안·벽·시전 중 밀림·점멸 조합${homing ? ` / 유도 투사체: 우선순위 ${homing.priority}, 범위 ${homing.acquireRadius}, 대상 없으면 안 나감, 피해 공식, 표식 터뜨림` : ''})`);
      } catch (e) {
        fail(`${id} ${key} 스킬: ${e.message}`);
      }
    }
  }

  // 12. 투사체 세부 옵션: 시전 시작 위치에서 발사(origin castStart), 챔피언이 아닌 대상 피해(nonChampionBase), 궁극기 레벨 상한
  for (const id in CHAMPIONS) {
    for (const key in CHAMPIONS[id].skills ?? {}) {
      const data = CHAMPIONS[id].skills[key];
      const proj = data.effects.find((e) => e.type === 'projectile');
      if (!proj) continue;
      const dmg = proj.onHit.find((e) => e.type === 'damage');
      try {
        const { blue } = createGameState().map.spawns;
        const patch = (s, pid, p) => ({ ...s, players: { ...s.players, [pid]: { ...s.players[pid], ...p } } });
        // 레벨 상한: 레벨별 배열 길이
        let s = step(duel(id, 2000), [{ playerId: 'a', type: 'debug', action: 'setSkillLevel', skill: key, value: 99 }]);
        if (s.players.a.skills[key].level !== data.manaCost.length) throw new Error(`레벨 상한이 ${data.manaCost.length}이 아닙니다 (${s.players.a.skills[key].level})`);
        if (proj.origin === 'castStart') {
          s = step(duel(id, 2000), [{ playerId: 'a', type: 'cast', skill: key, x: blue.x + 3000, y: blue.y }]);
          s = patch(s, 'a', { y: blue.y - 300 }); // 시전 중 밀림
          while (s.players.a.casting) s = step(s);
          const p0 = s.projectiles.find((p) => p.skill === key);
          const startY = p0.y - p0.dirY * p0.speed * TICK_DT;
          if (!p0 || Math.abs(startY - blue.y) > 1e-6) throw new Error('시전 시작 위치에서 발사되지 않았습니다');
        }
        if (dmg?.nonChampionBase) {
          s = duel(id, 2000);
          s = addPlayer(s, { ...createPlayer({ id: 'm', name: 'M', team: 'red', x: blue.x + 400, y: blue.y, championId: id, isDummy: true }), unitType: 'minion' });
          s = step(s, [{ playerId: 'a', type: 'cast', skill: key, x: blue.x + 3000, y: blue.y }]);
          const evs = [];
          for (let i = 0; i < 90; i++) {
            s = step(s);
            evs.push(...s.events);
          }
          const a0 = s.players.a;
          const hitM = evs.find((e) => e.type === 'damage' && e.targetId === 'm');
          const hitB = evs.find((e) => e.type === 'damage' && e.targetId === 'b' && !e.mark);
          if (!hitM || Math.abs(hitM.raw - damageRaw(a0, dmg, 1, dmg.nonChampionBase)) > 1e-9) throw new Error('챔피언이 아닌 대상에게 nonChampionBase 피해가 들어가지 않았습니다');
          if (!hitB || Math.abs(hitB.raw - damageRaw(a0, dmg, 1)) > 1e-9) throw new Error('챔피언에게 base 피해가 들어가지 않았습니다');
        }
        if (proj.origin === 'castStart' || dmg?.nonChampionBase || data.manaCost.length !== 5) {
          console.log(`✓ ${id} ${key} ${data.name} 세부 (레벨 상한 ${data.manaCost.length}${proj.origin === 'castStart' ? ', 시전 시작 위치에서 발사' : ''}${dmg?.nonChampionBase ? ', 챔피언/비챔피언 피해 구분' : ''})`);
        }
      } catch (e) {
        fail(`${id} ${key} 세부: ${e.message}`);
      }
    }
  }

  // 13. 패시브 (trigger skillHit): 맞은 적 하나당 1중첩, 최대 중첩, 지속시간 갱신·만료, 표식 터짐·평타는 제외, 공격속도 반영
  for (const id in CHAMPIONS) {
    const pd = CHAMPIONS[id].passive;
    if (pd?.trigger !== 'skillHit') continue;
    try {
      const skills = CHAMPIONS[id].skills ?? {};
      const { blue } = createGameState().map.spawns;
      const patch = (s, pid, p) => ({ ...s, players: { ...s.players, [pid]: { ...s.players[pid], ...p } } });
      const run = (s, n) => {
        for (let i = 0; i < n; i++) s = step(s);
        return s;
      };
      const castAt = (s, k, x = blue.x + 3000, y = blue.y) => step(s, [{ playerId: 'a', type: 'cast', skill: k, x, y }]);
      // 쿨타임·마나 없음, 상대는 무적(여러 번 맞혀도 죽지 않게. 무적이어도 적중은 적중)
      const noCd = (s) => patch(patch(s, 'a', { noCooldown: true, infiniteMana: true }), 'b', { invulnerable: true });
      const stacks = (s) => s.players.a.passive.stacks;
      // 적을 맞히는 직선 투사체 스킬 하나 (처음 맞은 적만)
      const firstKey = Object.keys(skills).find((k) => skills[k].effects.some((e) => e.type === 'projectile' && e.collision === 'first' && e.onHit.some((h) => h.type === 'damage')));
      const pierceKey = Object.keys(skills).find((k) => skills[k].effects.some((e) => e.type === 'projectile' && e.collision === 'pierce'));
      const markKey = Object.keys(skills).find((k) => skills[k].effects.some((e) => e.onHit?.some((h) => h.type === 'applyMark')));

      // 평타로는 쌓이지 않음
      let s = run(step(duel(id), [attackB]), 60);
      if (stacks(s) !== 0) throw new Error('평타로 중첩이 쌓였습니다');
      if (firstKey) {
        // 스킬 적중 → 1중첩, 시간 = duration
        s = run(castAt(noCd(duel(id, 400)), firstKey), 30);
        if (stacks(s) !== 1) throw new Error(`스킬 적중 후 중첩이 ${stacks(s)}입니다 (예상 1)`);
        // 공격속도: 기본 × (1 + 중첩 × 값)
        s = step(s);
        const expectAs = s.players.a.baseAttackSpeed * (1 + pd.perStack.value * stacks(s));
        if (Math.abs(s.players.a.attackSpeed - expectAs) > 1e-9) throw new Error(`공격속도가 ${s.players.a.attackSpeed}입니다 (예상 ${expectAs})`);
        // 최대 중첩
        for (let i = 0; i < pd.maxStacks + 2; i++) s = run(castAt(s, firstKey), 25);
        if (stacks(s) !== pd.maxStacks) throw new Error(`최대 중첩을 넘었거나 못 미칩니다 (${stacks(s)})`);
        // 시간 갱신: 거의 끝날 때 다시 맞히면 duration으로
        s = run(s, Math.floor((pd.duration - 0.5) * 30));
        s = run(castAt(s, firstKey), 25);
        if (!(s.players.a.passive.remaining > pd.duration - 1)) throw new Error('다시 맞혔는데 지속시간이 갱신되지 않았습니다');
        // 만료: 한꺼번에 사라짐
        s = run(s, Math.ceil(pd.duration * 30) + 2);
        if (stacks(s) !== 0) throw new Error('지속시간이 끝났는데 중첩이 남아 있습니다');
      }
      if (pierceKey) {
        // 관통 스킬로 적 3명 → 3중첩
        s = noCd(duel(id, 400));
        s = addPlayer(s, createPlayer({ id: 'c', name: 'C', team: 'red', x: blue.x + 700, y: blue.y, championId: id, isDummy: true }));
        s = addPlayer(s, { ...createPlayer({ id: 'm', name: 'M', team: 'red', x: blue.x + 1000, y: blue.y, championId: id, isDummy: true }), unitType: 'minion' });
        s = run(castAt(s, pierceKey), 60);
        if (stacks(s) !== 3) throw new Error(`관통 스킬로 적 3명(미니언 포함)을 맞혔는데 중첩이 ${stacks(s)}입니다`);
      }
      if (markKey && firstKey) {
        // 표식 스킬: 부착 때 1중첩, 다른 스킬로 터뜨릴 때는 그 스킬 적중 1중첩만 (터짐은 제외) → 2
        s = noCd(duel(id, 400));
        s = run(castAt(s, markKey), 30);
        if (stacks(s) !== 1) throw new Error(`표식 부착 후 중첩이 ${stacks(s)}입니다 (예상 1)`);
        s = run(castAt(s, firstKey), 30);
        if (stacks(s) !== 2) throw new Error(`표식을 다른 스킬로 터뜨린 뒤 중첩이 ${stacks(s)}입니다 (예상 2, 터짐은 제외)`);
      }
      console.log(`✓ ${id} 패시브 ${pd.name} (맞은 적당 1중첩, 최대 ${pd.maxStacks}, ${pd.duration}초 갱신·만료, 평타·표식 터짐 제외, 중첩당 ${pd.perStack.kind} +${pd.perStack.value})`);
    } catch (e) {
      fail(`${id} 패시브: ${e.message}`);
    }
  }

  // 14. 근접 평타: 투사체 없이 즉시 적중 (검사용 임시 챔피언)
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

// 소환사 주문: 점멸
try {
  const id = Object.keys(CHAMPIONS)[0];
  const skills = CHAMPIONS[id].skills ?? {};
  const fl = SUMMONER_SPELLS.flash;
  const range = fl.targeting.range;
  const blue = TEST_MAP.spawns.blue;
  const flashAt = (x, y) => ({ playerId: 'a', type: 'summoner', slot: 'F', x, y });
  const patch = (s, pid, p) => ({ ...s, players: { ...s.players, [pid]: { ...s.players[pid], ...p } } });
  const base = () => {
    let s = duel(id, 3000);
    return patch(s, 'a', { x: blue.x + 1000 });
  };
  const ax = blue.x + 1000;
  // 사거리 안 → 커서 지점, 밖 → 커서 방향으로 사거리만큼, 쿨타임 시작, 쿨타임 중엔 안 됨
  let s = step(base(), [flashAt(ax + 250, blue.y)]);
  if (Math.abs(s.players.a.x - (ax + 250)) > 1e-6) throw new Error('사거리 안 커서 지점으로 점멸하지 않았습니다');
  if (!(s.players.a.summoners.F.cooldown > fl.cooldown - 0.1)) throw new Error('점멸 쿨타임이 시작되지 않았습니다');
  const x1 = s.players.a.x;
  s = step(s, [flashAt(x1 + 300, blue.y)]);
  if (s.players.a.x !== x1) throw new Error('쿨타임 중에 점멸이 되었습니다');
  s = step(base(), [flashAt(ax + 2000, blue.y)]);
  if (Math.abs(s.players.a.x - (ax + range)) > 1e-6) throw new Error(`사거리 밖 커서인데 ${(s.players.a.x - ax).toFixed(1)}만큼 이동했습니다 (예상 ${range})`);
  // 벽 쪽 → 통로 안
  s = step(patch(base(), 'a', { x: 100 }), [flashAt(-500, blue.y)]);
  if (s.players.a.x !== s.players.a.pathingRadius) throw new Error('벽 밖으로 점멸했습니다');
  // 이동 명령: 같은 방향이면 유지, 반대 방향이면 멈춤
  s = step(base(), [{ playerId: 'a', type: 'move', x: ax + 2000, y: blue.y }]);
  s = step(s, [flashAt(ax + 1000, blue.y + 200)]);
  if (!s.players.a.target) throw new Error('이동 방향과 비슷한 쪽으로 점멸했는데 이동이 멈췄습니다');
  s = step(base(), [{ playerId: 'a', type: 'move', x: ax + 2000, y: blue.y }]);
  s = step(s, [flashAt(ax - 1000, blue.y)]);
  if (s.players.a.target) throw new Error('이동 반대 방향으로 점멸했는데 계속 이동합니다');
  // 평타 명령 유지 + 선딜레이 중 점멸: 사거리 밖이 되어도 그 평타는 나간다
  s = duel(id, 400);
  s = step(s, [attackB]);
  if (s.players.a.attackWindup === null) throw new Error('선딜레이가 시작되지 않았습니다');
  s = step(s, [flashAt(blue.x - 2000, blue.y)]); // 뒤로 점멸 → 사거리 + 여유 밖
  if (s.players.a.attackWindup === null && !s.projectiles.some((p) => p.kind === 'attack')) throw new Error('선딜레이 중 점멸했더니 평타가 취소되었습니다');
  let fired = false;
  for (let i = 0; i < 30 && !fired; i++) {
    s = step(s);
    fired = s.projectiles.some((p) => p.kind === 'attack');
  }
  if (!fired) throw new Error('선딜레이 중 점멸한 뒤 평타가 나가지 않았습니다');
  if (s.players.a.attackTargetId !== 'b') throw new Error('점멸 뒤 평타 명령이 사라졌습니다');
  // 스킬 시전 중 점멸: 시전은 끊기지 않음. 시작 위치 발사 스킬은 처음 위치에서, 나머지는 점멸한 자리에서
  for (const key in skills) {
    const proj = skills[key].effects.find((e) => e.type === 'projectile');
    if (!proj || !(skills[key].activation.castTime > 0)) continue;
    s = step(duel(id, 3000), [{ playerId: 'a', type: 'cast', skill: key, x: blue.x + 3000, y: blue.y }]);
    s = step(s, [flashAt(blue.x, blue.y + 300)]);
    if (!s.players.a.casting) throw new Error(`${key} 시전 중 점멸했더니 시전이 끊겼습니다`);
    while (s.players.a.casting) s = step(s);
    const p0 = s.projectiles.find((p) => p.skill === key);
    const startY = p0.y - p0.dirY * p0.speed * TICK_DT;
    const expectY = proj.origin === 'castStart' ? blue.y : s.players.a.y;
    if (Math.abs(startY - expectY) > 1e-6) throw new Error(`${key} 발사 위치가 다릅니다 (${startY.toFixed(1)}, 예상 ${expectY.toFixed(1)})`);
  }
  // 쿨타임 없음 치트는 점멸에도 적용
  s = step(base(), [flashAt(ax + 100, blue.y)]);
  s = step(s, [{ playerId: 'a', type: 'debug', action: 'toggleNoCooldown' }]);
  if (s.players.a.summoners.F.cooldown !== 0) throw new Error('쿨타임 없음 치트가 점멸 쿨타임을 지우지 않았습니다');
  console.log(`✓ 점멸 (사거리 ${range}, 쿨타임 ${fl.cooldown}초, 벽, 이동 명령 각도 유지/멈춤, 선딜레이 유지, 스킬 시전 중 사용, 쿨타임 없음 치트)`);
} catch (e) {
  fail(`점멸: ${e.message}`);
}

// 대각선 맵 (실제 게임 맵): 통로 안 시작 지점, 벽 충돌·미끄러짐, 순간이동·어택땅 벽 처리, 라인을 따라 평타
try {
  const real = createRealGameState();
  const map = real.map;
  const { length, width } = map.lane;
  const inLane = (p, r = 35) => {
    const { u, v } = worldToLane(map, p.x, p.y);
    return u >= r - 1e-6 && u <= length - r + 1e-6 && Math.abs(v) <= width / 2 - r + 1e-6;
  };
  for (const team of ['blue', 'red']) {
    const sp = map.spawns[team];
    const { v } = worldToLane(map, sp.x, sp.y);
    if (!inLane(sp) || Math.abs(v) > 1e-6) throw new Error(`${team} 시작 지점이 통로 가운데에 있지 않습니다`);
  }
  const dir = laneDirection(map);
  const id = Object.keys(CHAMPIONS)[0];
  const blue = map.spawns.blue;
  const along = (d) => ({ x: blue.x + dir.x * d, y: blue.y + dir.y * d });
  let s = addPlayer(real, createPlayer({ id: 'a', name: 'A', team: 'blue', x: blue.x, y: blue.y, championId: id }));
  const bPos = along(600);
  s = addPlayer(s, createPlayer({ id: 'b', name: 'B', team: 'red', x: bPos.x, y: bPos.y, championId: id, isDummy: true }));
  // 통로 옆 벽 쪽(가로 방향)으로 멀리 우클릭 → 벽 앞에서 멈춤, 통로 밖으로 안 나감
  const side = { x: blue.x - dir.y * 5000, y: blue.y + dir.x * 5000 };
  let t = step(s, [{ playerId: 'a', type: 'move', x: side.x, y: side.y }]);
  for (let i = 0; i < 120; i++) t = step(t);
  const sideLane = worldToLane(map, t.players.a.x, t.players.a.y);
  if (!inLane(t.players.a) || Math.abs(Math.abs(sideLane.v) - (width / 2 - t.players.a.pathingRadius)) > 1e-6) throw new Error('통로 옆 벽 앞에서 멈추지 않았습니다');
  // 벽에 비스듬히 우클릭 → 벽을 따라 미끄러짐 (라인 방향으로 전진)
  const diag = { x: t.players.a.x + (dir.x - dir.y) * 3000, y: t.players.a.y + (dir.y + dir.x) * 3000 };
  const u0 = sideLane.u;
  t = step(t, [{ playerId: 'a', type: 'move', x: diag.x, y: diag.y }]);
  for (let i = 0; i < 60; i++) t = step(t);
  if (!(worldToLane(map, t.players.a.x, t.players.a.y).u > u0 + 200) || !inLane(t.players.a)) throw new Error('벽을 따라 미끄러지지 않았습니다');
  // 통로 밖을 찍은 순간이동·어택땅·순간이동 치트도 통로 안
  const outside = { x: 0, y: 0 };
  if (!inLane(clampToMap(outside.x, outside.y, 35, map))) throw new Error('벽 밖 지점이 통로 안으로 맞춰지지 않았습니다');
  // (어택땅은 적이 없는 상태에서: 적이 있으면 먼저 공격하느라 목적지까지 오래 걸림)
  const alone = addPlayer(real, createPlayer({ id: 'a', name: 'A', team: 'blue', x: blue.x, y: blue.y, championId: id }));
  t = step(alone, [{ playerId: 'a', type: 'attackMove', x: outside.x, y: outside.y }]);
  for (let i = 0; i < 30 * 40; i++) t = step(t);
  if (t.players.a.attackMoveTarget || !inLane(t.players.a)) throw new Error('벽 밖 어택땅이 끝나지 않았거나 통로 밖으로 나갔습니다');
  t = step(s, [{ playerId: 'a', type: 'debug', action: 'teleport', x: outside.x, y: outside.y }]);
  if (!inLane(t.players.a)) throw new Error('순간이동 치트가 통로 밖으로 보냈습니다');
  // 라인을 따라 평타
  t = step(s, [{ playerId: 'a', type: 'attack', targetId: 'b' }]);
  for (let i = 0; i < 90; i++) t = step(t);
  if (!(t.players.b.hp < t.players.b.maxHp)) throw new Error('라인 위의 적에게 평타가 맞지 않았습니다');
  // 허수아비 왔다 갔다: 라인 방향, 통로 안
  t = step(s, [{ playerId: 'a', type: 'debug', action: 'setDummyMode', targetId: 'b', mode: 'patrol' }]);
  let minU = Infinity;
  let maxU = -Infinity;
  for (let i = 0; i < 30 * 6; i++) {
    t = step(t);
    const { u } = worldToLane(map, t.players.b.x, t.players.b.y);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    if (!inLane(t.players.b)) throw new Error('왔다 갔다 하는 허수아비가 통로 밖으로 나갔습니다');
  }
  if (maxU - minU < 500) throw new Error('허수아비가 라인 방향으로 왔다 갔다 하지 않습니다');
  console.log(`✓ 대각선 맵 (${map.width.toFixed(0)}×${map.height.toFixed(0)} 안에 통로 ${length}×${width}: 시작 지점, 옆 벽 충돌, 벽 미끄러짐, 벽 밖 어택땅·순간이동, 라인 평타, 허수아비 왔다 갔다)`);
} catch (e) {
  fail(`대각선 맵: ${e.message}`);
}

// 포탑
try {
  const id = Object.keys(CHAMPIONS)[0];
  const champ = CHAMPIONS[id];
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
  // 포탑만 있는 상태 + 챔피언 목록 [{ id, team, x, y? }]
  const withTurrets = (units, opts = {}) => {
    let s = createGameState({ turrets: true, ...opts });
    for (const u of units) s = addPlayer(s, createPlayer({ championId: id, name: u.id, y: s.turrets['turret-blue'].y, ...u }));
    return s;
  };
  const run = (s, n, inputs = []) => {
    for (let i = 0; i < n; i++) s = step(s, i === 0 ? inputs : []);
    return s;
  };
  const tb = createGameState({ turrets: true }).turrets['turret-blue'];
  const tr = createGameState({ turrets: true }).turrets['turret-red'];
  for (const [t, pos] of [[tb, TURRET.positions.blue], [tr, TURRET.positions.red]]) {
    const l = worldToLane(TEST_MAP, t.x, t.y);
    if (!near(l.u, pos.u) || !near(l.v, pos.v)) throw new Error('포탑 위치가 통로 기준 좌표와 다릅니다');
  }
  // 미니언 통행로(라인 가운데)를 막지 않는다
  for (const t of [tb, tr]) {
    if (Math.abs(worldToLane(TEST_MAP, t.x, t.y).v) <= TURRET.obstacleRadius + MINIONS.melee.pathingRadius) throw new Error('포탑 지형이 미니언 통행로를 막습니다');
  }
  // 대각선 맵: 라인 방향 사이 3600, 맵 중앙 기준 점대칭
  const dt = createRealGameState().turrets;
  const db = dt['turret-blue'];
  const dr = dt['turret-red'];
  const realMap = createRealGameState().map;
  const lb = worldToLane(createRealGameState().map, db.x, db.y);
  const lr = worldToLane(createRealGameState().map, dr.x, dr.y);
  // 블루는 화면 왼쪽 위(x, y 모두 작아지는 쪽)로 비켜 있다
  const onLine = laneToWorldReal(createRealGameState().map, lb.u, 0);
  if (!(db.x < onLine.x && db.y < onLine.y)) throw new Error('블루 포탑이 라인 가운데에서 왼쪽 위로 비켜 있지 않습니다');
  if (!near(lr.u - lb.u, 3600, 1e-6) || !near(lb.v, -lr.v, 1e-6) || !near((db.x + dr.x) / 2, realMap.width / 2, 1e-6) || !near((db.y + dr.y) / 2, realMap.height / 2, 1e-6)) {
    throw new Error(`대각선 맵 포탑 위치가 다릅니다 (라인 방향 3600, 맵 중앙 점대칭): 파랑 (${db.x.toFixed(1)}, ${db.y.toFixed(1)}), 빨강 (${dr.x.toFixed(1)}, ${dr.y.toFixed(1)})`);
  }

  // 시간에 따른 능력치
  if (turretAttackDamage(0) !== 185 || turretAttackDamage(59.9) !== 185 || turretAttackDamage(60) !== 194 || turretAttackDamage(12 * 60) !== 293 || turretAttackDamage(30 * 60) !== 293) {
    throw new Error('포탑 공격력 성장이 185 + 9/분 (최대 293)이 아닙니다');
  }
  if (turretResist(0) !== 60 || turretResist(719) !== 60 || turretResist(720) !== 40) throw new Error('포탑 방어력이 12분에 60 → 40이 되지 않습니다');

  // 지형: 포탑을 가로질러 이동하면 돌아서 지나가고, 포탑 원 안으로 들어가지 않는다
  const minGap = TURRET.obstacleRadius + champ.pathingRadius;
  let s = withTurrets([{ id: 'a', team: 'red', x: tb.x - 600 }]);
  s = { ...s, turrets: {} }; // 공격받지 않게 포탑 유닛만 빼고 지형은 남긴다
  s = step(s, [{ playerId: 'a', type: 'move', x: tb.x + 600, y: tb.y }]);
  let minD = Infinity;
  for (let i = 0; i < 30 * 6; i++) {
    s = step(s);
    minD = Math.min(minD, Math.hypot(s.players.a.x - tb.x, s.players.a.y - tb.y));
  }
  if (minD < minGap - 1e-6) throw new Error(`포탑 지형 안으로 들어갔습니다 (중심 거리 ${minD.toFixed(1)})`);
  if (!(s.players.a.x > tb.x + 500)) throw new Error('포탑 지형에 막혀 반대편으로 지나가지 못했습니다');
  // 포탑 가운데를 찍으면 바깥이 목표, 순간이동·점멸로도 들어갈 수 없다
  s = withTurrets([{ id: 'a', team: 'blue', x: tb.x - 300 }]);
  let t = step(s, [{ playerId: 'a', type: 'move', x: tb.x, y: tb.y }]);
  if (Math.hypot(t.players.a.target.x - tb.x, t.players.a.target.y - tb.y) < minGap - 1e-6) throw new Error('포탑 지형 안이 이동 목표가 되었습니다');
  t = step(s, [{ playerId: 'a', type: 'summoner', slot: 'F', x: tb.x, y: tb.y }]);
  if (Math.hypot(t.players.a.x - tb.x, t.players.a.y - tb.y) < minGap - 1e-6) throw new Error('점멸로 포탑 지형 안에 들어갔습니다');
  t = step(s, [{ playerId: 'a', type: 'debug', action: 'teleport', x: tb.x + 10, y: tb.y }]);
  if (Math.hypot(t.players.a.x - tb.x, t.players.a.y - tb.y) < minGap - 1e-6) throw new Error('순간이동으로 포탑 지형 안에 들어갔습니다');

  // 사거리: 포탑 중심 ~ 챔피언 가장자리 750
  const edge = TURRET.range + champ.gameplayRadius;
  s = run(withTurrets([{ id: 'a', team: 'red', x: tb.x - edge - 1 }]), 5);
  if (s.turrets['turret-blue'].targetId) throw new Error('사거리 밖 챔피언을 대상으로 잡았습니다');
  s = run(withTurrets([{ id: 'a', team: 'red', x: tb.x - edge + 1 }]), 2);
  if (s.turrets['turret-blue'].targetId !== 'a') throw new Error('사거리 안 챔피언을 대상으로 잡지 않았습니다');
  if (s.turrets['turret-blue'].attackState !== 'acquire') throw new Error('새 대상을 잡았는데 포착 단계가 아닙니다');

  // 공격 흐름: 포착 8틱(0.25초) → 선딜레이 6틱(0.2초) → 발사, 이후 36틱(1.2초)마다
  const ACQ = Math.ceil(TURRET.acquireTime / TICK_DT - 1e-6);
  const WIN = Math.ceil(TURRET.windupTime / TICK_DT - 1e-6);
  const PERIOD = Math.round(1 / TURRET.attackSpeed / TICK_DT);
  const shotTicks = (st, n, until = 3) => {
    const out = [];
    for (let i = 0; i < n && out.length < until; i++) {
      st = step(st);
      if (st.projectiles.some((p) => p.kind === 'turret' && p.ownerId === 'turret-blue' && p.x === st.turrets['turret-blue'].x && p.y === st.turrets['turret-blue'].y)) out.push(st.tick);
    }
    return out;
  };
  let tk;
  {
    let q = withTurrets([{ id: 'a', team: 'red', x: tb.x - 400 }]);
    q = { ...q, players: { ...q.players, a: { ...q.players.a, invulnerable: true } } };
    tk = shotTicks(q, 120);
  }
  if (tk[0] !== ACQ + WIN || tk[1] - tk[0] !== PERIOD || tk[2] - tk[1] !== PERIOD) {
    throw new Error(`포탑 발사 틱 ${tk.join(', ')} (예상 ${ACQ + WIN}, ${ACQ + WIN + PERIOD}, ${ACQ + WIN + PERIOD * 2})`);
  }
  if (ACQ !== 8 || WIN !== 6 || PERIOD !== 36) throw new Error(`포착 ${ACQ}틱·선딜레이 ${WIN}틱·주기 ${PERIOD}틱 (예상 8·6·36)`);
  const moveA = (st, x) => ({ ...st, players: { ...st.players, a: { ...st.players.a, x, target: null } } });
  // 위빙: 포착 중 사거리 밖으로 나갔다 들어오면 포착을 처음부터
  {
    let q = withTurrets([{ id: 'a', team: 'red', x: tb.x - 400 }]);
    q = run(q, ACQ - 2);
    q = step(moveA(q, tb.x - 2000));
    if (q.turrets['turret-blue'].targetId || q.turrets['turret-blue'].attackState !== 'idle') throw new Error('포착 중 사거리를 나갔는데 포착이 취소되지 않았습니다');
    q = moveA(q, tb.x - 400);
    const t0 = q.tick;
    const w = shotTicks(q, 60, 1);
    if (w[0] - t0 !== ACQ + WIN) throw new Error(`다시 들어온 뒤 ${w[0] - t0}틱 만에 쐈습니다 (예상 ${ACQ + WIN}, 포착 처음부터)`);
  }
  // 선딜레이 중 사거리 밖 → 취소, 공격 타이머 0
  {
    let q = withTurrets([{ id: 'a', team: 'red', x: tb.x - 400 }]);
    q = run(q, ACQ + 2);
    if (q.turrets['turret-blue'].attackState !== 'windup') throw new Error('선딜레이 단계가 아닙니다');
    q = step(moveA(q, tb.x - 2000));
    const tt = q.turrets['turret-blue'];
    if (tt.windupTargetId || tt.attackTimer !== 0 || q.projectiles.some((p) => p.kind === 'turret')) throw new Error('선딜레이 중 사거리를 나갔는데 공격이 취소되지 않았습니다');
  }
  // 공격하던 대상을 잃고, 이미 사거리 안에 있던 적으로 바꾸면 포착 생략 / 대기 중 새로 들어온 적은 포착
  {
    let q = withTurrets([{ id: 'a', team: 'red', x: tb.x - 300 }, { id: 'b', team: 'red', x: tb.x + 600 }]);
    q = { ...q, players: { ...q.players, a: { ...q.players.a, invulnerable: true } } };
    q = run(q, ACQ + WIN + 2); // a에게 한 발 쏘고 쿨다운
    if (q.turrets['turret-blue'].targetId !== 'a' || q.turrets['turret-blue'].attackState !== 'cooldown') throw new Error('대상 바꾸기 검사 준비가 안 되었습니다');
    q = step(moveA(q, tb.x - 2000));
    if (q.turrets['turret-blue'].targetId !== 'b' || q.turrets['turret-blue'].acquireTimer !== null) throw new Error('이미 사거리 안에 있던 적으로 바꿀 때 포착을 다시 했습니다');
    // 포착 중에 대상을 잃으면 다음 대상은 포착을 다시 한다
    let r2 = withTurrets([{ id: 'a', team: 'red', x: tb.x - 300 }, { id: 'b', team: 'red', x: tb.x + 600 }]);
    r2 = run(r2, 3);
    r2 = step(moveA(r2, tb.x - 2000));
    if (r2.turrets['turret-blue'].targetId !== 'b' || r2.turrets['turret-blue'].attackState !== 'acquire') throw new Error('포착 중 대상을 잃었을 때 다음 대상을 포착하지 않았습니다');
  }
  if (s.turrets['turret-red'].targetId) throw new Error('같은 팀 포탑이 공격했습니다');

  // 피해: 185 × 방어 관통 30% × 피해 증가 (100%, 140%, 180%, 220%, 220%), 공격 주기 1/0.83초
  s = withTurrets([{ id: 'a', team: 'red', x: tb.x - 400 }]);
  s = { ...s, players: { ...s.players, a: { ...s.players.a, hp: 5000, maxHp: 5000 } } }; // 5발을 다 맞도록
  const hits = [];
  const hitTicks = [];
  for (let i = 0; i < Math.ceil(30 * 5.5 / TURRET.attackSpeed); i++) {
    s = step(s);
    for (const ev of s.events) if (ev.type === 'damage' && ev.sourceId === 'turret-blue') { hits.push(ev); hitTicks.push(s.tick); }
    if (hits.length >= 5) break;
  }
  const mult = armorMultiplier(champ.armor * (1 - TURRET.armorPen));
  const expectRaw = [1, 1.4, 1.8, 2.2, 2.2].map((m) => 185 * m);
  hits.forEach((ev, i) => {
    if (!near(ev.raw, expectRaw[i], 1e-6) || !near(ev.amount, expectRaw[i] * mult, 1e-6)) {
      throw new Error(`${i + 1}번째 포탑 공격 피해 ${ev.raw.toFixed(1)} → ${ev.amount.toFixed(1)} (예상 ${expectRaw[i].toFixed(1)} → ${(expectRaw[i] * mult).toFixed(1)})`);
    }
  });
  if (hits.length < 5) throw new Error(`포탑 공격이 ${hits.length}번만 맞았습니다`);
  const gap = (hitTicks[2] - hitTicks[1]) * TICK_DT;
  if (Math.abs(gap - 1 / TURRET.attackSpeed) > TICK_DT + 1e-6) throw new Error(`포탑 공격 간격 ${gap.toFixed(2)}초 (예상 ${(1 / TURRET.attackSpeed).toFixed(2)})`);
  // 3초 동안 안 맞으면 초기화: 사거리 밖으로 나갔다가 돌아온다
  let r = { ...s, players: { ...s.players, a: { ...s.players.a, x: tb.x - 2000, target: null } } };
  r = run(r, 30 * 3 + 30);
  if (r.turrets['turret-blue'].rampStacks !== 0) throw new Error('3초가 지나도 피해 증가가 초기화되지 않았습니다');
  // 3초 안에 다시 맞으면 유지 (대상이 바뀌어도): 다른 챔피언 b가 바로 들어온다
  r = { ...s, players: { ...s.players, a: { ...s.players.a, x: tb.x - 2000, target: null } } };
  r = addPlayer(r, createPlayer({ id: 'b', name: 'b', team: 'red', x: tb.x + 400, y: tb.y, championId: id }));
  let bHit = null;
  for (let i = 0; i < 60 && !bHit; i++) {
    r = step(r);
    bHit = r.events.find((ev) => ev.type === 'damage' && ev.targetId === 'b' && ev.sourceId === 'turret-blue');
  }
  if (!bHit || !near(bHit.raw, 185 * 2.2)) throw new Error(`대상을 바꾸니 피해 증가가 초기화되었습니다 (${bHit?.raw.toFixed(1)})`);

  // 대상 유지: 처음 잡은 대상이 사거리 안에 있으면 더 가까운 적이 와도 바꾸지 않는다
  s = run(withTurrets([{ id: 'a', team: 'red', x: tb.x - 600 }]), 3);
  s = addPlayer(s, createPlayer({ id: 'b', name: 'b', team: 'red', x: tb.x + 250, y: tb.y, championId: id }));
  s = run(s, 30);
  if (s.turrets['turret-blue'].targetId !== 'a') throw new Error('더 가까운 적이 오자 대상을 바꿨습니다');
  // 대상이 사거리 밖으로 나가면 다음 대상으로
  s = { ...s, players: { ...s.players, a: { ...s.players.a, x: tb.x - 2000 } } };
  s = run(s, 2);
  if (s.turrets['turret-blue'].targetId !== 'b') throw new Error('대상이 사거리 밖으로 나갔는데 다음 대상으로 바꾸지 않았습니다');
  // 처음 고를 때는 가장 가까운 적
  s = run(withTurrets([{ id: 'a', team: 'red', x: tb.x - 600 }, { id: 'b', team: 'red', x: tb.x + 300 }]), 2);
  if (s.turrets['turret-blue'].targetId !== 'b') throw new Error('가장 가까운 적을 먼저 고르지 않았습니다');
  // 타겟 불가가 되면 대상 해제, 날아가던 투사체도 사라진다
  s = run(withTurrets([{ id: 'a', team: 'red', x: tb.x - 700 }]), ACQ + WIN + 1);
  if (!s.projectiles.some((p) => p.kind === 'turret')) throw new Error('타겟 불가 검사용 포탑 투사체가 없습니다');
  s = step({ ...s, players: { ...s.players, a: { ...s.players.a, targetable: false } } });
  if (s.projectiles.some((p) => p.kind === 'turret') || s.turrets['turret-blue'].targetId) throw new Error('타겟 불가가 되었는데 포탑 투사체·대상이 남았습니다');

  // 어그로: 포탑 사거리 안의 적 챔피언(c)이 포탑 근처 아군 챔피언(ally)을 때리면 c로 전환
  s = withTurrets([
    { id: 'b', team: 'red', x: tb.x - 300 }, // 포탑이 먼저 잡는 대상
    { id: 'c', team: 'red', x: tb.x + 600 }, // 공격자
    { id: 'ally', team: 'blue', x: tb.x + 600 + champ.attack.range + champ.gameplayRadius * 2 - 50 },
  ]);
  s = run(s, 3);
  if (s.turrets['turret-blue'].targetId !== 'b') throw new Error('어그로 검사 준비: 포탑이 b를 잡지 않았습니다');
  s = step(s, [{ playerId: 'c', type: 'attack', targetId: 'ally' }]);
  let switched = false;
  for (let i = 0; i < 60 && !switched; i++) {
    s = step(s);
    switched = s.turrets['turret-blue'].targetId === 'c';
    if (!switched && s.events.some((ev) => ev.type === 'damage' && ev.targetId === 'ally')) throw new Error('아군이 맞았는데 어그로가 전환되지 않았습니다');
  }
  if (!switched) throw new Error('어그로가 전환되지 않았습니다');
  if (s.turrets['turret-blue'].acquireTimer !== null) throw new Error('어그로 전환인데 포착 단계를 거칩니다');
  // 선딜레이 중 어그로: 준비 중인 공격은 원래 대상(b)에게, 다음 공격부터 c
  {
    let q = withTurrets([
      { id: 'b', team: 'red', x: tb.x - 300 },
      { id: 'c', team: 'red', x: tb.x + 600 },
      { id: 'ally', team: 'blue', x: tb.x + 600 + champ.attack.range + champ.gameplayRadius * 2 - 50 },
    ]);
    q = { ...q, players: { ...q.players, b: { ...q.players.b, invulnerable: true }, ally: { ...q.players.ally, invulnerable: true } } };
    q = run(q, ACQ + 1); // b에게 선딜레이 시작
    if (q.turrets['turret-blue'].windupTargetId !== 'b') throw new Error('선딜레이 어그로 검사 준비가 안 되었습니다');
    const ev = { type: 'damage', targetId: 'ally', sourceId: 'c', raw: 10, amount: 0 };
    // 이번 틱에 c가 ally를 때린 피해 이벤트를 포탑 로직에 직접 넣어 확인
    const tt = { ...q.turrets['turret-blue'] };
    const units = { ...q.players, ...q.turrets, 'turret-blue': tt };
    updateTurret(tt, units, [ev], TICK_DT);
    if (tt.targetId !== 'c' || tt.windupTargetId !== 'b') throw new Error('선딜레이 중 어그로 전환 시 준비 중인 공격 대상이 바뀌었습니다');
  }
  // 무적(보호막)에 막혀도 전환
  s = withTurrets([
    { id: 'b', team: 'red', x: tb.x - 300 },
    { id: 'c', team: 'red', x: tb.x + 600 },
    { id: 'ally', team: 'blue', x: tb.x + 600 + champ.attack.range + champ.gameplayRadius * 2 - 50 },
  ]);
  s = run(s, 3);
  s = { ...s, players: { ...s.players, ally: { ...s.players.ally, invulnerable: true } } };
  s = step(s, [{ playerId: 'c', type: 'attack', targetId: 'ally' }]);
  switched = false;
  for (let i = 0; i < 60 && !switched; i++) {
    s = step(s);
    switched = s.turrets['turret-blue'].targetId === 'c';
  }
  if (!switched) throw new Error('피해가 막혔을 때 어그로가 전환되지 않았습니다');
  // 공격자가 포탑 사거리 밖이면 전환 안 됨
  s = withTurrets([
    { id: 'b', team: 'red', x: tb.x - 300 },
    { id: 'c', team: 'red', x: tb.x + 1000 },
    { id: 'ally', team: 'blue', x: tb.x + 1000 - champ.attack.range - champ.gameplayRadius * 2 + 50 },
  ]);
  s = run(s, 3);
  s = step(s, [{ playerId: 'c', type: 'attack', targetId: 'ally' }]);
  for (let i = 0; i < 60; i++) {
    s = step(s);
    if (s.turrets['turret-blue'].targetId === 'c') throw new Error('포탑 사거리 밖 공격자로 어그로가 전환되었습니다');
  }

  // 챔피언이 포탑 공격: 총 공격력 + 주문력 60%, 치명타 없음, 물리/마법은 추가 공격력 vs 주문력 60%
  const attackTurret = { playerId: 'a', type: 'attack', targetId: 'turret-red' };
  const firstTurretHit = (p) => {
    let q = withTurrets([{ id: 'a', team: 'blue', x: tr.x - 500, ...p }]);
    q = { ...q, players: { ...q.players, a: { ...q.players.a, ...p, invulnerable: true } } };
    q = step(q, [attackTurret]);
    for (let i = 0; i < 90; i++) {
      q = step(q);
      const ev = q.events.find((e) => e.type === 'damage' && e.targetId === 'turret-red');
      if (ev) return ev;
    }
    return null;
  };
  let ev = firstTurretHit({ critChance: 1 });
  if (!ev || ev.crit || !near(ev.raw, champ.attack.damage) || ev.damageType !== 'physical' || !near(ev.amount, champ.attack.damage * armorMultiplier(60))) {
    throw new Error(`포탑 평타 피해가 다릅니다 (${ev?.raw}, ${ev?.damageType}, 치명타 ${ev?.crit})`);
  }
  ev = firstTurretHit({ abilityPower: 100 });
  if (!ev || !near(ev.raw, champ.attack.damage + 60) || ev.damageType !== 'magic') throw new Error('주문력이 높을 때 포탑 평타가 마법 피해 (공격력 + 주문력 60%)가 아닙니다');
  ev = firstTurretHit({ attackDamage: champ.attack.damage + 80, abilityPower: 100 });
  if (!ev || !near(ev.raw, champ.attack.damage + 80 + 60) || ev.damageType !== 'physical') throw new Error('추가 공격력이 높을 때 포탑 평타가 물리 피해가 아닙니다');
  // 스킬은 포탑을 맞히지 않는다 (Q를 포탑 쪽으로)
  s = withTurrets([{ id: 'a', team: 'blue', x: tr.x - 500 }]);
  s = { ...s, players: { ...s.players, a: { ...s.players.a, invulnerable: true } } };
  s = run(s, 60, [{ playerId: 'a', type: 'cast', skill: 'Q', x: tr.x, y: tr.y }]);
  if (s.turrets['turret-red'].hp !== TURRET.maxHp) throw new Error('스킬이 포탑을 맞혔습니다');

  // 파괴: 체력 0 → 파괴, 공격 중단, 지형은 남는다
  s = withTurrets([{ id: 'a', team: 'blue', x: tr.x - 500 }]);
  s = { ...s, players: { ...s.players, a: { ...s.players.a, invulnerable: true } }, turrets: { ...s.turrets, 'turret-red': { ...s.turrets['turret-red'], hp: 1 } } };
  s = step(s, [attackTurret]);
  for (let i = 0; i < 90 && !s.turrets['turret-red'].destroyed; i++) s = step(s);
  const dead = s.turrets['turret-red'];
  if (!dead.destroyed || dead.hp !== 0 || dead.targetable !== false) throw new Error('체력 0인 포탑이 파괴되지 않았습니다');
  s = step(s);
  if (s.players.a.attackTargetId) throw new Error('파괴된 포탑을 계속 공격합니다');
  const shotsBefore = s.projectiles.filter((p) => p.ownerId === 'turret-red').length;
  s = run(s, 60);
  if (s.turrets['turret-red'].targetId || s.projectiles.filter((p) => p.ownerId === 'turret-red').length > shotsBefore) throw new Error('파괴된 포탑이 공격합니다');
  if (!s.map.obstacles.some((o) => o.id === 'turret-red')) throw new Error('파괴 후 포탑 지형이 사라졌습니다');
  t = step(s, [{ playerId: 'a', type: 'debug', action: 'teleport', x: tr.x, y: tr.y }]);
  if (Math.hypot(t.players.a.x - tr.x, t.players.a.y - tr.y) < minGap - 1e-6) throw new Error('파괴된 포탑 지형 안으로 들어갔습니다');
  // 체력 0 챔피언: 0에서 멈추고, 포탑은 더 이상 공격하지 않는다
  s = withTurrets([{ id: 'a', team: 'red', x: tb.x - 400 }]);
  s = { ...s, players: { ...s.players, a: { ...s.players.a, hp: 50 } } };
  s = run(s, 30 * 4);
  if (s.players.a.hp !== 0 || s.turrets['turret-blue'].targetId) throw new Error('체력 0 챔피언 처리 (0에서 멈춤, 대상 해제)가 다릅니다');

  console.log(`✓ 포탑 공격 흐름 (포착 ${ACQ}틱 → 선딜레이 ${WIN}틱 → 발사, ${PERIOD}틱 주기, 위빙, 선딜레이 취소, 사거리 안 적으로 바꾸면 포착 생략, 어그로 포착 생략·준비 중 공격 유지)`);
  console.log(`✓ 포탑 (위치 u,v=${TURRET.positions.blue.u},${TURRET.positions.blue.v}/${TURRET.positions.red.u},${TURRET.positions.red.v} 통행로 비킴, 지형 반경 ${TURRET.obstacleRadius}: 우회·점멸·순간이동 차단, 사거리 ${TURRET.range}, 피해 ${hits.map((h) => h.amount.toFixed(1)).join('/')}, 3초 초기화·대상 바뀌어도 유지, 대상 유지·가까운 순, 타겟 불가, 어그로 전환(막혀도)·사거리 밖 제외, 포탑 평타 물리/마법·치명타 없음, 스킬 무시, 파괴·지형 유지, 성장 185→293·방어 60→40)`);
} catch (e) {
  fail(`포탑: ${e.message}`);
}

// 미니언 M1: 웨이브 일정·구성, 업그레이드 능력치, 한 마리씩 생성, 라인 이동·충돌, 개발자 기능
try {
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  // 일정 전체 (40분까지): 웨이브별 시각과 구성 (파랑 기준)
  const w = createWaveState();
  const specs = updateWaves(w, 40 * 60, TEST_MAP);
  const waves = [];
  for (const sp of specs) {
    if (sp.team !== 'blue') continue;
    (waves[sp.wave - 1] ??= []).push(sp.type);
  }
  // 웨이브 시각: 일정 함수로 차례대로
  const times = [];
  for (let t = MINION_WAVES.firstWave; t <= 40 * 60; t += waveInterval(t)) times.push(t);
  const has = (list) => list.every((x) => times.some((t) => near(t, x, 1e-6)));
  if (times[0] !== 30 || times[1] !== 60 || !has([13 * 60 + 30, 14 * 60, 14 * 60 + 25, 29 * 60 + 25, 29 * 60 + 50, 30 * 60 + 10, 30 * 60 + 30])) {
    throw new Error(`웨이브 시각이 다릅니다: ${times.slice(0, 3).map(fmt)} … ${times.filter((t) => t > 13 * 60 && t < 14.5 * 60).map(fmt)} … ${times.filter((t) => t > 29 * 60 && t < 31 * 60).map(fmt)}`);
  }
  if (times.some((t) => !near(t, 14 * 60 + 25) && t > 14 * 60 && t < 14 * 60 + 25)) throw new Error('14분 전환이 다릅니다');
  if (waves.length !== times.length) throw new Error(`웨이브 수 ${waves.length} (일정 ${times.length})`);
  // 구성: 대포는 3번째 웨이브부터, 15분 전 3번째마다, 15분부터 2번째마다, 25분부터 매번
  const cannonWaves = waves.map((ws, i) => (ws.includes('cannon') ? i + 1 : 0)).filter(Boolean);
  if (cannonWaves[0] !== 3 || cannonWaves[1] !== 6) throw new Error(`대포 웨이브가 3, 6번째가 아닙니다: ${cannonWaves.slice(0, 4)}`);
  for (let i = 1; i < cannonWaves.length; i++) {
    const t = times[cannonWaves[i] - 1];
    const gap = cannonWaves[i] - cannonWaves[i - 1];
    const expect = t >= 25 * 60 ? 1 : t >= 15 * 60 ? 2 : 3;
    if (gap !== expect) throw new Error(`${fmt(t)} 대포 웨이브 간격 ${gap} (예상 ${expect})`);
  }
  waves.forEach((ws, i) => {
    const t = times[i];
    const c = ws.includes('cannon');
    const melee = ws.filter((x) => x === 'melee').length;
    const caster = ws.filter((x) => x === 'caster').length;
    const em = c && t >= 14 * 60 ? 2 : 3;
    const ec = t >= 30 * 60 ? 2 : 3;
    if (melee !== em || caster !== ec) throw new Error(`${fmt(t)} 웨이브 구성 근접 ${melee}·원거리 ${caster} (예상 ${em}·${ec})`);
    const order = ws.join(',');
    const expectOrder = [...Array(em).fill('melee'), ...(c ? ['cannon'] : []), ...Array(ec).fill('caster')].join(',');
    if (order !== expectOrder) throw new Error(`${fmt(t)} 생성 순서 ${order}`);
  });

  // 업그레이드: 첫 웨이브 1회, 90초마다 +1 / 표의 값
  if (upgradeCount(30) !== 1 || upgradeCount(119.9) !== 1 || upgradeCount(120) !== 2 || upgradeCount(8 * 60) !== 6) throw new Error('업그레이드 횟수가 다릅니다');
  const table = {
    1: [465, 11, 284, 21, 835, 37.5],
    6: [640, 14, 332, 31.25, 1260, 47.5],
    10: [780, 26, 380, 48.25, 1600, 63.5],
    26: [1340, 74, 572, 116.25, 2960, 126],
    29: [1445, 80, 600, 125, 3215, 126],
    30: [1480, 80, 600, 125, 3300, 126],
  };
  for (const n in table) {
    const got = [MINIONS.melee.hp, MINIONS.melee.attackDamage, MINIONS.caster.hp, MINIONS.caster.attackDamage, MINIONS.cannon.hp, MINIONS.cannon.attackDamage].map((st) => minionStat(st, Number(n)));
    if (got.some((v, i) => !near(v, table[n][i], 1e-9))) throw new Error(`${n}회 업그레이드 능력치 ${got.join('/')} (표 ${table[n].join('/')})`);
  }
  // 반경: 근접·원거리 판정·선택 39 / 이동 충돌 27.87185, 대포 45 / 32.87185
  for (const [t, g, pr] of [['melee', 39, 27.87185], ['caster', 39, 27.87185], ['cannon', 45, 32.87185]]) {
    const m = createMinion({ id: 'x', team: 'blue', type: t, upgrade: 1, wave: 1, map: TEST_MAP });
    if (m.gameplayRadius !== g || m.selectionRadius !== g || m.pathingRadius !== pr) throw new Error(`${t} 반경 ${m.gameplayRadius}/${m.selectionRadius}/${m.pathingRadius} (예상 ${g}/${g}/${pr})`);
  }
  if (minionStat(MINIONS.cannon.hp, 60) !== 5850 || minionStat(MINIONS.cannon.hp, 80) !== 5850) throw new Error('대포 체력 최대 5850이 아닙니다');

  // 생성: 0:30에 시작 지점에서 맨 앞(근접)부터 0.5초 간격으로 한 마리씩
  let s = createGameState({ minions: true });
  const spawnLog = [];
  for (let i = 0; i < 30 * 34; i++) {
    const before = new Set(Object.keys(s.minions));
    s = step(s);
    for (const id in s.minions) if (!before.has(id)) spawnLog.push({ t: s.time, m: s.minions[id] });
  }
  const blueLog = spawnLog.filter((e) => e.m.team === 'blue');
  if (blueLog.length !== 6 || spawnLog.length !== 12) throw new Error(`첫 웨이브 생성 수 ${blueLog.length}/${spawnLog.length}`);
  blueLog.forEach((e, i) => {
    if (!near(e.t, 30 + i * MINION_WAVES.spawnInterval, 1e-6)) throw new Error(`${i + 1}번째 미니언 생성 시각 ${e.t.toFixed(3)}`);
    if (e.m.minionType !== (i < 3 ? 'melee' : 'caster')) throw new Error(`${i + 1}번째 미니언이 ${e.m.minionType}`);
    if (e.m.upgrade !== 1 || e.m.maxHp !== (i < 3 ? 465 : 284)) throw new Error('첫 웨이브 능력치가 업그레이드 1회 값이 아닙니다');
  });
  // 생성 위치: 시작 지점 (생성된 틱에 한 틱만큼 움직였을 수 있다)
  const firstBlue = blueLog[0].m;
  if (Math.abs(worldToLane(TEST_MAP, firstBlue.x, firstBlue.y).u - TEST_MAP.spawns.blue.x) > MINION_WAVES.moveSpeed * TICK_DT + 1e-6) throw new Error('생성 위치가 시작 지점이 아닙니다');

  // 이동: 라인을 따라가며 포탑 지형에 들어가지 않고, 상대 진영 끝에 도착해 멈춘다
  s = createGameState({ minions: true, turrets: true });
  s = { ...s, turrets: {} }; // 포탑 공격 없이 지형만
  const obsMin = TURRET.obstacleRadius + MINIONS.melee.pathingRadius;
  let worst = Infinity;
  let offPath = false;
  const turretUs = s.map.obstacles.map((o) => worldToLane(TEST_MAP, o.x, o.y).u);
  for (let i = 0; i < 30 * 95; i++) {
    s = step(s);
    for (const m of Object.values(s.minions)) {
      for (const o of s.map.obstacles) worst = Math.min(worst, Math.hypot(m.x - o.x, m.y - o.y));
      // 포탑 옆을 지날 때 라인 가운데에서 벗어나지 않는다 (포탑 지형이 통행로를 막지 않음)
      const lm = worldToLane(TEST_MAP, m.x, m.y);
      if (turretUs.some((tu) => Math.abs(lm.u - tu) < 300) && Math.abs(lm.v) > 1e-6) offPath = true;
      const { u, v } = worldToLane(TEST_MAP, m.x, m.y);
      if (u < -1e-6 || u > TEST_MAP.lane.length + 1e-6 || Math.abs(v) > TEST_MAP.lane.width / 2 + 1e-6) throw new Error('미니언이 통로 밖으로 나갔습니다');
    }
    if (s.time > 31) s = { ...s, waves: { ...s.waves, enabled: false, queue: [] } }; // 첫 웨이브만
    s = { ...s, minions: Object.fromEntries(Object.entries(s.minions).filter(([, m]) => m.team === 'blue')) }; // 싸우지 않게 파랑만
  }
  if (worst < obsMin - 1e-6) throw new Error(`미니언이 포탑 지형 안으로 들어갔습니다 (${worst.toFixed(1)})`);
  if (offPath) throw new Error('포탑 지형이 미니언 통행로를 막아 미니언이 비켜 갔습니다');
  const blues = Object.values(s.minions).filter((m) => m.team === 'blue');
  const lead = Math.max(...blues.map((m) => worldToLane(TEST_MAP, m.x, m.y).u));
  if (!(lead > TEST_MAP.lane.length - 200)) throw new Error(`파랑 미니언이 상대 진영 끝에 도착하지 않았습니다 (u ${lead.toFixed(0)})`);
  const pos1 = blues.map((m) => `${m.x.toFixed(3)},${m.y.toFixed(3)}`).join(' ');
  s = run3(s, 30);
  const pos2 = Object.values(s.minions).filter((m) => m.team === 'blue').map((m) => `${m.x.toFixed(3)},${m.y.toFixed(3)}`).join(' ');
  if (pos1 !== pos2) throw new Error('끝에 도착한 미니언이 멈추지 않았습니다');
  // 미니언끼리 겹치지 않는다 (이동 충돌 반경)
  const ms = Object.values(s.minions);
  for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
    if (Math.hypot(ms[i].x - ms[j].x, ms[i].y - ms[j].y) < ms[i].pathingRadius + ms[j].pathingRadius - 1) throw new Error('미니언끼리 겹쳤습니다');
  }

  // 챔피언과 부딪힘: 라인 가운데 서 있는 챔피언을 돌아서 지나간다
  {
    const id = Object.keys(CHAMPIONS)[0];
    let q = createGameState({ minions: true });
    const c = laneToWorldTest(2000);
    q = addPlayer(q, createPlayer({ id: 'a', name: 'A', team: 'blue', x: c.x, y: c.y, championId: id })); // 같은 팀 (공격하지 않게)
    let minGap = Infinity;
    for (let i = 0; i < 30 * 40; i++) {
      q = step(q);
      // 첫 웨이브 유체화는 따로 검사한다 (여기서는 몸 충돌만)
      q = { ...q, minions: Object.fromEntries(Object.entries(q.minions).map(([k, m]) => [k, { ...m, ghosted: false, ghostTimer: 0 }])) };
      for (const m of Object.values(q.minions)) minGap = Math.min(minGap, Math.hypot(m.x - q.players.a.x, m.y - q.players.a.y) - m.pathingRadius - q.players.a.pathingRadius);
      if (q.time > 31) q = { ...q, waves: { ...q.waves, enabled: false, queue: [] } };
    }
    if (minGap < -1e-6) throw new Error(`미니언이 챔피언 몸을 통과했습니다 (${minGap.toFixed(1)})`);
    if (!Object.values(q.minions).some((m) => m.team === 'blue' && worldToLane(TEST_MAP, m.x, m.y).u > 2500)) throw new Error('챔피언에 막혀 미니언이 지나가지 못했습니다');
    // 챔피언도 미니언을 통과하지 못한다
    const blocker = Object.values(q.minions).find((m) => m.team === 'blue');
    let r = { ...q, minions: { [blocker.id]: { ...blocker, target: null } }, players: { ...q.players, a: { ...q.players.a, x: blocker.x - 300, y: blocker.y } } };
    r = step(r, [{ playerId: 'a', type: 'move', x: blocker.x + 300, y: blocker.y }]);
    let cg = Infinity;
    for (let i = 0; i < 60; i++) {
      r = step(r);
      cg = Math.min(cg, Math.hypot(r.players.a.x - blocker.x, r.players.a.y - blocker.y) - r.players.a.pathingRadius - blocker.pathingRadius);
    }
    if (cg < -1e-6) throw new Error('챔피언이 미니언 몸을 통과했습니다');
  }

  // 개발자 기능: 생성 끄기·켜기, 시간 건너뛰기, 지금 웨이브, 모두 제거
  const dbg = (action, extra = {}) => ({ playerId: 'x', type: 'debug', action, ...extra });
  s = createGameState({ minions: true });
  s = step(s, [dbg('setMinionSpawning', { value: false })]);
  s = run3(s, 30 * 35);
  if (Object.keys(s.minions).length || s.waves.waveCount !== 1) throw new Error('생성을 껐는데 미니언이 나왔거나 일정이 멈췄습니다');
  s = step(s, [dbg('setMinionSpawning', { value: true })]);
  if (!near(s.waves.nextWaveTime, 60)) throw new Error(`다시 켰을 때 다음 웨이브 ${s.waves.nextWaveTime} (예상 60)`);
  s = step(s, [dbg('skipTime', { value: 5 * 60 })]);
  if (!(s.time > 5 * 60) || s.turrets === undefined || !(s.waves.nextWaveTime > s.time) || s.waves.nextWaveTime - s.time > 30 + 1e-6) throw new Error('시간 건너뛰기 후 일정이 맞지 않습니다');
  if (Object.keys(s.minions).length) throw new Error('시간 건너뛰기로 지나간 웨이브가 한꺼번에 나왔습니다');
  s = step(s, [dbg('spawnWave', { cannon: true })]);
  s = run3(s, 30 * 4);
  const kinds = Object.values(s.minions).filter((m) => m.team === 'blue').map((m) => m.minionType);
  if (!kinds.includes('cannon') || kinds.length !== 7) throw new Error(`지금 웨이브(대포 포함) 생성이 다릅니다: ${kinds}`);
  if (Object.values(s.minions).some((m) => m.upgrade !== upgradeCount(5 * 60 + TICK_DT * 2))) throw new Error('지금 웨이브의 업그레이드가 현재 시각 기준이 아닙니다');
  s = step(s, [dbg('clearMinions')]);
  if (Object.keys(s.minions).length) throw new Error('미니언 모두 제거가 되지 않았습니다');

  console.log(`✓ 미니언 생성·이동 (웨이브 ${times.length}개/40분: 0:30 시작, 14:00→14:25, 29:50→30:10, 대포 3·2·1웨이브마다, 14분 근접 2·30분 원거리 2, 업그레이드 표, 0.5초 간격 한 마리씩, 라인 이동·끝에서 정지, 포탑 지형·챔피언·미니언 충돌, 생성 끄기·시간 건너뛰기·지금 웨이브·제거)`);
} catch (e) {
  fail(`미니언: ${e.message}`);
}

// 미니언 M2: 공격·피해 규칙, 대상 우선순위, 챔피언·스킬이 미니언을 공격, 죽음
try {
  const id = Object.keys(CHAMPIONS)[0];
  const champ = CHAMPIONS[id];
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
  // 미니언·챔피언을 통로 좌표(u, v)에 놓은 상태
  const world = ({ minions = [], champs = [], turrets = false } = {}) => {
    let q = createGameState({ turrets });
    const ms = {};
    for (const m of minions) {
      const mm = createMinion({ id: m.id, team: m.team, type: m.type, upgrade: m.upgrade ?? 1, wave: 2, map: TEST_MAP });
      const pos = laneToWorldTest(m.u, m.v ?? 0);
      ms[m.id] = { ...mm, x: pos.x, y: pos.y, target: null, ...(m.patch ?? {}) };
    }
    q = { ...q, minions: ms };
    for (const c of champs) {
      const pos = laneToWorldTest(c.u, c.v ?? 0);
      q = addPlayer(q, createPlayer({ id: c.id, name: c.id, team: c.team, x: pos.x, y: pos.y, championId: id, isDummy: c.dummy ?? false }));
      if (c.patch) q = { ...q, players: { ...q.players, [c.id]: { ...q.players[c.id], ...c.patch } } };
    }
    return q;
  };
  const dmgEvents = (q, n, filter) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      q = step(q);
      for (const ev of q.events) if (ev.type === 'damage' && filter(ev)) out.push({ ...ev, tick: q.tick });
    }
    return { q, out };
  };

  // 근접 vs 근접: 선딜레이 0.2초(6틱) 뒤 피해 = 공격력 + 대상 현재 체력 2%, 이후 1/1.25초마다
  {
    let q = world({ minions: [{ id: 'b1', team: 'blue', type: 'melee', u: 3000 }, { id: 'r1', team: 'red', type: 'melee', u: 3000 + MINIONS.melee.gameplayRadius * 2 + 100 }] });
    q = { ...q, minions: { ...q.minions, r1: { ...q.minions.r1, attackSpeed: 0.01 } } }; // r1은 거의 안 때림
    const { out } = dmgEvents(q, 60, (ev) => ev.sourceId === 'b1');
    if (!out.length) throw new Error('근접 미니언이 적 미니언을 때리지 않았습니다');
    if (out[0].tick !== Math.ceil(MINIONS.melee.windup / TICK_DT - 1e-6)) throw new Error(`근접 첫 타 틱 ${out[0].tick} (예상 ${Math.ceil(MINIONS.melee.windup / TICK_DT - 1e-6)})`);
    if (!near(out[0].raw, 11 + 465 * 0.02)) throw new Error(`근접 → 미니언 피해 ${out[0].raw} (예상 ${11 + 465 * 0.02})`);
    if (!near(out[1].raw, 11 + (465 - out[0].amount) * 0.02)) throw new Error('두 번째 타의 추가 피해가 현재 체력 기준이 아닙니다');
    const gap = out[1].tick - out[0].tick;
    if (Math.abs(gap * TICK_DT - 1 / 1.25) > TICK_DT + 1e-6) throw new Error(`근접 공격 간격 ${gap}틱`);
  }
  // 원거리 → 챔피언: 투사체, 60% (방어력 적용) / 대포 → 포탑: 84% / 근접 → 포탑: 60%
  {
    let q = world({ minions: [{ id: 'b1', team: 'blue', type: 'caster', u: 3000 }], champs: [{ id: 'c', team: 'red', u: 3400, dummy: true }] });
    let sawShot = false;
    let hit = null;
    for (let i = 0; i < 90 && !hit; i++) {
      q = step(q);
      if (q.projectiles.some((p) => p.kind === 'minion' && p.ownerId === 'b1')) sawShot = true;
      hit = q.events.find((ev) => ev.type === 'damage' && ev.sourceId === 'b1');
    }
    if (!sawShot || !hit) throw new Error('원거리 미니언 투사체가 챔피언을 맞히지 않았습니다');
    if (!near(hit.raw, 21 * 0.6) || !near(hit.amount, 21 * 0.6 * armorMultiplier(champ.armor))) throw new Error(`원거리 → 챔피언 피해 ${hit.raw}/${hit.amount}`);
    const tr = createGameState({ turrets: true }).turrets['turret-red'];
    const tu = worldToLane(TEST_MAP, tr.x, tr.y);
    for (const [type, mult] of [['cannon', 0.84], ['melee', 0.6]]) {
      let w = world({ minions: [{ id: 'b1', team: 'blue', type, u: tu.u - 250, v: tu.v }], turrets: true });
      w = { ...w, turrets: { ...w.turrets, 'turret-red': { ...w.turrets['turret-red'], range: 0 } } }; // 포탑은 쏘지 않게
      const { out } = dmgEvents(w, 90, (ev) => ev.sourceId === 'b1' && ev.targetId === 'turret-red');
      const ad = minionStat(MINIONS[type].attackDamage, 1);
      if (!out.length || !near(out[0].raw, ad * mult) || !near(out[0].amount, ad * mult * armorMultiplier(60))) throw new Error(`${type} → 포탑 피해 ${out[0]?.raw} (예상 ${ad * mult})`);
    }
  }
  // 우선순위: 적 미니언(5)이 적 챔피언(6)보다 먼저
  {
    let q = world({ minions: [{ id: 'b1', team: 'blue', type: 'caster', u: 3000 }, { id: 'r1', team: 'red', type: 'melee', u: 3450, patch: { attackSpeed: 0.01 } }], champs: [{ id: 'c', team: 'red', u: 3200, dummy: true }] });
    q = step(q);
    if (q.minions.b1.attackTargetId !== 'r1') throw new Error(`가까운 챔피언보다 미니언을 먼저 노려야 합니다 (${q.minions.b1.attackTargetId})`);
    // 아군 챔피언을 공격하는 적 챔피언(1): 1000 안이면 바꾼다 (다음 평타를 쏠 때)
    q = world({
      minions: [{ id: 'b1', team: 'blue', type: 'caster', u: 3000 }, { id: 'r1', team: 'red', type: 'melee', u: 3450, patch: { attackSpeed: 0.01, laneEnd: null } }],
      champs: [{ id: 'enemy', team: 'red', u: 3000, v: 700 }, { id: 'ally', team: 'blue', u: 3000 + 500, v: 700, patch: { invulnerable: true } }],
    });
    // enemy는 b1에서 700 떨어져 있다 (탐색 500 밖, 1000 안)
    q = step(q, [{ playerId: 'enemy', type: 'attack', targetId: 'ally' }]);
    let switched = false;
    for (let i = 0; i < 150 && !switched; i++) {
      q = step(q);
      switched = q.minions.b1.attackTargetId === 'enemy';
    }
    if (!switched) throw new Error('아군 챔피언을 공격하는 적 챔피언으로 대상을 바꾸지 않았습니다');
    // 같은 순위로는 바꾸지 않는다: 미니언 r1을 노리는 중에 더 가까운 미니언 r2가 와도 그대로
    q = world({ minions: [{ id: 'b1', team: 'blue', type: 'caster', u: 3000 }, { id: 'r1', team: 'red', type: 'melee', u: 3450, patch: { attackSpeed: 0.01 } }] });
    q = run3(q, 3);
    if (q.minions.b1.attackTargetId !== 'r1') throw new Error('같은 순위 검사 준비가 안 되었습니다');
    const r2 = createMinion({ id: 'r2', team: 'red', type: 'melee', upgrade: 1, wave: 2, map: TEST_MAP });
    const p2 = laneToWorldTest(3150);
    q = { ...q, minions: { ...q.minions, r2: { ...r2, x: p2.x, y: p2.y, target: null, attackSpeed: 0.01, hp: 5000, maxHp: 5000 } } };
    q = { ...q, minions: { ...q.minions, r1: { ...q.minions.r1, hp: 5000, maxHp: 5000 } } };
    for (let i = 0; i < 90; i++) {
      q = { ...q, minions: { ...q.minions, r1: { ...q.minions.r1, target: null }, r2: { ...q.minions.r2, target: null } } };
      q = step(q);
      if (q.minions.b1.attackTargetId !== 'r1') throw new Error('같은 순위의 더 가까운 대상으로 바꿨습니다');
    }
    // 쫓는 중에는 매 틱 다시 고른다: 도망치는 챔피언(6)을 쫓다가 적 미니언(5)이 탐색 범위에 들어오면 바로 바꾼다
    {
      let k = world({ minions: [{ id: 'r1', team: 'red', type: 'melee', u: 3000 }], champs: [{ id: 'me', team: 'blue', u: 2700 }] });
      k = run3(k, 2);
      if (k.minions.r1.attackTargetId !== 'me') throw new Error('추적 검사 준비: 미니언이 챔피언을 노리지 않았습니다');
      // 챔피언은 계속 도망 (사거리 밖 유지)
      const flee = laneToWorldTest(500);
      k = step(k, [{ playerId: 'me', type: 'move', x: flee.x, y: flee.y }]);
      k = run3(k, 15);
      if (k.minions.r1.attackTargetId !== 'me' || k.minions.r1.attackState !== 'chase') throw new Error('도망치는 챔피언을 쫓지 않습니다');
      const b = createMinion({ id: 'b1', team: 'blue', type: 'melee', upgrade: 1, wave: 2, map: TEST_MAP });
      const bp = { x: k.minions.r1.x + 400, y: k.minions.r1.y };
      k = { ...k, minions: { ...k.minions, b1: { ...b, ...bp, target: null, laneEnd: null, attackSpeed: 0.01 } } };
      k = step(k);
      if (k.minions.r1.attackTargetId !== 'b1') throw new Error('쫓는 중 더 높은 순위(적 미니언)가 생겼는데 바로 바꾸지 않았습니다');
    }
    // 대상이 leash(1000)보다 멀어지면 놓고 라인 끝으로 다시 걷는다
    q = { ...q, minions: { b1: q.minions.b1, r1: { ...q.minions.r1, ...laneToWorldTest(3000 + MINION_COMBAT.leashRange + 200, 0) } } };
    q = step(q);
    if (q.minions.b1.attackTargetId) throw new Error('너무 멀어진 대상을 놓지 않았습니다');
    if (!q.minions.b1.target) throw new Error('대상을 놓은 뒤 라인 끝으로 걷지 않습니다');
  }
  // 챔피언이 미니언을 공격 (우클릭), 스킬: Q는 첫 미니언에 막힘, W(챔피언만)는 통과. 죽으면 사라지고 막타 기록
  {
    let q = world({ minions: [{ id: 'r1', team: 'red', type: 'melee', u: 3300, patch: { laneEnd: null } }], champs: [{ id: 'a', team: 'blue', u: 3000, patch: { attackDamage: 1000 } }] });
    q = { ...q, minions: { ...q.minions, r1: { ...q.minions.r1, attackSpeed: 0.01 } } };
    q = step(q, [{ playerId: 'a', type: 'attack', targetId: 'r1' }]);
    let death = null;
    for (let i = 0; i < 90 && !death; i++) {
      q = step(q);
      death = q.events.find((ev) => ev.type === 'minionDeath');
    }
    if (!death || death.killerId !== 'a' || q.minions.r1) throw new Error('챔피언 평타로 미니언이 죽지 않았거나 막타 기록이 다릅니다');
    q = step(q);
    if (q.players.a.attackTargetId) throw new Error('죽은 미니언을 계속 공격합니다');
    // Q: 미니언이 앞에 있으면 미니언이 맞고 뒤의 챔피언은 안 맞는다
    q = world({ minions: [{ id: 'r1', team: 'red', type: 'melee', u: 3300, patch: { attackSpeed: 0.01, hp: 5000, maxHp: 5000 } }], champs: [{ id: 'a', team: 'blue', u: 3000 }, { id: 'e', team: 'red', u: 3600, dummy: true }] });
    q = step(q, [{ playerId: 'a', type: 'cast', skill: 'Q', x: laneToWorldTest(4000).x, y: laneToWorldTest(4000).y }]);
    const { q: q2, out } = dmgEvents(q, 60, (ev) => ev.sourceId === 'a');
    if (!out.some((ev) => ev.targetId === 'r1' && ev.skill === 'Q') || out.some((ev) => ev.targetId === 'e')) throw new Error('Q가 앞의 미니언에 막히지 않았습니다');
    // W: 챔피언만 맞는 투사체는 미니언을 통과
    q = world({ minions: [{ id: 'r1', team: 'red', type: 'melee', u: 3300, patch: { attackSpeed: 0.01, hp: 5000, maxHp: 5000 } }], champs: [{ id: 'a', team: 'blue', u: 3000 }, { id: 'e', team: 'red', u: 3600, dummy: true }] });
    q = step(q, [{ playerId: 'a', type: 'cast', skill: 'W', x: laneToWorldTest(4000).x, y: laneToWorldTest(4000).y }]);
    const w = dmgEvents(q, 60, (ev) => ev.sourceId === 'a');
    if (w.q.minions.r1.marks.length || !w.q.players.e.marks.length) throw new Error('W가 미니언을 통과해 챔피언에게 붙지 않았습니다');
  }
  // 대상이 죽으면 날아가던 미니언 투사체도 사라진다
  {
    let q = world({ minions: [{ id: 'b1', team: 'blue', type: 'caster', u: 3000 }, { id: 'r1', team: 'red', type: 'melee', u: 3480, patch: { attackSpeed: 0.01, laneEnd: null } }] });
    for (let i = 0; i < 60 && !q.projectiles.some((p) => p.kind === 'minion'); i++) q = step(q);
    if (!q.projectiles.some((p) => p.kind === 'minion')) throw new Error('투사체 검사 준비가 안 되었습니다');
    q = step({ ...q, minions: { ...q.minions, r1: { ...q.minions.r1, hp: 0 } } });
    if (q.projectiles.some((p) => p.kind === 'minion') || q.minions.r1) throw new Error('죽은 미니언을 향한 투사체가 남았습니다');
  }

  console.log(`✓ 미니언 전투 (근접 즉시·원거리/대포 투사체, 선딜레이 ${MINIONS.melee.windup}/${MINIONS.caster.windup}초, 챔피언 60%·포탑 60%·대포→포탑 84%, 미니언끼리 현재 체력 % 추가, 우선순위 미니언>챔피언·아군 챔피언 공격자 1000까지·같은 순위 유지·쫓는 중 매 틱 재평가·leash, 챔피언 평타·Q 막힘·W 통과, 죽음·막타·투사체 소멸)`);
} catch (e) {
  fail(`미니언 전투: ${e.message}`);
}

// 막힘 처리: 앞이 막히면 둘레를 따라 돌아간다 (미니언·챔피언 공통)
try {
  const id = Object.keys(CHAMPIONS)[0];
  const mk = (mid, team, type, u, v, patch = {}) => {
    const m = createMinion({ id: mid, team, type, upgrade: 1, wave: 2, map: TEST_MAP });
    return { ...m, ...laneToWorldTest(u, v), target: null, laneEnd: null, ...patch };
  };
  // 1) 나란히 선 아군 2마리 뒤의 근접 미니언이 돌아서 앞의 적을 때린다
  {
    const wall = { moveSpeed: 0, attackSpeed: 0.001 };
    let q = createGameState();
    q = {
      ...q,
      minions: {
        back: mk('back', 'blue', 'melee', 3000, 0),
        w1: mk('w1', 'blue', 'melee', 3060, -28, wall),
        w2: mk('w2', 'blue', 'melee', 3060, 28, wall),
        enemy: mk('enemy', 'red', 'melee', 3300, 0, { moveSpeed: 0, attackSpeed: 0.001, hp: 99999, maxHp: 99999 }),
      },
    };
    let hit = false;
    for (let i = 0; i < 90 && !hit; i++) {
      q = step(q);
      hit = q.events.some((ev) => ev.type === 'damage' && ev.sourceId === 'back');
    }
    if (!hit) throw new Error(`아군 뒤에 막힌 근접 미니언이 돌아가지 못했습니다 (상태 ${q.minions.back.attackState}, 위치 u ${worldToLane(TEST_MAP, q.minions.back.x, q.minions.back.y).u.toFixed(0)})`);
  }
  // 2) 챔피언이 라인을 가로막은 미니언 줄을 돌아서 목적지에 도착하고, 도는 쪽을 바꾸며 떨지 않는다
  {
    let q = createGameState();
    const still = { moveSpeed: 0, attackSpeed: 0.001 };
    q = { ...q, minions: { m1: mk('m1', 'blue', 'melee', 2300, -55, still), m2: mk('m2', 'blue', 'melee', 2300, 0, still), m3: mk('m3', 'blue', 'melee', 2300, 55, still) } };
    q = addPlayer(q, createPlayer({ id: 'a', name: 'A', team: 'blue', ...laneToWorldTest(2000, 0), championId: id }));
    const dest = laneToWorldTest(2600, 0);
    q = step(q, [{ playerId: 'a', type: 'move', x: dest.x, y: dest.y }]);
    let flips = 0;
    let last = 0;
    let t;
    for (t = 0; t < 30 * 4 && q.players.a.target; t++) {
      q = step(q);
      const sd = q.players.a.avoidSide;
      if (sd && last && sd !== last) flips++;
      if (sd) last = sd;
    }
    if (q.players.a.target || Math.hypot(q.players.a.x - dest.x, q.players.a.y - dest.y) > 1e-6) throw new Error('미니언 줄을 돌아서 목적지에 도착하지 못했습니다');
    if (flips > 1) throw new Error(`돌아가는 쪽이 ${flips}번 바뀌었습니다 (떨림)`);
    const straight = 600 / CHAMPIONS[id].moveSpeed;
    if (t * TICK_DT > straight * 1.6) throw new Error(`돌아가는 데 너무 오래 걸렸습니다 (${(t * TICK_DT).toFixed(2)}초, 직선 ${straight.toFixed(2)}초)`);
  }
  // 3) 웨이브끼리 싸울 때 전투 구역의 미니언이 모두 전투에 참여한다 (걷기·멈춤 상태로 갇힌 미니언 없음)
  {
    let q = createGameState({ minions: true });
    const mid = TEST_MAP.lane.length / 2;
    for (const t of [60, 62, 64, 66]) {
      while (q.time < t) q = step(q);
      const idle = Object.values(q.minions).filter((m) => Math.abs(worldToLane(TEST_MAP, m.x, m.y).u - mid) < 900 && m.attackState === 'idle' && !m.attackTargetId);
      if (idle.length) throw new Error(`${t}초: 전투 구역에서 싸우지 않는 미니언 ${idle.length}마리`);
    }
  }
  console.log('✓ 막힘 처리 (아군 뒤 근접 미니언 우회 후 공격, 챔피언이 미니언 줄 우회·떨림 없음, 웨이브 전투에서 갇힌 미니언 없음)');
} catch (e) {
  fail(`막힘 처리: ${e.message}`);
}

// 첫 웨이브 특수 동작: 18초 유체화, 만나기 전 챔피언 무시(200 안 제외), 만나면 적 근접 셋에게 공격 나누기
try {
  const id = Object.keys(CHAMPIONS)[0];
  const R = MINION_WAVES.firstWaveRules;
  // 유체화: 생성 후 18초, 두 번째 웨이브는 아님
  let s = createGameState({ minions: true });
  s = run3(s, Math.round(30.6 / TICK_DT));
  const first = Object.values(s.minions).find((m) => m.team === 'blue' && m.waveIndex === 0);
  if (!first?.firstWave || !first.ghosted) throw new Error('첫 웨이브 미니언이 유체화 상태가 아닙니다');
  while (s.time < 30 + R.ghostTime - 0.1) s = step(s);
  if (!s.minions[first.id].ghosted) throw new Error('18초 전에 유체화가 풀렸습니다');
  while (s.time < 30 + R.ghostTime + 0.1) s = step(s);
  if (s.minions[first.id].ghosted) throw new Error('18초가 지나도 유체화가 풀리지 않았습니다');
  while (s.time < 60.6) s = step(s);
  const second = Object.values(s.minions).find((m) => m.wave === 2);
  if (!second || second.ghosted || second.firstWave) throw new Error('두 번째 웨이브가 첫 웨이브 규칙을 받았습니다');

  // 만나기 전: 400 떨어진 적 챔피언은 무시, 200 안이면 노린다
  const mkFirst = (team, type, u, v = 0, i = 0) => ({ ...createMinion({ id: `${team}${i}`, team, type, upgrade: 1, wave: 1, waveIndex: i, map: TEST_MAP }), ...laneToWorldTest(u, v), target: null, laneEnd: null });
  {
    let q = createGameState();
    const m = mkFirst('blue', 'caster', 3000);
    q = { ...q, minions: { [m.id]: m } };
    q = addPlayer(q, createPlayer({ id: 'far', name: 'far', team: 'red', ...laneToWorldTest(3000, 400), championId: id, isDummy: true }));
    q = run3(q, 5);
    if (q.minions[m.id].attackTargetId) throw new Error('적 웨이브를 만나기 전인데 400 떨어진 챔피언을 노렸습니다');
    q = addPlayer(q, createPlayer({ id: 'near', name: 'near', team: 'red', ...laneToWorldTest(3000, R.championIgnoreRange + 30), championId: id, isDummy: true }));
    q = run3(q, 2);
    if (q.minions[m.id].attackTargetId !== 'near') throw new Error('200 안에 들어온 챔피언을 노리지 않았습니다');
    // 만난 뒤에는 일반 규칙 (400 떨어진 챔피언도 대상 후보)
    const met = { ...q.minions[m.id], metEnemyWave: true };
    if (minionPriority(met, q.players.far, { ...q.players, ...q.minions }, []) === Infinity) throw new Error('적 웨이브를 만난 뒤에도 챔피언을 무시합니다');
  }

  // 만나면 공격 나누기: 웨이브 안 순서대로 적 근접 1·2·3번에게 번갈아 (양쪽 대칭)
  s = createGameState({ minions: true });
  let metAt = null;
  for (let i = 0; i < 30 * 70 && metAt === null; i++) {
    s = step(s);
    const fw = Object.values(s.minions).filter((m) => m.wave === 1);
    if (fw.length === 12 && fw.every((m) => m.metEnemyWave)) metAt = s.time;
  }
  if (metAt === null) throw new Error('첫 웨이브끼리 만나지 않았습니다');
  for (const team of ['blue', 'red']) {
    const enemy = team === 'blue' ? 'red' : 'blue';
    const enemyMelee = Object.values(s.minions).filter((m) => m.team === enemy && m.wave === 1 && m.minionType === 'melee').sort((a, b) => a.waveIndex - b.waveIndex);
    for (const m of Object.values(s.minions).filter((x) => x.team === team && x.wave === 1)) {
      const expect = enemyMelee[m.waveIndex % enemyMelee.length].id;
      if (m.assignedTargetId !== expect || m.attackTargetId !== expect) throw new Error(`${team} ${m.waveIndex}번(${m.minionType})의 배정 대상이 ${m.assignedTargetId} (예상 ${expect})`);
    }
  }
  // 배정된 대상이 죽으면 일반 규칙으로
  const anyBlue = Object.values(s.minions).find((m) => m.team === 'blue' && m.wave === 1 && m.waveIndex === 0);
  let k = { ...s, minions: { ...s.minions, [anyBlue.assignedTargetId]: { ...s.minions[anyBlue.assignedTargetId], hp: 0 } } };
  k = run3(k, 2);
  const after = k.minions[anyBlue.id];
  if (after.assignedTargetId) throw new Error('배정된 대상이 죽었는데 배정이 남았습니다');
  // 첫 웨이브 싸움이 양쪽 대칭: 끝날 때까지 양쪽 남은 수가 같다
  let q = s;
  for (let i = 0; i < 30 * 25; i++) {
    q = step(q);
    const fw = Object.values(q.minions).filter((m) => m.wave === 1);
    const b = fw.filter((m) => m.team === 'blue').length;
    const r = fw.filter((m) => m.team === 'red').length;
    if (Math.abs(b - r) > 1) throw new Error(`첫 웨이브 싸움이 한쪽으로 기울었습니다 (파랑 ${b}, 빨강 ${r}, ${q.time.toFixed(1)}초)`);
  }
  console.log(`✓ 첫 웨이브 (생성 후 ${R.ghostTime}초 유체화, 만나기 전 챔피언 무시·${R.championIgnoreRange} 안은 노림, ${metAt.toFixed(1)}초에 만나 적 근접 셋에게 공격 나누기, 배정 대상 사망 시 일반 규칙, 양쪽 대칭)`);
} catch (e) {
  fail(`첫 웨이브: ${e.message}`);
}

if (failed) {
  console.log('\n검사 실패: 위 항목을 고친 뒤 다시 실행하세요.');
  process.exit(1);
}
console.log('\n검사 통과');
