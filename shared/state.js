// 게임 상태 구조. 렌더링·네트워크와 무관한 순수 데이터만 담는다.
import { MAP_WIDTH, MAP_HEIGHT, SPAWN_POINTS } from './constants.js';

/**
 * 새 게임 상태를 만든다.
 * - time: 게임 시작 후 흐른 시간(초)
 * - tick: 실행된 로직 횟수
 * - map: 아레나 크기와 진영별 시작 지점
 * - players: 플레이어 목록 { [id]: player }
 * - projectiles: 날아가는 투사체 목록
 * - nextId: 다음에 만들 투사체 등의 고유 번호
 * - deferredInputs: 다음 틱으로 미뤄진 입력
 */
export function createGameState() {
  return {
    time: 0,
    tick: 0,
    map: {
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      spawns: {
        blue: { ...SPAWN_POINTS.blue },
        red: { ...SPAWN_POINTS.red },
      },
    },
    players: {},
    projectiles: [],
    nextId: 1,
    deferredInputs: [], // 명령 잠금 때문에 다음 틱으로 미뤄진 입력
  };
}

/** 플레이어를 추가한 새 상태를 돌려준다. */
export function addPlayer(state, player) {
  return {
    ...state,
    players: { ...state.players, [player.id]: player },
  };
}
