// 게임 로직 한 틱. 순수 함수: 입력 상태를 바꾸지 않고 새 상태를 돌려준다.

/**
 * @param {object} state  현재 게임 상태
 * @param {Array<object>} inputs  이번 틱에 처리할 입력 목록 (예: { playerId, type: 'move', x, y })
 * @param {number} dt  흐른 시간(초)
 * @returns {object} 다음 게임 상태
 */
export function update(state, inputs, dt) {
  // TODO(2-3 이후): 입력 처리, 이동, 투사체, 충돌, 스킬 등
  return {
    ...state,
    time: state.time + dt,
    tick: state.tick + 1,
  };
}
