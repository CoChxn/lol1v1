// 스킬 로직. 스킬은 조준(targeting) / 발동(activation) / 효과(effects) 세 축의 조합이다 (docs/SKILL_DESIGN.md).
// - 입력: { type: 'cast', skill: 'Q', x, y }  (x, y: 마우스 월드 좌표)
// - 시전 조건: 살아 있음, 스킬 레벨 1 이상, 쿨타임 0, 마나 충분, 다른 스킬 시전 중 아님
// - 시전하면 마나 소모·쿨타임 시작 → 시전 시간(activation.castTime) 동안 멈춰 섬 → 효과 발동
// - 시전 중에는 이동·평타를 하지 않는다. 시전이 끝나면 하던 이동·평타 명령을 이어 간다.
//
// 구현된 축:
// - 조준: direction (마우스 방향, 사거리 밖이면 최대 사거리로)
//         location (땅 클릭, 사거리 밖이면 그 방향으로 최대 사거리 지점)
// - 발동: normal (+ 시전 시간)
// - 효과: projectile (직선, collision: first | pierce, targets: all | champions, origin: castEnd | castStart)
//         blink (조준한 위치로 순간이동)
//         homingProjectile (자동 대상 선택 → 유도 투사체)
//         → 적중 시 onHit: damage(physical·magic·true), reduceCooldowns, applyMark(표식, marks.js), reveal(시야)
//
// player·projectile은 update에서 복사한 객체라 직접 바꿔도 된다.
import { getChampion } from './champions/index.js';
import { SKILL_KEYS, SKILL_MAX_LEVEL, skillMaxLevel } from './champions/validate.js';
import { spendMana } from './combat.js';
import { cancelWindup } from './attack.js';
import { dealSkillDamage, damageRaw } from './damage.js';
import { clampToMap, resolveOverlap } from './movement.js';
import { applyMark, triggerMarks } from './marks.js';
import { onSkillHit } from './passive.js';

const EPSILON = 1e-6;

