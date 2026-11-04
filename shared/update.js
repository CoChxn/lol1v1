// 게임 로직 한 틱. 순수 함수: 입력 상태를 바꾸지 않고 새 상태를 돌려준다.
import { setMoveTarget, movePlayer } from './movement.js';
import { applyDamage, spendMana, restoreFull } from './combat.js';

/**
 * @param {object} state  현재 게임 상태
 * @param {Array<object>} inputs  이번 틱에 처리할 입력 목록 (예: { playerId, type: 'move', x, y })
 * @param {number} dt  흐른 시간(초)
 * @returns {object} 다음 게임 상태
 */
export function update(state, inputs, dt) {
  // 원본을 바꾸지 않도록 플레이어를 복사해서 작업한다.
  const players = {};
  for (const id in state.players) {
    players[id] = { ...state.players[id] };
  }

  for (const input of inputs) {
    const player = players[input.playerId];
    if (!player) continue;

    if (input.type === 'move') {
      setMoveTarget(player, input.x, input.y, state.map);
    } else if (input.type === 'debug') {
      applyDebugInput(player, input.action);
    }
  }

  for (const id in players) {
    movePlayer(players[id], dt, state.map);
  }

  return {
    ...state,
    time: state.time + dt,
    tick: state.tick + 1,
    players,
  };
}

// 테스트용 입력 (Phase 4에서 서버는 개발 모드일 때만 허용한다)
function applyDebugInput(player, action) {
  if (action === 'damage') applyDamage(player, 100);
  else if (action === 'spendMana') spendMana(player, 50);
  else if (action === 'restore') restoreFull(player);
}
