// 포탑 로직. 진영마다 하나씩 라인 위에 서 있고, 사거리 안의 적을 자동으로 공격한다.
//
// - 공격 흐름: 대기 → 포착(acquireTime) → 선딜레이(windupTime) → 발사 → 쿨다운 → 선딜레이 …
//   공격 타이머(1 / 공격속도)는 선딜레이를 시작할 때 함께 시작한다 (챔피언 평타와 같음).
//   투사체는 유도형이고 막히지 않는다.
// - 포착: 새 대상을 잡으면 바로 쏘지 않고 잠깐 기다린다 → 사거리 경계를 들어갔다 나오는 '포탑 위빙'이 가능.
//   포착 중 대상이 사거리를 벗어나면 취소, 다시 들어오면 처음부터.
//   건너뛰는 경우: 어그로 전환 / 공격하던 대상을 잃고 바로 전 틱에도 사거리 안에 있던 적으로 바꿀 때
// - 선딜레이 중 대상이 사거리를 벗어나거나 죽거나 타겟 불가가 되면 공격 취소, 공격 타이머 0으로.
//   선딜레이 중 어그로 전환: 준비 중인 공격은 원래 대상에게 쏘고, 다음 공격부터 새 대상.
// - 대상 유지: 처음 잡은 대상이 죽거나, 사거리를 벗어나거나, 타겟 불가가 될 때까지 계속 공격한다.
// - 새 대상 우선순위: 펫 → 미니언 → 챔피언. 같은 종류 안에서는 포탑에 가장 가까운 대상.
// - 어그로 전환: 포탑 사거리 안의 적 챔피언이, 포탑에서 1,400 안에 있는 아군 챔피언에게 피해를 주면
//   그 적 챔피언으로 대상을 바꾼다. (피해가 무적·주문 보호막에 막혀도 피해를 준 것으로 본다.
//   피해 없는 스킬은 해당 없음)
// - 챔피언 상대 피해 증가: 챔피언을 맞힐 때마다 +40% (최대 +120%). 마지막으로 챔피언을 맞힌 뒤
//   3초가 지나면 초기화. 대상을 바꿔도 초기화되지 않는다.
// - 방어력 관통 30%: 맞는 챔피언의 방어력을 30% 무시한다.
// - 시간에 따른 능력치: 공격력 185 + 1분마다 9 (12분에 293으로 최대), 방어력·마법 저항력 60 → 12분부터 40
// - 파괴되면 잔해가 남고, 지형(이동 충돌 원)도 그대로 남는다 (map.obstacles).
// - 미니언: 새 대상은 미니언이 챔피언보다 먼저. 미니언에게는 최대 체력 비율 피해 (근접 45%, 원거리 70%, 대포 14%),
//   피해 증가 없음.
// - 강화 방어: 사거리 안에 적 미니언이 없으면 받는 모든 피해 80% 감소 (turret.damageReduction → damage.js mitigate)
// - 아직 없는 것: 시야(값만 저장)
//
// turret은 update에서 복사한 객체라 직접 바꿔도 된다.
import { laneToWorld } from './map.js';
import { applyDamage } from './combat.js';
import { armorMultiplier } from './damage.js';
import { MINIONS } from './minions.js';

// 포탑 데이터 (숫자 조정은 여기서)
export const TURRET = {
  maxHp: 1700,
  gameplayRadius: 88, // 판정 반경 (평타 사거리 계산, 투사체 적중)
  selectionRadius: 120, // 클릭 선택 반경
  obstacleRadius: 100, // 지형 반경: 캐릭터가 지나갈 수 없는 원 (파괴 후에도 남는다)
  range: 750, // 공격 사거리: 포탑 중심 ~ 대상 가장자리
  attackSpeed: 1 / 1.2, // 초당 공격 횟수 (≈0.833, 공격 타이머 정확히 1.2초 = 36틱)
  acquireTime: 0.25, // 포착 지연 (새 대상을 잡고 선딜레이를 시작하기까지)
  windupTime: 0.2, // 선딜레이
  projectileSpeed: 1200,
  projectileRadius: 30,
  armorPen: 0.3, // 방어력 관통 (비율)
  visionRange: 1350, // 시야 (시야 기능이 생기면 사용)
  // 공격력: base + perMinute × 지난 분 (max에서 멈춤)
  attackDamage: { base: 185, perMinute: 9, max: 293 },
  // 방어력·마법 저항력: changeAt초부터 late
  resist: { early: 60, late: 40, changeAt: 12 * 60 },
  // 챔피언 상대 피해 증가
  ramp: { perHit: 0.4, maxStacks: 3, resetTime: 3 },
  // 어그로 전환: 이 거리 안의 아군 챔피언이 공격당하면
  aggroAllyRange: 1400,
  // 강화 방어: 사거리 안(중심 ~ 미니언 가장자리 range)에 적 미니언이 하나도 없으면 받는 피해 감소
  reinforcedReduction: 0.8,
  // 위치 (통로 기준 좌표): u = 파랑 끝에서 라인 방향 거리, v = 라인 가운데에서 가로 방향 거리
  //   v < 0: 화면 왼쪽 위, v > 0: 오른쪽 아래. 미니언 통행로(v = 0)를 막지 않도록 비켜 둔다
  //   (|v| > 지형 반경 100 + 미니언 이동 충돌 반경 35.7)
  // 라인 방향 사이 3600, 맵 중앙 기준 점대칭
  positions: {
    blue: { u: 6200, v: -150 },
    red: { u: 9800, v: 150 },
  },
};

