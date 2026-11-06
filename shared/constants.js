// 게임 전역 상수. 시간 단위는 초, 거리 단위는 월드 픽셀.

// 서버 게임 로직 실행 횟수(초당)
export const TICK_RATE = 30;
// 로직 한 번에 흐르는 시간(초)
export const TICK_DT = 1 / TICK_RATE;

// 아레나 (shared/map.js): 큰 직사각형 맵 안에 대각선 통로(라인)가 있고, 통로 밖은 모두 벽이다.
// 통로: 길이 16,000 × 폭 1,700. 파랑 끝이 왼쪽 아래, 빨강 끝이 오른쪽 위 (45°)
export const LANE_LENGTH = 16000;
export const LANE_WIDTH = 1700;
export const LANE_ANGLE = -Math.PI / 4; // 통로 방향 (화면 좌표에서 y가 아래로 늘어나므로 -45°가 오른쪽 위)
export const MAP_MARGIN = 400; // 통로를 감싸는 직사각형 바깥 여유 (벽)

// 진영별 시작(부활) 지점: 통로 양 끝에서 이만큼 안쪽, 폭 가운데
export const SPAWN_INSET = 400;

