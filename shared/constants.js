// 게임 전역 상수. 시간 단위는 초, 거리 단위는 월드 픽셀.

// 서버 게임 로직 실행 횟수(초당)
export const TICK_RATE = 30;
// 로직 한 번에 흐르는 시간(초)
export const TICK_DT = 1 / TICK_RATE;

// 아레나 크기(월드 픽셀)
export const MAP_WIDTH = 2400;
export const MAP_HEIGHT = 1400;

// 진영별 시작(부활) 지점
export const SPAWN_POINTS = {
  blue: { x: 250, y: MAP_HEIGHT / 2 },
  red: { x: MAP_WIDTH - 250, y: MAP_HEIGHT / 2 },
};

// 캐릭터 기본값 (3-1에서 챔피언 데이터로 옮긴다)
export const PLAYER_RADIUS = 30;
export const DEFAULT_MOVE_SPEED = 330; // 픽셀/초
export const DEFAULT_MAX_HP = 600;
export const DEFAULT_MAX_MANA = 300;
