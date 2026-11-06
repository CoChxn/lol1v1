// `npm run check`: 챔피언 데이터 검사 + 짧은 게임 시뮬레이션 + 평타 타이머 규칙 검사
import { CHAMPIONS } from '../champions/index.js';
import { validateChampion } from '../champions/validate.js';
import { createGameState as createRealGameState, addPlayer } from '../state.js';
import { createLaneMap, clampToMap, worldToLane, laneDirection } from '../map.js';
import { createPlayer } from '../player.js';
import { update } from '../update.js';
import { TICK_DT } from '../constants.js';
import { armorMultiplier, physicalDamage, mitigate, damageRaw } from '../damage.js';

// 대부분의 검사는 같은 맵 코드를 '가로 통로'(각도 0)에서 돌린다: 좌표를 x 방향 거리로 쓰기 쉽게.
// 실제 게임의 대각선 통로는 아래 '대각선 맵' 검사에서 따로 확인한다.
const TEST_MAP = createLaneMap({ angle: 0, margin: 0 });
const createGameState = (opts = {}) => createRealGameState({ map: TEST_MAP, ...opts });

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
        // 시전 중 밀리면 그 위치 기준으로 다시 계산
        s = castAt(far(), start.x + 300, start.y);
        s = patch(s, 'a', { x: start.x + 100 });
        s = until(s);
        if (Math.abs(s.players.a.x - (start.x + 300)) > 1e-6) throw new Error('시전 중 밀린 위치 기준으로 다시 계산되지 않았습니다');

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
        console.log(`✓ ${id} ${key} ${data.name} (위치 지정: 최대 ${range}·사거리 안·벽·시전 중 밀림${homing ? ` / 유도 투사체: 우선순위 ${homing.priority}, 범위 ${homing.acquireRadius}, 대상 없으면 안 나감, 피해 공식, 표식 터뜨림` : ''})`);
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

if (failed) {
  console.log('\n검사 실패: 위 항목을 고친 뒤 다시 실행하세요.');
  process.exit(1);
}
console.log('\n검사 통과');
