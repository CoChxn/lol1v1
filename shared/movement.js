// 이동 로직. 벽과 다른 캐릭터는 이동 충돌 반경(pathingRadius)으로 부딪힌다.
// player는 update에서 복사한 객체라 직접 바꿔도 된다.

/**
 * 이동속도 상한·하한 보정 (soft cap)
 *   490 초과        → V × 0.5 + 230
 *   415 초과 ~ 490  → V × 0.8 + 83
 *   220 ~ 415       → 그대로
 *   0 ~ 220 미만    → 110 + V × 0.5
 *   0 미만          → 110 + V × 0.01
 */
export function applySoftCap(v) {
  if (v > 490) return v * 0.5 + 230;
  if (v > 415) return v * 0.8 + 83;
  if (v >= 220) return v;
  if (v >= 0) return 110 + v * 0.5;
  return 110 + v * 0.01;
}

/**
 * 최종 이동속도 계산
 *   V_raw = (B + F) × (1 + ΣP) × Π(1 + M_i) × (1 − S × (1 − R))
 *   - S: 둔화 중 가장 강한 것 하나만
 *   - R: 둔화 저항
 * 이후 soft cap 적용.
 */
export function computeMoveSpeed(player) {
  let flat = 0;
  let percent = 0;
  let mult = 1;
  let slow = 0;
  for (const e of player.effects) {
    if (e.kind === 'flat') flat += e.value;
    else if (e.kind === 'percent') percent += e.value;
    else if (e.kind === 'mult') mult *= 1 + e.value;
    else if (e.kind === 'slow') slow = Math.max(slow, e.value);
  }
  const raw = (player.baseMoveSpeed + flat) * (1 + percent) * mult * (1 - slow * (1 - player.slowResist));
  return applySoftCap(raw);
}

// 벽 충돌: 좌표를 통로 안으로 맞춘다 (shared/map.js)
import { clampToMap } from './map.js';
export { clampToMap };

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
  if (!player.target || player.casting) return;

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

/**
 * 순간이동 등으로 다른 캐릭터와 몸(이동 충돌 반경)이 겹치면 바로 바깥으로 밀어낸다.
 * (dirX, dirY): 완전히 겹쳤을 때 밀어낼 방향
 */
export function resolveOverlap(player, players, map, dirX = 1, dirY = 0) {
  for (const id in players) {
    const other = players[id];
    if (!blocks(player, other)) continue;
    const minDist = player.pathingRadius + other.pathingRadius;
    let ox = player.x - other.x;
    let oy = player.y - other.y;
    let od = Math.hypot(ox, oy);
    if (od >= minDist) continue;
    if (od === 0) {
      ox = dirX;
      oy = dirY;
      od = Math.hypot(ox, oy) || 1;
    }
    player.x = other.x + (ox / od) * minDist;
    player.y = other.y + (oy / od) * minDist;
  }
  const clamped = clampToMap(player.x, player.y, player.pathingRadius, map);
  player.x = clamped.x;
  player.y = clamped.y;
}
