// 아레나 맵: 큰 직사각형(width × height) 안에 통로(lane) 하나가 있고, 통로 밖은 모두 벽이다.
// 캐릭터는 통로 안에서만 움직일 수 있다 (clampToMap).
// 통로 안의 지형 원(map.obstacles, 예: 포탑)도 지나갈 수 없다.
//
// 통로는 시작점(x0, y0)에서 방향(dirX, dirY)으로 길이 length, 폭 width인 직사각형이다.
// 통로 기준 좌표: u = 통로 방향 거리 (0 ~ length), v = 가로 방향 거리 (-width/2 ~ width/2)
import { LANE_LENGTH, LANE_WIDTH, LANE_ANGLE, MAP_MARGIN, SPAWN_INSET } from './constants.js';

/**
 * 통로 맵 만들기. 통로가 딱 들어가는 직사각형에 margin만큼 여유를 둔다.
 * @param {object} [opts]
 * @param {number} [opts.angle]  통로 방향 (0 = 가로, -45° = 오른쪽 위)
 */
export function createLaneMap({ length = LANE_LENGTH, width = LANE_WIDTH, angle = LANE_ANGLE, margin = MAP_MARGIN } = {}) {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  // 통로 네 꼭짓점이 들어가는 크기
  const spanX = Math.abs(dirX) * length + Math.abs(dirY) * width;
  const spanY = Math.abs(dirY) * length + Math.abs(dirX) * width;
  // 시작점: 통로가 직사각형 안 여유(margin) 안쪽에 오도록
  const corners = [
    [0, -width / 2],
    [0, width / 2],
    [length, -width / 2],
    [length, width / 2],
  ].map(([u, v]) => ({ x: u * dirX - v * dirY, y: u * dirY + v * dirX }));
  const minX = Math.min(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const lane = { x0: margin - minX, y0: margin - minY, dirX, dirY, length, width };
  const map = {
    width: spanX + margin * 2,
    height: spanY + margin * 2,
    lane,
  };
  map.spawns = {
    blue: laneToWorld(map, SPAWN_INSET, 0),
    red: laneToWorld(map, length - SPAWN_INSET, 0),
  };
  return map;
}

/** 통로 기준 좌표(u, v) → 월드 좌표 */
export function laneToWorld(map, u, v) {
  const { x0, y0, dirX, dirY } = map.lane;
  return { x: x0 + u * dirX - v * dirY, y: y0 + u * dirY + v * dirX };
}

/** 월드 좌표 → 통로 기준 좌표(u, v) */
export function worldToLane(map, x, y) {
  const { x0, y0, dirX, dirY } = map.lane;
  const dx = x - x0;
  const dy = y - y0;
  return { u: dx * dirX + dy * dirY, v: -dx * dirY + dy * dirX };
}

/**
 * 좌표를 통로 안쪽(벽에서 radius만큼 떨어진 곳)으로 맞춘다. 벽 밖이면 가장 가까운 통로 안 지점.
 * (통로는 볼록한 직사각형이라 축별로 맞추면 가장 가까운 점이 되고, 벽을 따라 미끄러지게 된다)
 */
export function clampToMap(x, y, radius, map) {
  const { u, v } = worldToLane(map, x, y);
  const { length, width } = map.lane;
  const cu = Math.min(Math.max(u, radius), length - radius);
  const cv = Math.min(Math.max(v, -width / 2 + radius), width / 2 - radius);
  const p = cu === u && cv === v ? { x, y } : laneToWorld(map, cu, cv);
  return pushOutOfObstacles(p, radius, map);
}

/**
 * 지형 원(map.obstacles, 예: 포탑) 안이면 가장 가까운 바깥 지점으로 밀어낸다.
 * (포탑은 라인 가운데에 있어 밀려난 지점이 벽에 닿지 않는다)
 */
export function pushOutOfObstacles(p, radius, map) {
  if (!map.obstacles) return p;
  let { x, y } = p;
  for (const o of map.obstacles) {
    const min = o.radius + radius;
    let dx = x - o.x;
    let dy = y - o.y;
    const d = Math.hypot(dx, dy);
    if (d >= min) continue;
    if (d === 0) {
      // 정확히 가운데: 라인 가로 방향으로
      dx = -map.lane.dirY;
      dy = map.lane.dirX;
    } else {
      dx /= d;
      dy /= d;
    }
    x = o.x + dx * min;
    y = o.y + dy * min;
  }
  return x === p.x && y === p.y ? p : { x, y };
}

/** 라인 방향 단위 벡터 (파랑 → 빨강) */
export function laneDirection(map) {
  return { x: map.lane.dirX, y: map.lane.dirY };
}
