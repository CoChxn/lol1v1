// 게임 상태 구조. 렌더링·네트워크와 무관한 순수 데이터만 담는다.
import { createLaneMap } from './map.js';

/**
 * 새 게임 상태를 만든다.
 * - time: 게임 시작 후 흐른 시간(초)
 * - tick: 실행된 로직 횟수
 * - map: 아레나 (직사각형 크기, 통로, 진영별 시작 지점). shared/map.js
 * - players: 플레이어 목록 { [id]: player }
 * - projectiles: 날아가는 투사체 목록
 * - nextId: 다음에 만들 투사체 등의 고유 번호
 * - rngSeed: 난수 시드 (치명타 등). 같은 시드면 같은 결과
 * - events: 이번 틱에 일어난 일 (데미지 등). 화면 효과용, 매 틱 새로 만든다
 */
export function createGameState({ seed = 1, map = createLaneMap() } = {}) {
  return {
    time: 0,
    tick: 0,
    map,
    players: {},
    projectiles: [],
    nextId: 1,
    rngSeed: seed,
    events: [],
  };
}

/** 플레이어를 추가한 새 상태를 돌려준다. */
export function addPlayer(state, player) {
  return {
    ...state,
    players: { ...state.players, [player.id]: player },
  };
}