// 새 대상 우선순위 (앞일수록 먼저)
const TARGET_PRIORITY = ['pet', 'minion', 'champion'];

const EPSILON = 1e-6;

/** 진영별 포탑 두 개 { [id]: turret } */
export function createTurrets(map) {
  const turrets = {};
  for (const team of ['blue', 'red']) {
    const { u, v } = TURRET.positions[team];
    const pos = laneToWorld(map, u, v);
    const id = `turret-${team}`;
    turrets[id] = {
      id,
      name: team === 'blue' ? '파랑 포탑' : '빨강 포탑',
      unitType: 'turret',
      team,
      x: pos.x,
      y: pos.y,
      gameplayRadius: TURRET.gameplayRadius,
      selectionRadius: TURRET.selectionRadius,
      hp: TURRET.maxHp,
      maxHp: TURRET.maxHp,
      armor: TURRET.resist.early,
      magicResist: TURRET.resist.early,
      attackDamage: TURRET.attackDamage.base,
      range: TURRET.range,
      visionRange: TURRET.visionRange,
      attackState: 'idle', // 'idle' | 'acquire' | 'windup' | 'cooldown'
      attackTimer: 0, // 공격 타이머 남은 시간. 0이면 새 선딜레이 가능
      attackTimerTotal: 0, // 이번 공격 타이머 전체 길이 (표시용)
      acquireTimer: null, // 포착 남은 시간. null이면 포착 중 아님
      windupTimer: null, // 선딜레이 남은 시간. null이면 선딜레이 중 아님
      windupTargetId: null, // 지금 선딜레이 중인 공격의 대상
      inRangeIds: [], // 바로 전 틱에 사거리 안에 있던 적 (포착 건너뛰기 판정)
      targetId: null, // 지금 공격 중인 대상
      rampStacks: 0, // 챔피언 상대 피해 증가 중첩 (0 ~ maxStacks)
      rampTimer: 0, // 중첩 초기화까지 남은 시간
      destroyed: false,
      damageReduction: 0, // 받는 피해 감소 비율 (강화 방어 중이면 reinforcedReduction)
      targetable: true,
      invulnerable: false,
      marks: [],
      effects: [],
    };
  }
  return turrets;
}

/** 포탑 지형 (이동 충돌 원) 목록: map.obstacles에 넣는다 */
export function turretObstacles(turrets) {
  return Object.values(turrets).map((t) => ({ id: t.id, x: t.x, y: t.y, radius: TURRET.obstacleRadius }));
}

/** 게임 시간(초)에 따른 공격력 */
export function turretAttackDamage(time) {
  const { base, perMinute, max } = TURRET.attackDamage;
  return Math.min(base + perMinute * Math.floor(time / 60 + EPSILON), max);
}

/** 게임 시간(초)에 따른 방어력·마법 저항력 */
export function turretResist(time) {
  const { early, late, changeAt } = TURRET.resist;
  return time + EPSILON >= changeAt ? late : early;
}

/** 포탑 중심 ~ 대상 가장자리 거리 */
function turretDistance(turret, unit) {
  return Math.hypot(unit.x - turret.x, unit.y - turret.y) - unit.gameplayRadius;
}

/** 포탑이 공격할 수 있는 대상인지 (적, 살아 있음, 타겟 가능, 사거리 안) */
export function turretCanTarget(turret, unit) {
  return (
    !!unit &&
    unit.team !== turret.team &&
    unit.hp > 0 &&
    unit.targetable !== false &&
    unit.unitType !== 'turret' &&
    turretDistance(turret, unit) <= turret.range
  );
}

