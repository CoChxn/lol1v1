// 게임 상태 구조. 렌더링·네트워크와 무관한 순수 데이터만 담는다.
import { MAP_WIDTH, MAP_HEIGHT } from './constants.js';

/**
 * 새 게임 상태를 만든다.
 * - time: 게임 시작 후 흐른 시간(초)
 * - tick: 실행된 로직 횟수
 * - map: 아레나 크기
 * - players: 플레이어 목록 { [id]: player }
 * - projectiles: 날아가는 투사체 목록
 */
export function createGameState() {
  return {
    time: 0,
    tick: 0,
    map: { width: MAP_WIDTH, height: MAP_HEIGHT },
    players: {},
    projectiles: [],
  };
}
