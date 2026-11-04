// 기본 공격(평타) 로직. LoL과 같이 "공격 타이머" 하나로 동작한다.
//
//   평타 시작
//     ├── 선딜레이(windup) ──┤── 쿨다운 ─────────────┤
//     │ 제자리에 서 있어야 함 │ 자유롭게 이동 가능     │
//     │ 이동하면 평타 취소    │ 새 평타는 시작 못 함   │
//     0                    발사                   T = 1/AS
//
// - 선딜레이를 시작하는 순간 공격 타이머(T)도 흐르기 시작한다.
// - 선딜레이 도중 취소되면 타이머를 0으로 되돌린다 (손해 보는 시간 없음).
// - 발사 후에는 어떤 명령을 내려도 불이익이 없다. 투사체는 그대로 날아간다.
// - 쿨다운 중에 평타 명령을 내리면 대상을 기억해 두었다가 타이머가 끝나면 다음 평타를 시작한다.
//
// player·projectile은 update에서 복사한 객체라 직접 바꿔도 된다.
import { getChampion } from './champions/index.js';
import { setMoveTarget } from './movement.js';
import { applyDamage } from './combat.js';

// 소수점 오차로 타이머가 한 틱 더 남는 것을 막기 위한 여유값
const EPSILON = 1e-6;

// 공격속도 상한·하한
export const MIN_ATTACK_SPEED = 0.2;
export const MAX_ATTACK_SPEED = 3.003;

/** 두 캐릭터 가장자리 사이 거리 (게임플레이 반경 기준). 평타 조건: edgeDistance ≤ 사거리 */
export function edgeDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y) - a.gameplayRadius - b.gameplayRadius;
}

/** 공격할 수 있는 대상인지 (다른 팀이고 살아 있음) */
export function canAttack(attacker, target) {
  return !!target && target.id !== attacker.id && target.team !== attacker.team && target.hp > 0;
}

/**
 * 총 공격속도: y = m × x + b  (b: 기본 공격속도, m: 공격속도 계수, x: 추가 공격속도의 합)
 * m을 적지 않은 챔피언은 m = b → y = b × (1 + x)
 */
export function computeAttackSpeed(player) {
  const atk = getChampion(player.championId).attack;
  const base = atk.attackSpeed;
  const ratio = atk.attackSpeedRatio ?? base;
  let bonus = 0;
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
 */
export function computeWindup(atk, attackSpeed) {
  const p = atk.windupRatio;
  const k = atk.windupModifier ?? 1;
  const w0 = p / atk.attackSpeed;
  return w0 + k * ((1 / attackSpeed) * p - w0);
}

/** 평타 명령: 대상을 지정한다. 같은 대상을 다시 찍으면 진행 중인 선딜레이를 유지한다. */
export function orderAttack(player, target) {
  if (!canAttack(player, target)) return;
  if (player.attackTargetId !== target.id) {
    cancelWindup(player);
  }
  player.attackTargetId = target.id;
}

/** 평타 명령 해제 (이동 명령 등). 선딜레이 중이었다면 평타도 취소된다. */
export function cancelAttack(player) {
  player.attackTargetId = null;
  cancelWindup(player);
}

/** 선딜레이 중이면 평타를 취소하고 공격 타이머를 0으로 되돌린다. 쿨다운 중이면 아무것도 하지 않는다. */
function cancelWindup(player) {
  if (player.attackWindup === null) return;
  player.attackWindup = null;
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
 * @returns {object|null} 새 투사체(아이디 없음)
 */
export function updateAttack(player, players, map, dt) {
  player.attackTimer = Math.max(0, player.attackTimer - dt);
  if (!player.attackTargetId) return null;

  const target = players[player.attackTargetId];
  if (!canAttack(player, target)) {
    cancelAttack(player);
    return null;
  }

  const atk = getChampion(player.championId).attack;
  const inRange = edgeDistance(player, target) <= atk.range;

  // 사거리 밖: 대상 쪽으로 이동 (선딜레이 중이었다면 취소)
  if (!inRange) {
    cancelWindup(player);
    setMoveTarget(player, target.x, target.y, map);
    return null;
  }

  // 사거리 안: 멈춰서 공격
  player.target = null;

  if (player.attackWindup === null) {
    // 쿨다운 중이면 새 평타를 시작하지 않고 기다린다
    if (player.attackTimer > EPSILON) return null;
    // 평타 시작: 선딜레이와 공격 타이머가 함께 흐르기 시작한다
    const attackTime = 1 / player.attackSpeed;
    const windup = computeWindup(atk, player.attackSpeed);
    player.attackTimer = attackTime;
    player.attackTimerTotal = attackTime;
    player.attackWindup = windup;
    player.attackWindupTotal = windup;
  }

  player.attackWindup -= dt;
  if (player.attackWindup > EPSILON) return null;

  // 발사: 이제부터 쿨다운 구간
  player.attackWindup = null;

  if (atk.type === 'melee') {
    // 근접: 즉시 적중
    applyDamage(target, atk.damage);
    return null;
  }
  // 원거리: 투사체 생성
  return {
    ownerId: player.id,
    targetId: target.id,
    x: player.x,
    y: player.y,
    speed: atk.projectileSpeed,
    radius: atk.projectileRadius,
    damage: atk.damage,
  };
}

/**
 * 유도 투사체 이동과 적중 처리.
 * @returns {boolean} 투사체를 계속 유지할지 (false면 제거)
 */
export function updateProjectile(proj, players, dt) {
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
    applyDamage(target, proj.damage);
    return false;
  }
  return true;
}
