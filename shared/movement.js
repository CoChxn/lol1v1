// 이동 로직. 벽(맵 경계)은 통과할 수 없다.

/** 좌표를 맵 안쪽(반지름만큼 떨어진 곳)으로 제한한 값을 돌려준다. */
export function clampToMap(x, y, radius, map) {
  return {
    x: Math.min(Math.max(x, radius), map.width - radius),
    y: Math.min(Math.max(y, radius), map.height - radius),
  };
}

/** 이동 목표를 설정한다. 벽 바깥을 찍으면 가장 가까운 벽 안쪽 지점이 목표가 된다. */
export function setMoveTarget(player, x, y, map) {
  player.target = clampToMap(x, y, player.radius, map);
}

/**
 * 목표를 향해 dt초만큼 이동한다. (player는 update에서 복사한 객체라 직접 바꿔도 된다)
 * 남은 거리가 이번 이동량 이하이면 목표에 정확히 멈춘다 → 도착 지점에서 떨리지 않는다.
 */
export function movePlayer(player, dt, map) {
  if (!player.target) return;

  const dx = player.target.x - player.x;
  const dy = player.target.y - player.y;
  const dist = Math.hypot(dx, dy);
  const step = player.moveSpeed * dt;

  if (dist <= step) {
    player.x = player.target.x;
    player.y = player.target.y;
    player.target = null;
  } else {
    player.x += (dx / dist) * step;
    player.y += (dy / dist) * step;
  }

  const clamped = clampToMap(player.x, player.y, player.radius, map);
  player.x = clamped.x;
  player.y = clamped.y;
}
