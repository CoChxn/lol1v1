// 이동 로직. 벽과 다른 캐릭터는 이동 충돌 반경(pathingRadius)으로 부딪힌다.
// player는 update에서 복사한 객체라 직접 바꿔도 된다.

/** 좌표를 맵 안쪽(반지름만큼 떨어진 곳)으로 제한한 값을 돌려준다. */
export function clampToMap(x, y, radius, map) {
  return {
    x: Math.min(Math.max(x, radius), map.width - radius),
    y: Math.min(Math.max(y, radius), map.height - radius),
  };
}

/** 이동 목표를 설정한다. 벽 바깥을 찍으면 가장 가까운 벽 안쪽 지점이 목표가 된다. */
export function setMoveTarget(player, x, y, map) {
  player.target = clampToMap(x, y, player.pathingRadius, map);
}

/** 두 캐릭터가 서로 몸으로 막는지 (유체화면 통과) */
function blocks(a, b) {
  return a.id !== b.id && !a.ghosted && !b.ghosted && b.hp > 0;
}

// 정면 충돌 판정 기준: 이동 방향과 "상대 → 나" 방향이 이 값보다 더 마주 보면 옆으로 비켜 간다.
const HEAD_ON_DOT = -0.95;
const SIDESTEP = 0.35;

/**
 * 목표를 향해 dt초만큼 이동한다.
 * - 남은 거리가 이번 이동량 이하이면 목표에 정확히 멈춘다 → 도착 지점에서 떨리지 않는다.
 * - 다른 캐릭터와 겹치면 밖으로 밀려나 가장자리를 따라 미끄러진다.
 */
export function movePlayer(player, players, dt, map) {
  if (!player.target) return;

  const dx = player.target.x - player.x;
  const dy = player.target.y - player.y;
  const dist = Math.hypot(dx, dy);
  const step = player.moveSpeed * dt;
  const dirX = dist > 0 ? dx / dist : 0;
  const dirY = dist > 0 ? dy / dist : 0;

  let nx;
  let ny;
  let arrived = false;
  if (dist <= step) {
    nx = player.target.x;
    ny = player.target.y;
    arrived = true;
  } else {
    nx = player.x + dirX * step;
    ny = player.y + dirY * step;
  }

  // 다른 캐릭터와의 충돌: 겹친 만큼 밖으로 밀어낸다
  for (const id in players) {
    const other = players[id];
    if (!blocks(player, other)) continue;

    const minDist = player.pathingRadius + other.pathingRadius;
    let ox = nx - other.x;
    let oy = ny - other.y;
    let od = Math.hypot(ox, oy);
    if (od >= minDist) continue;

    // 목적지가 상대 몸 안이면 닿은 곳에서 멈춘다
    if (Math.hypot(player.target.x - other.x, player.target.y - other.y) < minDist) {
      arrived = true;
    }

    if (od === 0) {
      // 완전히 겹친 경우: 이동 방향의 옆으로 밀어낸다
      ox = -dirY || 1;
      oy = dirX;
      od = Math.hypot(ox, oy);
    }
    let pushX = ox / od;
    let pushY = oy / od;

    // 정면으로 부딪히면 그 자리에서 멈춰 버리므로 한쪽 옆으로 살짝 틀어 돌아가게 한다
    if (dirX * pushX + dirY * pushY < HEAD_ON_DOT) {
      pushX += -dirY * SIDESTEP;
      pushY += dirX * SIDESTEP;
      const len = Math.hypot(pushX, pushY);
      pushX /= len;
      pushY /= len;
    }

    nx = other.x + pushX * minDist;
    ny = other.y + pushY * minDist;
  }

  const clamped = clampToMap(nx, ny, player.pathingRadius, map);
  player.x = clamped.x;
  player.y = clamped.y;
  if (arrived) player.target = null;
}
