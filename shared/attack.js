// 기본 공격(평타) 로직: 대상 지정 → 사거리까지 추격 → 준비 동작 → 투사체 발사 → 적중.
// player·projectile은 update에서 복사한 객체라 직접 바꿔도 된다.
import { getChampion } from './champions.js';
import { setMoveTarget } from './movement.js';
import { applyDamage } from './combat.js';

/** 두 캐릭터 가장자리 사이 거리 (게임플레이 반경 기준). 평타 조건: edgeDistance ≤ 사거리 */
export function edgeDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y) - a.gameplayRadius - b.gameplayRadius;
}

/** 공격할 수 있는 대상인지 (다른 팀이고 살아 있음) */
export function canAttack(attacker, target) {
  return !!target && target.id !== attacker.id && target.team !== attacker.team && target.hp > 0;
}

/** 평타 명령: 대상을 지정한다. 같은 대상을 다시 찍으면 진행 중인 준비 동작을 유지한다. */
export function orderAttack(player, target) {
  if (!canAttack(player, target)) return;
  if (player.attackTargetId !== target.id) {
    player.attackWindup = null;
  }
  player.attackTargetId = target.id;
}

/** 평타 취소 (이동 명령 등) */
export function cancelAttack(player) {
  player.attackTargetId = null;
  player.attackWindup = null;
}

/**
 * 한 틱 동안의 평타 진행. 발사한 투사체가 있으면 돌려준다.
 * @returns {object|null} 새 투사체(아이디 없음)
 */
export function updateAttack(player, players, map, dt) {
  player.attackCooldown = Math.max(0, player.attackCooldown - dt);
  if (!player.attackTargetId) return null;

  const target = players[player.attackTargetId];
  if (!canAttack(player, target)) {
    cancelAttack(player);
    return null;
  }

  const atk = getChampion(player.championId).attack;
  const inRange = edgeDistance(player, target) <= atk.range;

  // 사거리 밖: 대상 쪽으로 이동 (준비 동작 중이었다면 취소)
  if (!inRange) {
    player.attackWindup = null;
    setMoveTarget(player, target.x, target.y, map);
    return null;
  }

  // 사거리 안: 멈춰서 공격
  player.target = null;

  if (player.attackWindup === null) {
    if (player.attackCooldown > 0) return null;
    // 공격 시작: 다음 공격까지의 간격은 시작 시점부터 잰다
    const attackTime = 1 / atk.attackSpeed;
    player.attackCooldown = attackTime;
    player.attackWindup = attackTime * atk.windupRatio;
  }

  player.attackWindup -= dt;
  if (player.attackWindup > 0) return null;

  // 발사
  player.attackWindup = null;
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
