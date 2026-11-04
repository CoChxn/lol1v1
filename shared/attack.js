// 기본 공격(평타) 로직. LoL과 같이 "공격 타이머" 하나로 동작한다.
//
//   평타 명령 ─ chase(사거리까지 추적) ─┬─ 선딜레이(windup) ──┤── 쿨다운 ─────────────┤
//                                      │ 제자리에 서 있음     │ 자유롭게 이동 가능     │
//                                      │ 이동하면 평타 취소   │ 새 평타는 시작 못 함   │
//                                      0                   발사                   T = 1/AS
//
// - 우클릭 한 번이 "추적 → 정지 → 선딜레이 → 발사 → 쿨다운 → 다시 공격"을 반복하는 명령이다.
//   새 대상 지정 / 공격 취소 / 대상 사망·타겟 불가가 될 때까지 계속된다.
// - 선딜레이를 시작하는 순간 공격 타이머(T)도 흐르기 시작한다.
// - 선딜레이 도중 취소되면 타이머를 0으로 되돌린다 (손해 보는 시간 없음).
//   단, 이번 틱에 발사될 평타(선딜레이 마지막 1틱)는 취소되지 않는다.
// - 발사 후에는 어떤 명령을 내려도 불이익이 없다. 투사체는 대상을 따라가서 맞는다.
//   발사 직후 1틱 동안 들어온 명령은 다음 틱으로 미뤄진다 (update.js).
//
// player·projectile은 update에서 복사한 객체라 직접 바꿔도 된다.
import { getChampion } from './champions/index.js';
import { setMoveTarget } from './movement.js';
import { rollCrit, dealAttackDamage } from './damage.js';
import { TICK_DT } from './constants.js';

// 소수점 오차로 타이머가 한 틱 더 남는 것을 막기 위한 여유값
const EPSILON = 1e-6;

// 공격속도 상한·하한
export const MIN_ATTACK_SPEED = 0.2;
export const MAX_ATTACK_SPEED = 3.003;

// 선딜레이 중 대상이 "사거리 + 이 값"보다 멀어지면 평타가 취소된다
export const WINDUP_CANCEL_LEEWAY = 100;

/** 두 캐릭터 가장자리 사이 거리 (게임플레이 반경 기준). 평타 조건: edgeDistance ≤ 사거리 */
export function edgeDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y) - a.gameplayRadius - b.gameplayRadius;
}

/** 공격할 수 있는 대상인지 (다른 팀, 살아 있음, 타겟 가능) */
export function canAttack(attacker, target) {
  return (
    !!target &&
    target.id !== attacker.id &&
    target.team !== attacker.team &&
    target.hp > 0 &&
    target.targetable !== false
  );
}

/**
 * 총 공격속도: y = m × x + b  (b: 기본 공격속도, m: 공격속도 계수, x: 추가 공격속도의 합)
 * m을 적지 않은 챔피언은 m = b → y = b × (1 + x)
 */
export function computeAttackSpeed(player) {
  const atk = getChampion(player.championId).attack;
  const base = player.baseAttackSpeed ?? atk.attackSpeed;
  const ratio = atk.attackSpeedRatio ?? base;
  let bonus = player.bonusAttackSpeed ?? 0;
  for (const e of player.effects) {
    if (e.kind === 'attackSpeed') bonus += e.value;
  }
  const as = ratio * bonus + base;
  return Math.min(Math.max(as, MIN_ATTACK_SPEED), MAX_ATTACK_SPEED);
}

/**
 * 선딜레이 시간: W = W0 + k × (T × p − W0)
 *   T = 1 / 총 공격속도, p = windupRatio, W0 = p / 기본 공격속도, k = windupModifier(기본 1)
 *   k = 1이면 W = T × p
 * @param {number} [baseAttackSpeed]  기본 공격속도 (기본값: 챔피언 데이터 값)
 */
export function computeWindup(atk, attackSpeed, baseAttackSpeed = atk.attackSpeed) {
  const p = atk.windupRatio;
  const k = atk.windupModifier ?? 1;
  const w0 = p / baseAttackSpeed;
  return w0 + k * ((1 / attackSpeed) * p - w0);
}

/** 평타 명령: 대상을 지정한다. 같은 대상을 다시 찍으면 진행 중인 선딜레이를 유지한다. */
export function orderAttack(player, target) {
  if (!canAttack(player, target)) return;
  if (player.attackWindupTargetId !== target.id) {
    cancelWindup(player);
  }
  player.attackTargetId = target.id;
  player.attackMoveTarget = null;
}

