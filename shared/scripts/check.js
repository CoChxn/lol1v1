// `npm run check`: 챔피언 데이터 검사 + 짧은 게임 시뮬레이션 + 평타 타이머 규칙 검사
import { CHAMPIONS } from '../champions/index.js';
import { validateChampion } from '../champions/validate.js';
import { createGameState, addPlayer } from '../state.js';
import { createPlayer } from '../player.js';
import { update } from '../update.js';
import { TICK_DT } from '../constants.js';

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
      console.log(`✓ ${id} 시뮬레이션 (20초 평타 후 상대 체력 ${startHp} → ${s.players.b.hp})`);
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
  }

  // 4. 근접 평타: 투사체 없이 즉시 적중 (검사용 임시 챔피언)
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
    if (s.players.b.hp !== s.players.b.maxHp - 10) throw new Error('근접 평타가 맞지 않았습니다');
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
