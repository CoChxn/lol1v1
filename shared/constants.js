// 게임 전역 상수. 시간 단위는 초, 거리 단위는 월드 픽셀.

// 서버 게임 로직 실행 횟수(초당)
export const TICK_RATE = 30;
// 로직 한 번에 흐르는 시간(초)
export const TICK_DT = 1 / TICK_RATE;

// 아레나 크기(월드 단위): 길이 16,000 × 폭 1,700인 통로. 파랑이 x=0 쪽, 빨강이 x=16000 쪽 끝.
// 판정은 가로·세로 축 기준이고, 화면에서만 45° 돌려 대각선(파랑 왼쪽 아래, 빨강 오른쪽 위)으로 보여 준다.
export const MAP_WIDTH = 16000;
export const MAP_HEIGHT = 1700;

// 진영별 시작(부활) 지점
export const SPAWN_POINTS = {
  blue: { x: 400, y: MAP_HEIGHT / 2 },
  red: { x: MAP_WIDTH - 400, y: MAP_HEIGHT / 2 },
};

