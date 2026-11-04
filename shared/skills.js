// 스킬 로직 (공통 시스템 + 스킬 형태별 처리).
// - 입력: { type: 'cast', skill: 'Q', x, y }  (x, y: 마우스 월드 좌표 → 방향)
// - 시전 조건: 살아 있음, 스킬 레벨 1 이상, 쿨타임 0, 마나 충분, 다른 스킬 시전 중 아님
// - 시전하면 마나 소모·쿨타임 시작 → 시전 시간(castTime) 동안 멈춰 섬 → 효과 발동
// - 시전 중에는 이동·평타를 하지 않는다. 시전이 끝나면 하던 이동·평타 명령을 이어 간다.
//
// 스킬 형태:
// - linearProjectile: 마우스 방향으로 최대 사거리까지 날아가는 투사체. 처음 닿은 적 하나에게 피해 (원-선분 충돌)
//
// player·projectile은 update에서 복사한 객체라 직접 바꿔도 된다.
import { getChampion } from './champions/index.js';
import { SKILL_KEYS, SKILL_MAX_LEVEL } from './champions/validate.js';
import { spendMana } from './combat.js';
import { cancelWindup } from './attack.js';
import { dealSkillDamage } from './damage.js';

const EPSILON = 1e-6;

export { SKILL_KEYS, SKILL_MAX_LEVEL };

/** 챔피언 데이터의 스킬 정보 (없으면 null) */
export function getSkillData(player, key) {
  return getChampion(player.championId).skills?.[key] ?? null;
}

/** 레벨별 배열에서 현재 레벨 값 */
export function levelValue(values, level) {
  return values[Math.min(Math.max(level, 1), values.length) - 1];
}

/** 플레이어 스킬 상태 초기값: { Q: { level, cooldown }, ... } (챔피언이 가진 스킬만) */
export function createSkillStates(champ) {
  const skills = {};
  for (const key of SKILL_KEYS) {
    if (champ.skills?.[key]) skills[key] = { level: 1, cooldown: 0 };
  }
  return skills;
}

/** 지금 시전할 수 있는지. 안 되면 이유 문자열, 되면 null */
export function castBlockReason(player, key) {
  const data = getSkillData(player, key);
  const st = player.skills[key];
  if (!data || !st) return 'noSkill';
  if (player.hp <= 0) return 'dead';
  if (st.level < 1) return 'notLearned';
  if (player.casting) return 'casting';
  if (st.cooldown > EPSILON) return 'cooldown';
  if (!player.infiniteMana && player.mana < levelValue(data.manaCost, st.level)) return 'mana';
  return null;
}

/** 스킬 시전 명령 */
export function orderCast(player, key, x, y) {
  if (castBlockReason(player, key)) return;
  const dx = x - player.x;
  const dy = y - player.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return;

  const data = getSkillData(player, key);
  const st = player.skills[key];
  spendMana(player, levelValue(data.manaCost, st.level));
  if (!player.noCooldown) st.cooldown = levelValue(data.cooldown, st.level);
  // 평타 선딜레이 중이었다면 취소된다 (스킬 시전도 다른 명령)
  cancelWindup(player);
  player.casting = { skill: key, dirX: dx / len, dirY: dy / len, remaining: data.castTime };
}

/** 매 틱 스킬 쿨타임 감소 */
export function tickSkillCooldowns(player, dt) {
  for (const key in player.skills) {
    const st = player.skills[key];
    if (st.cooldown > 0) st.cooldown = Math.max(0, st.cooldown - dt);
  }
}

/** 모든 스킬 쿨타임을 amount초 줄인다 */
export function reduceAllCooldowns(player, amount) {
  for (const key in player.skills) {
    const st = player.skills[key];
    st.cooldown = Math.max(0, st.cooldown - amount);
  }
}

/** 스킬 피해량 (방어력 적용 전): 기본 + 총 공격력 × AD 계수 + 주문력 × AP 계수 */
export function skillRawDamage(player, data, level) {
  return levelValue(data.damage, level) + player.attackDamage * data.adRatio + player.abilityPower * data.apRatio;
}

/**
 * 시전 진행. 시전 시간이 끝나면 효과를 발동하고, 새 투사체가 있으면 돌려준다.
 * @returns {object|null} 새 투사체(아이디 없음)
 */
export function updateCasting(player, dt) {
  const c = player.casting;
  if (!c) return null;
  if (player.hp <= 0) {
    player.casting = null;
    return null;
  }
  c.remaining -= dt;
  if (c.remaining > EPSILON) return null;

  player.casting = null;
  const data = getSkillData(player, c.skill);
  const level = player.skills[c.skill].level;
  if (data.type === 'linearProjectile') {
    return {
      kind: 'skillshot',
      skill: c.skill,
      ownerId: player.id,
      team: player.team,
      x: player.x,
      y: player.y,
      dirX: c.dirX,
      dirY: c.dirY,
      speed: data.projectileSpeed,
      radius: data.projectileRadius,
      remaining: data.range, // 남은 비행 거리
      raw: skillRawDamage(player, data, level),
      onHitCooldownReduction: data.onHitCooldownReduction ?? 0,
    };
  }
  return null;
}

/** 점(px, py)에서 선분(ax,ay)-(bx,by)까지 가장 가까운 지점의 비율 t (0~1)와 거리 */
function closestOnSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.min(Math.max(((px - ax) * vx + (py - ay) * vy) / len2, 0), 1) : 0;
  const cx = ax + vx * t;
  const cy = ay + vy * t;
  return { t, dist: Math.hypot(px - cx, py - cy) };
}

/**
 * 직선 투사체(skillshot) 이동과 적중. 이번 틱 이동 경로(선분)에 닿는 적 중 가장 먼저 닿는 적 하나에게 적중.
 * @returns {boolean} 투사체를 계속 유지할지 (false면 제거)
 */
export function updateSkillshot(proj, players, dt, ctx) {
  const step = Math.min(proj.speed * dt, proj.remaining);
  const ax = proj.x;
  const ay = proj.y;
  const bx = ax + proj.dirX * step;
  const by = ay + proj.dirY * step;

  let hit = null;
  let hitT = Infinity;
  for (const id in players) {
    const p = players[id];
    if (p.team === proj.team || p.hp <= 0 || p.targetable === false) continue;
    const { t, dist } = closestOnSegment(p.x, p.y, ax, ay, bx, by);
    if (dist <= p.gameplayRadius + proj.radius && t < hitT) {
      hit = p;
      hitT = t;
    }
  }

  if (hit) {
    const owner = players[proj.ownerId];
    dealSkillDamage(owner, hit, proj.raw, proj.skill, ctx);
    if (owner && proj.onHitCooldownReduction > 0) reduceAllCooldowns(owner, proj.onHitCooldownReduction);
    return false;
  }

  proj.x = bx;
  proj.y = by;
  proj.remaining -= step;
  return proj.remaining > EPSILON;
}
