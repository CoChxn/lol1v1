// 스킬 로직. 스킬은 조준(targeting) / 발동(activation) / 효과(effects) 세 축의 조합이다 (docs/SKILL_DESIGN.md).
// - 입력: { type: 'cast', skill: 'Q', x, y }  (x, y: 마우스 월드 좌표)
// - 시전 조건: 살아 있음, 스킬 레벨 1 이상, 쿨타임 0, 마나 충분, 다른 스킬 시전 중 아님
// - 시전하면 마나 소모·쿨타임 시작 → 시전 시간(activation.castTime) 동안 멈춰 섬 → 효과 발동
// - 시전 중에는 이동·평타를 하지 않는다. 시전이 끝나면 하던 이동·평타 명령을 이어 간다.
//
// 구현된 축:
// - 조준: direction (마우스 방향, 사거리 밖이면 최대 사거리로)
// - 발동: normal (+ 시전 시간)
// - 효과: projectile (collision: first | pierce) → 적중 시 onHit: damage(physical), reduceCooldowns
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

// --- 1. 조준: 입력을 시전 정보로 바꾼다 (실패하면 null) ---
const TARGETING = {
  // 방향: 마우스 방향의 단위 벡터. 사거리와 무관하게 방향만 쓴다 (outOfRange: 'maxRange')
  direction(player, targeting, x, y) {
    const dx = x - player.x;
    const dy = y - player.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) return null;
    return { dirX: dx / len, dirY: dy / len };
  },
};

/** 스킬 시전 명령 */
export function orderCast(player, key, x, y) {
  if (castBlockReason(player, key)) return;
  const data = getSkillData(player, key);
  const aim = TARGETING[data.targeting.type]?.(player, data.targeting, x, y);
  if (!aim) return;

  const st = player.skills[key];
  spendMana(player, levelValue(data.manaCost, st.level));
  if (!player.noCooldown) st.cooldown = levelValue(data.cooldown, st.level);
  // 평타 선딜레이 중이었다면 취소된다 (스킬 시전도 다른 명령)
  cancelWindup(player);
  // 2. 발동: normal → 시전 시간 뒤 효과 발동
  player.casting = { skill: key, ...aim, remaining: data.activation.castTime };
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

/** 피해 효과의 피해량 (방어력 적용 전): 기본 + 총 공격력 × AD 계수 + 주문력 × AP 계수 */
export function damageRaw(player, effect, level) {
  return levelValue(effect.base, level) + player.attackDamage * effect.adRatio + player.abilityPower * effect.apRatio;
}

/**
 * 적중 시 효과 목록을 발동 시점 값으로 고정한다 (피해량은 시전자의 그 순간 스탯 기준).
 * 방어력은 맞는 순간 대상의 값으로 계산한다.
 */
function snapshotOnHit(player, onHit, level) {
  return onHit.map((e) => {
    if (e.type === 'damage') return { type: 'damage', damageType: e.damageType, raw: damageRaw(player, e, level) };
    return { ...e };
  });
}

/** 적중 시 효과 적용 */
function applyOnHit(owner, target, onHit, skill, ctx) {
  for (const e of onHit) {
    if (e.type === 'damage') dealSkillDamage(owner, target, e.raw, skill, ctx);
    else if (e.type === 'reduceCooldowns' && owner) reduceAllCooldowns(owner, e.amount);
  }
}

// --- 3. 효과: 발동 순간 실행. 투사체 효과는 새 투사체를 돌려준다 ---
const EFFECTS = {
  projectile(player, effect, cast, data, level) {
    return {
      kind: 'skillshot',
      skill: cast.skill,
      ownerId: player.id,
      team: player.team,
      x: player.x, // 시전 시간이 끝나는 순간 시전자가 있는 위치에서 발사
      y: player.y,
      dirX: cast.dirX,
      dirY: cast.dirY,
      speed: effect.speed,
      radius: effect.radius,
      collision: effect.collision,
      remaining: data.targeting.range, // 남은 비행 거리
      hitIds: [], // 관통 투사체가 이미 맞힌 대상
      onHit: snapshotOnHit(player, effect.onHit, level),
    };
  },
};

/**
 * 시전 진행. 시전 시간이 끝나면 효과를 발동하고, 새 투사체 목록을 돌려준다.
 * @returns {object[]} 새 투사체들(아이디 없음)
 */
export function updateCasting(player, dt) {
  const c = player.casting;
  if (!c) return [];
  if (player.hp <= 0) {
    player.casting = null;
    return [];
  }
  c.remaining -= dt;
  if (c.remaining > EPSILON) return [];

  player.casting = null;
  const data = getSkillData(player, c.skill);
  const level = player.skills[c.skill].level;
  const spawned = [];
  for (const effect of data.effects) {
    const out = EFFECTS[effect.type]?.(player, effect, c, data, level);
    if (out) spawned.push(out);
  }
  return spawned;
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
 * 스킬 투사체(skillshot) 이동과 적중 (원-선분 충돌: 이번 틱 이동 경로에 닿는 적).
 * - collision 'first': 가장 먼저 닿는 적 하나에게 적중하고 사라짐
 * - collision 'pierce': 닿는 적 모두에게 한 번씩 적중하고 계속 날아감
 * @returns {boolean} 투사체를 계속 유지할지 (false면 제거)
 */
export function updateSkillshot(proj, players, dt, ctx) {
  const step = Math.min(proj.speed * dt, proj.remaining);
  const ax = proj.x;
  const ay = proj.y;
  const bx = ax + proj.dirX * step;
  const by = ay + proj.dirY * step;

  const hits = [];
  for (const id in players) {
    const p = players[id];
    if (p.team === proj.team || p.hp <= 0 || p.targetable === false || proj.hitIds.includes(id)) continue;
    const { t, dist } = closestOnSegment(p.x, p.y, ax, ay, bx, by);
    if (dist <= p.gameplayRadius + proj.radius) hits.push({ p, t });
  }
  hits.sort((a, b) => a.t - b.t);

  const owner = players[proj.ownerId];
  if (hits.length && proj.collision === 'first') {
    applyOnHit(owner, hits[0].p, proj.onHit, proj.skill, ctx);
    return false;
  }
  for (const { p } of hits) {
    applyOnHit(owner, p, proj.onHit, proj.skill, ctx);
    proj.hitIds = [...proj.hitIds, p.id];
  }

  proj.x = bx;
  proj.y = by;
  proj.remaining -= step;
  return proj.remaining > EPSILON;
}

/** [화면용] 스킬의 첫 투사체 효과 (범위 표시에 사용). 없으면 null */
export function getProjectileEffect(data) {
  return data.effects.find((e) => e.type === 'projectile') ?? null;
}
