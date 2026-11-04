// 게임 로직 한 틱. 순수 함수: 입력 상태를 바꾸지 않고 새 상태를 돌려준다.
import { setMoveTarget, movePlayer } from './movement.js';
import { applyDamage, spendMana, restoreFull } from './combat.js';
import { orderAttack, cancelAttack, updateAttack, updateProjectile } from './attack.js';

/**
 * @param {object} state  현재 게임 상태
 * @param {Array<object>} inputs  이번 틱에 처리할 입력 목록
 *   - { playerId, type: 'move', x, y }
 *   - { playerId, type: 'attack', targetId }
 * @param {number} dt  흐른 시간(초)
 * @returns {object} 다음 게임 상태
 */
export function update(state, inputs, dt) {
  // 원본을 바꾸지 않도록 복사해서 작업한다.
  const players = {};
  for (const id in state.players) {
    players[id] = { ...state.players[id] };
  }
  let projectiles = state.projectiles.map((p) => ({ ...p }));
  let nextId = state.nextId;

  // 1. 입력 처리
  for (const input of inputs) {
    const player = players[input.playerId];
    if (!player) continue;

    if (input.type === 'move') {
      cancelAttack(player);
      setMoveTarget(player, input.x, input.y, state.map);
    } else if (input.type === 'attack') {
      orderAttack(player, players[input.targetId]);
    } else if (input.type === 'debug') {
      applyDebugInput(players, player, input.action);
    }
  }

  // 2. 평타 진행 (추격 이동 목표 설정, 발사)
  for (const id in players) {
    const shot = updateAttack(players[id], players, state.map, dt);
    if (shot) projectiles.push({ id: nextId++, ...shot });
  }

  // 3. 이동
  for (const id in players) {
    movePlayer(players[id], players, dt, state.map);
  }

  // 4. 투사체 이동·적중
  projectiles = projectiles.filter((proj) => updateProjectile(proj, players, dt));

  return {
    ...state,
    time: state.time + dt,
    tick: state.tick + 1,
    players,
    projectiles,
    nextId,
  };
}

// 테스트용 입력 (Phase 4에서 서버는 개발 모드일 때만 허용한다)
function applyDebugInput(players, player, action) {
  if (action === 'damage') applyDamage(player, 100);
  else if (action === 'spendMana') spendMana(player, 50);
  else if (action === 'restore') {
    for (const id in players) restoreFull(players[id]);
  }
}