/** 평타 명령 해제 (이동·정지 명령 등). 선딜레이 중이었다면 평타도 취소된다. 어택땅도 해제된다. */
export function cancelAttack(player) {
  player.attackTargetId = null;
  player.attackMoveTarget = null;
  cancelWindup(player);
}

/** 내 평타 사거리 안에서 내 위치 기준 가장 가까운 적 (없으면 null) */
export function findNearestEnemyInRange(player, players) {
  const range = getChampion(player.championId).attack.range;
  let best = null;
  let bestDist = Infinity;
  for (const id in players) {
    const other = players[id];
    if (!canAttack(player, other)) continue;
    const d = edgeDistance(player, other);
    if (d <= range && d < bestDist) {
      best = other;
      bestDist = d;
    }
  }
  return best;
}

/**
 * 어택땅: 목적지로 이동하면서 사거리 안의 적을 공격한다.
 * - 사거리 안에 적이 있으면 가장 가까운 적을 바로 대상으로 잡는다.
 * - 없으면 목적지로 이동하고, 매 틱 다시 찾는다 (updateAttackMove).
 */
export function orderAttackMove(player, players, x, y, map) {
  cancelAttack(player);
  player.attackMoveTarget = { x, y };
  const enemy = findNearestEnemyInRange(player, players);
  if (enemy) {
    player.attackTargetId = enemy.id;
  } else {
    setMoveTarget(player, x, y, map);
  }
}

/** 정지: 이동·추적·어택땅을 멈춘다. 선딜레이 중이면 평타도 취소된다 (마지막 1틱 제외). */
export function orderStop(player) {
  cancelAttack(player);
  player.target = null;
}

/**
 * 어택땅 진행 (매 틱, updateAttack 전에 호출)
 * - 공격 대상이 없으면 사거리 안의 적을 찾아 공격하고, 없으면 목적지로 계속 간다.
 * - 목적지에 도착하면 어택땅이 끝난다.
 */
export function updateAttackMove(player, players, map) {
  const dest = player.attackMoveTarget;
  if (!dest || player.hp <= 0) return;

  // 지금 공격 중인 대상이 살아 있으면 그대로 둔다
  if (player.attackTargetId && canAttack(player, players[player.attackTargetId])) return;
  player.attackTargetId = null;

  const enemy = findNearestEnemyInRange(player, players);
  if (enemy) {
    player.attackTargetId = enemy.id;
    return;
  }

  // 적이 없으면 목적지로. 이동 목표가 없는데 아직 멀면(공격하느라 멈췄던 경우) 다시 출발, 가까우면 도착
  if (!player.target) {
    const arrived = Math.hypot(dest.x - player.x, dest.y - player.y) <= player.pathingRadius;
    if (arrived || player.attackWindup !== null) {
      if (arrived) player.attackMoveTarget = null;
    } else {
      setMoveTarget(player, dest.x, dest.y, map);
    }
  }
}

/**
 * 선딜레이 중이면 평타를 취소하고 공격 타이머를 0으로 되돌린다.
 * - 이번 틱에 발사될 평타(남은 선딜레이 ≤ 1틱)는 취소되지 않는다.
 * - force: 공격자·대상 사망 등 반드시 끊어야 할 때
 */
export function cancelWindup(player, force = false) {
  if (player.attackWindup === null) return;
  if (!force && player.attackWindup <= TICK_DT + EPSILON) return;
  player.attackWindup = null;
  player.attackWindupTargetId = null;
  resetAttackTimer(player);
}

/** 공격 타이머 초기화: 바로 새 평타를 시작할 수 있게 한다. (나중에 "평타 초기화" 스킬에서도 사용) */
export function resetAttackTimer(player) {
  player.attackTimer = 0;
  player.attackTimerTotal = 0;
}

/**
 * 한 틱 동안의 평타 진행. 원거리 평타를 발사하면 새 투사체를 돌려준다.
 * (player.attackSpeed는 update에서 이번 틱 총 공격속도로 미리 계산해 둔다)
 * @param {{ rng: { seed: number }, events: object[] }} ctx  난수·이벤트
 * @returns {object|null} 새 투사체(아이디 없음)
 */
