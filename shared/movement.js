// 이동 로직. 벽·지형(포탑)·다른 캐릭터는 이동 충돌 반경(pathingRadius)으로 부딪힌다.
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

// 막힘 처리: 가는 길이 다른 유닛·지형 원에 막히면 그 둘레(접선 방향)를 따라 돌아간다.
// 고른 쪽(왼쪽 +1 / 오른쪽 -1)은 막힘이 풀린 뒤에도 잠시 유지해서 좌우로 떨지 않게 한다.
const AVOID_KEEP_TICKS = 15;
// 목표 쪽과 두 접선의 차이가 이보다 작으면 '정면'으로 보고 기본 쪽(왼쪽)으로 돈다
const HEAD_ON_EPS = 0.05;

/** 막는 몸 목록 { x, y, radius }: 다른 유닛(유체화·사망 제외) + 지형 원(포탑) */
function collectBodies(player, players, map) {
  const bodies = [];
  for (const id in players) {
    const o = players[id];
    if (blocks(player, o)) bodies.push({ x: o.x, y: o.y, radius: o.pathingRadius });
  }
  if (map?.obstacles) bodies.push(...map.obstacles);
  return bodies;
}

/**
 * (px, py)에서 (dirX, dirY)로 len만큼 갈 때 앞을 막는 몸 중 가장 가까운 것 (없으면 null)
 * 막는다 = 도착 위치가 그 몸과 겹치고, 그 몸이 진행 방향 앞쪽(90° 안)에 있음
 */
