// `npm run check`: 챔피언 데이터 검사 + 짧은 게임 시뮬레이션
import { CHAMPIONS } from '../champions/index.js';
import { validateChampion } from '../champions/validate.js';
import { createGameState, addPlayer } from '../state.js';
import { createPlayer } from '../player.js';
import { update } from '../update.js';
import { TICK_DT } from '../constants.js';

let failed = false;

// 1. 데이터 검사
for (const id in CHAMPIONS) {
  const errors = validateChampion(CHAMPIONS[id]);
  if (errors.length) {
    failed = true;
    console.log(`✗ ${id}`);
    for (const e of errors) console.log(`    - ${e}`);
  } else {
    console.log(`✓ ${id} 데이터`);
  }
}

// 2. 시뮬레이션: 같은 챔피언끼리 20초 동안 이동·평타가 오류 없이 돌아가는지
if (!failed) {
  for (const id in CHAMPIONS) {
    try {
      let s = createGameState();
      const { blue } = s.map.spawns;
      s = addPlayer(s, createPlayer({ id: 'a', name: 'A', team: 'blue', x: blue.x, y: blue.y, championId: id }));
      s = addPlayer(s, createPlayer({ id: 'b', name: 'B', team: 'red', x: blue.x + 1100, y: blue.y, championId: id, isDummy: true }));
      const startHp = s.players.b.hp;
      for (let i = 0; i < 30 * 20; i++) {
        s = update(s, i === 0 ? [{ playerId: 'a', type: 'attack', targetId: 'b' }] : [], TICK_DT);
        for (const pid in s.players) {
          const p = s.players[pid];
          if (![p.x, p.y, p.hp, p.mana, p.moveSpeed].every(Number.isFinite)) throw new Error(`${pid}의 값이 숫자가 아닙니다`);
        }
      }
      if (CHAMPIONS[id].attack.damage > 0 && s.players.b.hp >= startHp) throw new Error('20초 동안 평타가 한 번도 맞지 않았습니다');
      console.log(`✓ ${id} 시뮬레이션 (20초 평타 후 상대 체력 ${startHp} → ${s.players.b.hp})`);
    } catch (e) {
      failed = true;
      console.log(`✗ ${id} 시뮬레이션: ${e.message}`);
    }
  }
}

if (failed) {
  console.log('\n검사 실패: 위 항목을 고친 뒤 다시 실행하세요.');
  process.exit(1);
}
console.log('\n검사 통과');