export { SKILL_KEYS, SKILL_MAX_LEVEL, skillMaxLevel };

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
  // 위치: 땅 클릭 지점. 사거리 밖이면 그 방향으로 최대 사거리 지점 (outOfRange: 'maxRange')
  // 실제 효과 위치는 발동 순간 시전자 위치에서 이 지점 쪽으로 다시 계산한다 (시전 중 밀려도 최대 사거리 유지)
  location(player, targeting, x, y) {
    const dx = x - player.x;
    const dy = y - player.y;
    const len = Math.hypot(dx, dy);
    if (len <= targeting.range) return { tx: x, ty: y };
    return { tx: player.x + (dx / len) * targeting.range, ty: player.y + (dy / len) * targeting.range };
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
  // 시전 시작 위치도 저장한다 (origin: 'castStart' 투사체는 여기서 발사)
  player.casting = { skill: key, ...aim, startX: player.x, startY: player.y, remaining: data.activation.castTime, total: data.activation.castTime };
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

/**
 * 적중 시 효과 목록을 발동 시점 값으로 고정한다 (피해량은 시전자의 그 순간 스탯 기준).
 * 방어력은 맞는 순간 대상의 값으로 계산한다.
 */
function snapshotOnHit(player, onHit, level) {
  return onHit.map((e) => {
    if (e.type === 'damage') {
      return {
        type: 'damage',
        damageType: e.damageType,
        raw: damageRaw(player, e, level),
        // 챔피언이 아닌 대상에게 다른 기본 피해를 쓰는 스킬
        rawNonChampion: e.nonChampionBase ? damageRaw(player, e, level, e.nonChampionBase) : undefined,
      };
    }
    return { ...e };
  });
}

/** 적중 시 효과 적용 */
function applyOnHit(proj, owner, target, ctx) {
  for (const e of proj.onHit) {
    if (e.type === 'damage') {
      const raw = target.unitType !== 'champion' && e.rawNonChampion !== undefined ? e.rawNonChampion : e.raw;
      dealSkillDamage(owner, target, raw, e.damageType, proj.skill, ctx);
    }
    else if (e.type === 'reduceCooldowns' && owner) reduceAllCooldowns(owner, e.amount);
    else if (e.type === 'applyMark') applyMark(proj.ownerId, target, proj.skill, e.duration);
    else if (e.type === 'reveal') target.revealed = Math.max(target.revealed ?? 0, e.duration);
  }
  // 이 스킬로 시전자의 표식이 터진다 (같은 스킬의 표식은 제외)
  triggerMarks(owner, target, { by: 'skill', skill: proj.skill, manaCost: proj.manaCost }, ctx);
  // 패시브: 스킬이 적을 맞힘 (맞은 적 하나당 1번)
  onSkillHit(owner, target);
}

/**
 * 유도 투사체의 대상 고르기: 시전자 위치에서 acquireRadius 안(대상 가장자리 기준)의 적
 * - nearest: 가장 가까운 적
 * - markedFirst: 시전자의 표식이 붙은 적 중 가장 가까운 적 → 없으면 가장 가까운 적
 */
export function pickHomingTarget(player, players, effect) {
  let best = null;
  let bestDist = Infinity;
  let bestMarked = false;
  for (const id in players) {
    const p = players[id];
    if (p.team === player.team || p.hp <= 0 || p.targetable === false) continue;
    const d = Math.hypot(p.x - player.x, p.y - player.y);
    if (d - p.gameplayRadius > effect.acquireRadius) continue;
    const marked = effect.priority === 'markedFirst' && p.marks.some((m) => m.ownerId === player.id);
    if ((marked && !bestMarked) || (marked === bestMarked && d < bestDist)) {
      best = p;
      bestDist = d;
      bestMarked = marked;
    }
  }
  return best;
}

// --- 3. 효과: 발동 순간 실행. 투사체 효과는 새 투사체를 돌려준다 ---
const EFFECTS = {
  // 순간이동: 발동 순간 위치에서 조준 지점 쪽으로 최대 사거리까지. 벽 안이면 가장 가까운 벽 밖, 다른 캐릭터와 겹치면 밀어냄
  blink(player, effect, cast, data, level, players, map) {
    const dx = cast.tx - player.x;
    const dy = cast.ty - player.y;
    const len = Math.hypot(dx, dy);
    const dist = Math.min(len, data.targeting.range);
    const dirX = len > 0 ? dx / len : 1;
    const dirY = len > 0 ? dy / len : 0;
    const dest = clampToMap(player.x + dirX * dist, player.y + dirY * dist, player.pathingRadius, map);
    player.x = dest.x;
    player.y = dest.y;
    resolveOverlap(player, players, map, dirX, dirY);
    player.target = null; // 가던 이동은 멈춘다 (평타 명령은 유지)
    return null;
  },

  // 유도 투사체: 대상이 없으면 나가지 않는다
  homingProjectile(player, effect, cast, data, level, players) {
    const target = pickHomingTarget(player, players, effect);
    if (!target) return null;
    return {
      kind: 'homingSkill',
      skill: cast.skill,
      ownerId: player.id,
      team: player.team,
      x: player.x,
      y: player.y,
      targetId: target.id,
      speed: effect.speed,
      radius: 12, // 그리기용 (적중은 대상 판정 원에 닿을 때)
      manaCost: levelValue(data.manaCost, level),
      onHit: snapshotOnHit(player, effect.onHit, level),
    };
  },

  projectile(player, effect, cast, data, level) {
    return {
      kind: 'skillshot',
      skill: cast.skill,
      ownerId: player.id,
      team: player.team,
      // 발사 위치: 기본은 시전 시간이 끝나는 순간의 시전자 위치, origin 'castStart'면 시전을 시작한 위치
      x: effect.origin === 'castStart' ? cast.startX : player.x,
      y: effect.origin === 'castStart' ? cast.startY : player.y,
      dirX: cast.dirX,
      dirY: cast.dirY,
      speed: effect.speed,
      radius: effect.radius,
      collision: effect.collision,
      targets: effect.targets ?? 'all',
      shape: effect.shape ?? 'bolt',
      manaCost: levelValue(data.manaCost, level), // 표식을 터뜨릴 때 마나 회복 계산용
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
export function updateCasting(player, dt, players, map) {
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
    const out = EFFECTS[effect.type]?.(player, effect, c, data, level, players, map);
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
    if (proj.targets === 'champions' && p.unitType !== 'champion') continue; // 챔피언만 맞는 투사체는 다른 유닛을 통과
    const { t, dist } = closestOnSegment(p.x, p.y, ax, ay, bx, by);
    if (dist <= p.gameplayRadius + proj.radius) hits.push({ p, t });
  }
  hits.sort((a, b) => a.t - b.t);

  const owner = players[proj.ownerId];
  if (hits.length && proj.collision === 'first') {
    applyOnHit(proj, owner, hits[0].p, ctx);
    return false;
  }
  for (const { p } of hits) {
    applyOnHit(proj, owner, p, ctx);
    proj.hitIds = [...proj.hitIds, p.id];
  }

  proj.x = bx;
  proj.y = by;
  proj.remaining -= step;
  return proj.remaining > EPSILON;
}

/**
 * 유도 스킬 투사체(homingSkill) 이동과 적중. 대상의 판정 원에 닿으면 적중.
 * 대상이 죽거나 타겟 불가가 되면 사라진다.
 * @returns {boolean} 투사체를 계속 유지할지
 */
export function updateHomingSkill(proj, players, dt, ctx) {
  const target = players[proj.targetId];
  if (!target || target.hp <= 0 || target.targetable === false) return false;
  const dx = target.x - proj.x;
  const dy = target.y - proj.y;
  const dist = Math.hypot(dx, dy);
  const step = proj.speed * dt;
  if (dist - step <= target.gameplayRadius) {
    applyOnHit(proj, players[proj.ownerId], target, ctx);
    return false;
  }
  proj.dirX = dx / dist;
  proj.dirY = dy / dist;
  proj.x += proj.dirX * step;
  proj.y += proj.dirY * step;
  return true;
}

/** [화면용] 스킬의 첫 투사체 효과 (범위 표시에 사용). 없으면 null */
export function getProjectileEffect(data) {
  return data.effects.find((e) => e.type === 'projectile') ?? null;
}