function findBlocker(px, py, dirX, dirY, len, radius, bodies, skip = null) {
  const nx = px + dirX * len;
  const ny = py + dirY * len;
  let best = null;
  let bestD = Infinity;
  for (const b of bodies) {
    if (b === skip) continue;
    const min = radius + b.radius;
    if (Math.hypot(nx - b.x, ny - b.y) >= min) continue;
    if ((b.x - px) * dirX + (b.y - py) * dirY <= 0) continue;
    const d = Math.hypot(b.x - px, b.y - py);
    if (d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

// 막은 무리로 묶을 최대 개수
const CLUSTER_MAX = 20;

/**
 * 처음 막혔을 때 돌아갈 쪽 고르기 (+1 / -1)
 * 1. 막은 몸과, 그 몸에 붙어 있어 사이로 지나갈 수 없는 몸들(틈 < 내 지름)을 한 무리로 묶는다
 * 2. 진행 방향의 옆(가로)으로 몇만큼 비켜야 무리를 벗어나는지 양쪽을 재서, 덜 비켜도 되는 쪽으로 돈다
 * 3. 그만큼 비킨 곳이 벽(통로 밖)이면 반대쪽
 */
function chooseSide(player, dirX, dirY, blocker, bodies, map, tangent) {
  const r = player.pathingRadius;
  const cluster = [blocker];
  const seen = new Set([blocker]);
  for (let i = 0; i < cluster.length && cluster.length < CLUSTER_MAX; i++) {
    const a = cluster[i];
    for (const b of bodies) {
      if (seen.has(b)) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius < 2 * r) {
        seen.add(b);
        cluster.push(b);
        if (cluster.length >= CLUSTER_MAX) break;
      }
    }
  }
  // 진행 방향의 가로축(cross > 0 쪽이 +)으로 무리를 벗어나려면 옆으로 얼마나 비켜야 하는지
  let posNeed = -Infinity; // + 쪽으로 비켜야 하는 거리
  let negNeed = -Infinity; // - 쪽으로 비켜야 하는 거리
  for (const b of cluster) {
    const lateral = dirX * (b.y - player.y) - dirY * (b.x - player.x);
    posNeed = Math.max(posNeed, lateral + b.radius + r);
    negNeed = Math.max(negNeed, -(lateral - b.radius - r));
  }
  // 그만큼 옆으로 비킨 지점이 벽 밖이면 그쪽은 막힌 것으로 본다
  const perpX = -dirY;
  const perpY = dirX;
  const wallBlocked = (offset) => {
    const px = player.x + perpX * offset;
    const py = player.y + perpY * offset;
    const cl = clampToMap(px, py, r, { ...map, obstacles: null });
    return Math.hypot(cl.x - px, cl.y - py) > 1;
  };
  if (wallBlocked(posNeed)) posNeed = Infinity;
  if (wallBlocked(-negNeed)) negNeed = Infinity;
  // + 쪽(cross > 0)으로 도는 접선이 tangent(+1)인지 tangent(-1)인지 확인해서 고른다
  const t1 = tangent(1);
  const plusIsSide1 = dirX * t1.y - dirY * t1.x > 0;
  if (Math.abs(posNeed - negNeed) < 1) {
    // 거의 같으면 예전처럼: 목표 쪽 접선, 정면이면 +1
    const dl = t1.x * dirX + t1.y * dirY;
    return Math.abs(dl) < HEAD_ON_EPS ? 1 : Math.sign(dl);
  }
  const goPlus = posNeed < negNeed;
  return goPlus === plusIsSide1 ? 1 : -1;
}

/**
 * 목표를 향해 dt초만큼 이동한다.
 * - 남은 거리가 이번 이동량 이하이면 목표에 정확히 멈춘다 → 도착 지점에서 떨리지 않는다.
 * - 앞이 다른 유닛·지형 원에 막히면 그 둘레를 따라 옆으로 돌아간다.
 *   도는 쪽은 처음 막힐 때 막은 무리 전체를 보고 덜 돌아가는 쪽으로 고르고(chooseSide), 막혀 있는 동안 유지한다.
 *   옆의 다른 유닛에 막히면 같은 쪽을 유지한 채 그 유닛의 둘레를 따라 간다.
 *   벽에 막히거나 갈 수 없으면 반대쪽, 양쪽 다 막히면 이번 틱은 기다린다.
 * - 목적지가 막는 몸 안이면 닿은 곳에서 멈춘다.
 */
export function movePlayer(player, players, dt, map) {
  if (!player.target || player.casting) return;

  const dx = player.target.x - player.x;
  const dy = player.target.y - player.y;
  const dist = Math.hypot(dx, dy);
  const step = player.moveSpeed * dt;
  const dirX = dist > 0 ? dx / dist : 0;
  const dirY = dist > 0 ? dy / dist : 0;
  const r = player.pathingRadius;
  const bodies = collectBodies(player, players, map);

  let mx = dirX;
  let my = dirY;
  let len = Math.min(step, dist);
  let arrived = dist <= step;

  const blocker = len > 0 ? findBlocker(player.x, player.y, dirX, dirY, len, r, bodies) : null;
  if (blocker) {
    if (Math.hypot(player.target.x - blocker.x, player.target.y - blocker.y) < r + blocker.radius) {
      // 목적지가 막는 몸 안: 닿은 곳에서 멈춘다
      len = 0;
      arrived = true;
    } else {
      // 막은 몸의 둘레 방향(접선)으로 돈다
      // 몸 b의 둘레를 side 쪽으로 도는 접선 방향
      const tangentOf = (b, side) => {
        const ox = player.x - b.x;
        const oy = player.y - b.y;
        const od = Math.hypot(ox, oy) || 1;
        return { x: (-oy / od) * side, y: (ox / od) * side };
      };
      const tangent = (side) => tangentOf(blocker, side);
      let side = player.avoidSide || 0;
      if (!side) side = chooseSide(player, dirX, dirY, blocker, bodies, map, tangent);
      // 그쪽 접선으로 한 틱 가 본다. 옆의 다른 몸에 막히면 같은 쪽을 유지한 채 그 몸의 둘레를 따라 간다 (무리를 끝까지 돌기)
      const tryMove = (sd) => {
        let around = blocker;
        for (let k = 0; k < 4; k++) {
          const t = tangentOf(around, sd);
          const next = findBlocker(player.x, player.y, t.x, t.y, step, r, bodies, around);
          if (next) {
            around = next;
            continue;
          }
          const nx = player.x + t.x * step;
          const ny = player.y + t.y * step;
          const c = clampToMap(nx, ny, r, map);
          if (Math.hypot(c.x - nx, c.y - ny) > 1e-6) return null; // 벽에 막힘
          return t;
        }
        return null;
      };
      let t = tryMove(side);
      if (!t) {
        side = -side;
        t = tryMove(side);
      }
      player.avoidSide = side;
      player.avoidTicks = AVOID_KEEP_TICKS;
      arrived = false;
      if (t) {
        mx = t.x;
        my = t.y;
        len = step;
      } else {
        len = 0; // 양쪽 다 막힘: 기다린다
      }
    }
  } else if (player.avoidTicks > 0) {
    player.avoidTicks -= 1;
    if (player.avoidTicks === 0) player.avoidSide = 0;
  }

  let nx = arrived && len > 0 ? player.target.x : player.x + mx * len;
  let ny = arrived && len > 0 ? player.target.y : player.y + my * len;

  // 그래도 겹치면 밖으로 밀어낸다 (안전장치)
  for (const b of bodies) {
    const min = r + b.radius;
    let ox = nx - b.x;
    let oy = ny - b.y;
    let od = Math.hypot(ox, oy);
    if (od >= min) continue;
    if (od === 0) {
      ox = -dirY || 1;
      oy = dirX;
      od = Math.hypot(ox, oy);
    }
    nx = b.x + (ox / od) * min;
    ny = b.y + (oy / od) * min;
  }

  const clamped = clampToMap(nx, ny, r, map);
  player.x = clamped.x;
  player.y = clamped.y;
  if (arrived) player.target = null;
}

/**
 * 순간이동 등으로 다른 캐릭터와 몸(이동 충돌 반경)이 겹치면 바로 바깥으로 밀어낸다.
 * 여러 유닛이 붙어 있으면 하나에서 밀려나며 다른 하나와 겹칠 수 있어, 겹침이 없을 때까지 몇 번 반복한다.
 * (dirX, dirY): 완전히 겹쳤을 때 밀어낼 방향
 */
const OVERLAP_PASSES = 8;
export function resolveOverlap(player, players, map, dirX = 1, dirY = 0) {
  for (let pass = 0; pass < OVERLAP_PASSES; pass++) {
    let moved = false;
    for (const id in players) {
      const other = players[id];
      if (!blocks(player, other)) continue;
      const minDist = player.pathingRadius + other.pathingRadius;
      let ox = player.x - other.x;
      let oy = player.y - other.y;
      let od = Math.hypot(ox, oy);
      if (od >= minDist - 1e-9) continue;
      if (od === 0) {
        ox = dirX;
        oy = dirY;
        od = Math.hypot(ox, oy) || 1;
      }
      player.x = other.x + (ox / od) * minDist;
      player.y = other.y + (oy / od) * minDist;
      moved = true;
    }
    const clamped = clampToMap(player.x, player.y, player.pathingRadius, map);
    if (clamped.x !== player.x || clamped.y !== player.y) moved = true;
    player.x = clamped.x;
    player.y = clamped.y;
    if (!moved) break;
  }
}