/** 우선순위가 가장 높은 대상 (같은 종류면 가장 가까운 것) */
function pickTarget(turret, units) {
  let best = null;
  let bestRank = Infinity;
  let bestDist = Infinity;
  for (const id in units) {
    const u = units[id];
    if (!turretCanTarget(turret, u)) continue;
    const rank = TARGET_PRIORITY.indexOf(u.unitType ?? 'champion');
    const r = rank < 0 ? TARGET_PRIORITY.length : rank;
    const d = turretDistance(turret, u);
    if (r < bestRank || (r === bestRank && d < bestDist)) {
      best = u;
      bestRank = r;
      bestDist = d;
    }
  }
  return best;
}

/**
 * 어그로 전환 대상: 이번 틱 피해 이벤트 중, 포탑 사거리 안의 적 챔피언이
 * 포탑 근처(aggroAllyRange) 아군 챔피언에게 피해를 준 경우 그 적 챔피언
 */
function findAggroTarget(turret, units, events) {
  for (const ev of events) {
    if (ev.type !== 'damage' || !(ev.raw > 0)) continue;
    const victim = units[ev.targetId];
    const attacker = units[ev.sourceId];
    if (!victim || !attacker) continue;
    if (victim.team !== turret.team || (victim.unitType ?? 'champion') !== 'champion') continue;
    if ((attacker.unitType ?? 'champion') !== 'champion') continue;
    if (Math.hypot(victim.x - turret.x, victim.y - turret.y) > TURRET.aggroAllyRange) continue;
    if (!turretCanTarget(turret, attacker)) continue;
    return attacker;
  }
  return null;
}

/** 시간 흐름: 공격 타이머, 피해 증가 중첩 초기화, 시간에 따른 능력치 */
export function tickTurret(turret, time, dt) {
  turret.attackTimer = Math.max(0, turret.attackTimer - dt);
  if (turret.rampTimer > 0) {
    turret.rampTimer = Math.max(0, turret.rampTimer - dt);
    if (turret.rampTimer <= EPSILON) turret.rampStacks = 0;
  }
  turret.attackDamage = turretAttackDamage(time);
  turret.armor = turret.magicResist = turretResist(time);
}

/** 선딜레이 취소: 공격 타이머를 0으로 되돌린다 */
function cancelTurretWindup(turret) {
  turret.windupTimer = null;
  turret.windupTargetId = null;
  turret.attackTimer = 0;
  turret.attackTimerTotal = 0;
}

/**
 * 한 틱 동안의 포탑 대상 선택, 포착, 선딜레이, 발사. (이번 틱 피해가 모두 끝난 뒤에 호출한다)
 * @param {object} units  공격 대상 후보 { [id]: unit } (챔피언·포탑)
 * @param {object[]} events  이번 틱 이벤트 (어그로 전환 판정)
 * @returns {object|null} 새 투사체(아이디 없음)
 */