export function updateAttack(player, players, map, dt, ctx) {
  player.attackTimer = Math.max(0, player.attackTimer - dt);
  const atk = getChampion(player.championId).attack;
  let shot = null;

  // 공격자가 죽었으면 모두 중단
  if (player.hp <= 0) {
    player.attackTargetId = null;
    cancelWindup(player, true);
    player.attackState = 'idle';
    return null;
  }

  // 평타 명령 대상이 공격 불가가 되면 명령 해제
  if (player.attackTargetId && !canAttack(player, players[player.attackTargetId])) {
    player.attackTargetId = null;
  }

  // 스킬 시전 중에는 평타를 진행하지 않는다 (명령은 유지 → 시전이 끝나면 이어서)
  if (player.casting) {
    player.attackState = getAttackState(player, players, atk);
    return null;
  }

  // 1. 선딜레이 중이 아니면: 추적하거나 새 평타 시작
  if (player.attackWindup === null && player.attackTargetId) {
    const target = players[player.attackTargetId];
    if (edgeDistance(player, target) > atk.range) {
      // chase: 사거리까지 걸어간다
      setMoveTarget(player, target.x, target.y, map);
    } else {
      // 사거리 안: 멈춰서, 공격 타이머가 끝났으면 새 평타 시작
      player.target = null;
      if (player.attackTimer <= EPSILON) {
        const attackTime = 1 / player.attackSpeed;
        const windup = computeWindup(atk, player.attackSpeed, player.baseAttackSpeed);
        player.attackTimer = attackTime;
        player.attackTimerTotal = attackTime;
        player.attackWindup = windup;
        player.attackWindupTotal = windup;
        player.attackWindupTargetId = target.id;
      }
    }
  }

  // 2. 선딜레이 진행
  if (player.attackWindup !== null) {
    const target = players[player.attackWindupTargetId];
    if (!canAttack(player, target)) {
      // 대상 사망·타겟 불가: 평타 끊김
      cancelWindup(player, true);
    } else if (edgeDistance(player, target) > atk.range + WINDUP_CANCEL_LEEWAY) {
      // 대상이 너무 멀어짐: 평타 끊김 (명령이 남아 있으면 다음 틱부터 다시 추적)
      cancelWindup(player, true);
    } else {
      // (선딜레이 중에는 이동 목표가 없다. 마지막 틱에 들어온 이동 명령은 발사 후 그대로 실행된다)
      player.attackWindup -= dt;
      if (player.attackWindup <= EPSILON) {
        // 발사: 이제부터 쿨다운 구간
        player.attackWindup = null;
        player.attackWindupTargetId = null;
        player.commandLockTicks = 1;
        // 피해량(공격력 100%)과 치명타 여부는 발사 순간 정한다. 방어력은 맞는 순간의 값으로 계산한다.
        const hit = { raw: player.attackDamage, crit: rollCrit(player, ctx.rng), critDamage: player.critDamage };
        if (atk.type === 'melee') {
          dealAttackDamage(player, target, hit, ctx); // 근접: 즉시 적중
        } else {
          shot = {
            kind: 'attack',
            ownerId: player.id,
            targetId: target.id,
            x: player.x,
            y: player.y,
            speed: atk.projectileSpeed,
            radius: atk.projectileRadius,
            hit,
          };
        }
      }
    }
  }

  player.attackState = getAttackState(player, players, atk);
  return shot;
}

/** 평타 상태 (우선순위: windup > chase > cooldown > idle) */
function getAttackState(player, players, atk) {
  if (player.attackWindup !== null) return 'windup';
  const target = player.attackTargetId && players[player.attackTargetId];
  if (target && edgeDistance(player, target) > atk.range) return 'chase';
  if (player.attackTimer > EPSILON) return 'cooldown';
  return 'idle';
}

/**
 * 유도 투사체 이동과 적중 처리. 발사 시점의 대상을 매 틱 따라가다가 닿으면 적중한다.
 * @returns {boolean} 투사체를 계속 유지할지 (false면 제거)
 */
export function updateProjectile(proj, players, dt, ctx) {
  const target = players[proj.targetId];
  if (!target || target.hp <= 0) return false;

  const dx = target.x - proj.x;
  const dy = target.y - proj.y;
  const dist = Math.hypot(dx, dy);
  const step = proj.speed * dt;

  if (dist > step) {
    proj.x += (dx / dist) * step;
    proj.y += (dy / dist) * step;
  } else {
    proj.x = target.x;
    proj.y = target.y;
  }

  // 원-원 충돌
  if (Math.hypot(target.x - proj.x, target.y - proj.y) < proj.radius + target.gameplayRadius) {
    dealAttackDamage(players[proj.ownerId], target, proj.hit, ctx);
    return false;
  }
  return true;
}