export function updateTurret(turret, units, events, dt) {
  if (turret.destroyed) {
    turret.targetId = null;
    turret.acquireTimer = null;
    turret.windupTimer = null;
    turret.windupTargetId = null;
    turret.inRangeIds = [];
    turret.attackState = 'idle';
    return null;
  }
  const wasInRange = new Set(turret.inRangeIds);
  turret.inRangeIds = Object.keys(units).filter((id) => turretCanTarget(turret, units[id]));

  // 선딜레이 중인 공격의 대상이 사거리 밖·사망·타겟 불가 → 취소
  if (turret.windupTargetId && !turretCanTarget(turret, units[turret.windupTargetId])) cancelTurretWindup(turret);

  // 대상 유지 조건이 깨지면 놓는다 (포착을 마친 대상이었는지 기억)
  let lostAcquired = false;
  if (turret.targetId && !turretCanTarget(turret, units[turret.targetId])) {
    lostAcquired = turret.acquireTimer === null;
    turret.targetId = null;
    turret.acquireTimer = null;
  }

  // 어그로 전환: 포착 없이 바로 (선딜레이 중인 공격은 원래 대상에게 그대로)
  const aggro = findAggroTarget(turret, units, events);
  if (aggro && aggro.id !== turret.targetId) {
    turret.targetId = aggro.id;
    turret.acquireTimer = null;
  }

  // 새 대상: 공격하던 대상을 잃었고 새 대상이 이미 사거리 안에 있었으면 포착 생략
  if (!turret.targetId) {
    const pick = pickTarget(turret, units);
    if (pick) {
      turret.targetId = pick.id;
      turret.acquireTimer = lostAcquired && wasInRange.has(pick.id) ? null : TURRET.acquireTime;
    }
  }

  let shot = null;
  // 포착 진행 (포착이 끝난 틱에는 선딜레이를 시작하지 않는다 → 다음 틱부터)
  let acquiring = false;
  if (turret.acquireTimer !== null) {
    acquiring = true;
    turret.acquireTimer -= dt;
    if (turret.acquireTimer <= EPSILON) turret.acquireTimer = null;
  }

  // 선딜레이 시작: 대상 있음, 포착 끝, 공격 타이머 끝
  if (!acquiring && turret.targetId && turret.windupTargetId === null && turret.attackTimer <= EPSILON) {
    turret.windupTargetId = turret.targetId;
    turret.windupTimer = TURRET.windupTime;
    turret.attackTimer = turret.attackTimerTotal = 1 / TURRET.attackSpeed;
  }

  // 선딜레이 진행 → 발사. 피해량은 발사 순간 공격력, 피해 증가와 방어력은 맞는 순간 계산
  if (turret.windupTargetId !== null) {
    turret.windupTimer -= dt;
    if (turret.windupTimer <= EPSILON) {
      shot = {
        kind: 'turret',
        ownerId: turret.id,
        team: turret.team,
        targetId: turret.windupTargetId,
        x: turret.x,
        y: turret.y,
        speed: TURRET.projectileSpeed,
        radius: TURRET.projectileRadius,
        raw: turret.attackDamage,
      };
      turret.windupTimer = null;
      turret.windupTargetId = null;
    }
  }

  turret.attackState =
    turret.windupTargetId !== null ? 'windup' : turret.acquireTimer !== null ? 'acquire' : turret.attackTimer > EPSILON ? 'cooldown' : 'idle';
  return shot;
}

/** 강화 방어 갱신: 사거리 안에 적 미니언이 없으면 받는 피해 감소 (매 틱, 피해 계산 전에) */
export function updateReinforced(turret, units) {
  let enemyMinionNear = false;
  for (const id in units) {
    const u = units[id];
    if (u.unitType === 'minion' && u.team !== turret.team && u.hp > 0 && turretDistance(turret, u) <= turret.range) {
      enemyMinionNear = true;
      break;
    }
  }
  turret.damageReduction = turret.destroyed || enemyMinionNear ? 0 : TURRET.reinforcedReduction;
}

/**
 * 포탑 공격이 대상에게 들어가는 피해 (감소 전)
 * - 미니언: 최대 체력 비율 (종류별 turretDamage)
 * - 챔피언: 피해 증가 포함, 중첩을 쌓는다
 */
function turretHitRaw(turret, target, raw) {
  if (target.unitType === 'minion') return target.maxHp * MINIONS[target.minionType].turretDamage;
  if ((target.unitType ?? 'champion') !== 'champion' || !turret) return raw;
  const mult = 1 + TURRET.ramp.perHit * turret.rampStacks;
  turret.rampStacks = Math.min(turret.rampStacks + 1, TURRET.ramp.maxStacks);
  turret.rampTimer = TURRET.ramp.resetTime;
  return raw * mult;
}

/** 방어력 관통 적용 후 방어력 (음수 방어력은 그대로) */
export function penetratedArmor(armor, pen = TURRET.armorPen) {
  return armor > 0 ? armor * (1 - pen) : armor;
}

/**
 * 포탑 투사체 이동과 적중. 대상이 사라지거나 타겟 불가가 되면 없어진다.
 * @returns {boolean} 계속 유지할지
 */
export function updateTurretShot(proj, units, dt, ctx) {
  const target = units[proj.targetId];
  if (!target || target.hp <= 0 || target.targetable === false) return false;

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
  if (Math.hypot(target.x - proj.x, target.y - proj.y) >= proj.radius + target.gameplayRadius) return true;

  const turret = units[proj.ownerId];
  const raw = turretHitRaw(turret, target, proj.raw);
  const amount = applyDamage(target, raw * armorMultiplier(penetratedArmor(target.armor)));
  ctx.events.push({ type: 'damage', damageType: 'physical', targetId: target.id, sourceId: proj.ownerId, raw, amount, crit: false, turret: true });
  return false;
}

/** 포탑이 피해를 받아 체력이 0이 되면 파괴 처리 */
export function checkTurretDestroyed(turret, ctx) {
  if (turret.destroyed || turret.hp > 0) return;
  turret.destroyed = true;
  turret.targetable = false;
  turret.targetId = null;
  ctx.events.push({ type: 'turretDestroyed', turretId: turret.id });
}
