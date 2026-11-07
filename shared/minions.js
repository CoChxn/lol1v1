// 미니언: 웨이브 생성, 업그레이드 능력치, 라인 이동, 공격과 대상 선택.
//
// - 웨이브: 0:30 첫 웨이브. 14분 전 30초마다, 14분부터 25초마다, 다음 웨이브가 30분을 넘으면 20초마다
//   (13:30 → 14:00 → 14:25 … 29:25 → 29:50 → 30:10)
// - 구성: 근접 3 + (대포 웨이브면 대포 1) + 원거리 3. 생성 순서도 이 순서.
//   14분 이후 대포 웨이브는 근접 2, 30분 이후는 원거리 2.
// - 대포 웨이브: 3번째 웨이브부터. 마지막 대포 웨이브 이후 15분 전 3번째, 15분부터 2번째, 25분부터 매 웨이브.
// - 생성: 진영 시작 지점에서 맨 앞 순서 미니언부터 한 마리씩 (spawnInterval 간격)
// - 업그레이드: 첫 웨이브 = 1회, 이후 90초마다 +1. 생성될 때의 횟수로 능력치를 정하고, 살아 있는 동안 그대로.
//   v(n) = base + early × min(n, 5) + late × max(0, n − 5)  (max를 넘지 않음)
// - 이동: 라인을 따라 상대 진영 끝까지 일직선으로 가서 멈춘다. 챔피언·미니언·포탑 지형과 부딪힌다.
//
// - 공격: 챔피언 평타와 같은 흐름 (선딜레이 → 발사 → 쿨다운). 공격 타이머는 선딜레이 시작과 함께 시작.
//   근접은 즉시 적중, 원거리·대포는 유도 투사체.
//   피해: 챔피언·포탑에게 60% (대포 → 포탑 84%), 미니언끼리는 대상 현재 체력 비율 추가 피해.
// - 대상 우선순위 (위가 높음). '공격 중' = 최근 attackingMemory초 안에 피해를 줌
//   1) 아군 챔피언을 공격하는 적 챔피언 (helpRange까지)   2) 아군 챔피언을 공격하는 적 미니언
//   3) 아군 미니언을 공격하는 적 미니언   4) 아군 미니언을 공격하는 적 포탑
//   5) 가장 가까운 적 미니언   6) 가장 가까운 적 챔피언   7) 가장 가까운 적 포탑
//   2~7은 searchRange 안. 같은 순위면 가까운 것.
// - 대상 유지: 한 번 정하면 더 높은 순위가 생길 때만 바꾼다.
//   다시 고르는 때: 평타를 쏠 때마다, 대상을 잃었을 때, 쫓는 중(사거리 밖)에는 매 틱
//   대상을 잃는 때: 죽음·타겟 불가·leashRange보다 멀어짐
// - 대상이 없으면 라인 끝으로 걷는다.
//
// 아직 없는 것: 포탑과의 관계(M3), 첫 웨이브 특수 동작·골드/경험치(M4),
// 이동속도 상승·어그로(나중에 구현할 것: docs/ROADMAP.md)
//
// minion은 update에서 복사한 객체라 직접 바꿔도 된다.
import { laneToWorld } from './map.js';
import { SPAWN_INSET } from './constants.js';
import { setMoveTarget } from './movement.js';
import { canAttack, edgeDistance } from './attack.js';
import { applyDamage } from './combat.js';
import { mitigate } from './damage.js';

const EPSILON = 1e-6;

// 미니언 데이터 (숫자 조정은 여기서)
// 능력치 { base, early, late, max }: early는 업그레이드 1~5회, late는 6회부터의 업그레이드당 증가량
export const MINIONS = {
  melee: {
    name: '근접 미니언',
    hp: { base: 430, early: 35, late: 35, max: 1550 },
    attackDamage: { base: 11, early: 0, late: 3, max: 80 },
    attackSpeed: 1.25,
    windup: 0.2, // 선딜레이 (초)
    projectileSpeed: null, // 없으면 근접: 즉시 적중
    range: 110,
    armor: 0,
    magicResist: 0,
    gameplayRadius: 39, // 판정 반경
    selectionRadius: 39, // 클릭 선택 반경
    pathingRadius: 27.87185, // 이동 충돌 반경
    gold: { base: 20, perUpgrade: 0 },
    xp: 62,
    minionBonusDamage: 0.02, // 미니언끼리 추가 피해 (대상 현재 체력 비율)
    turretDamage: 0.45, // 포탑에게 받는 피해 (최대 체력 비율) — M3
  },
  caster: {
    name: '원거리 미니언',
    hp: { base: 275, early: 9, late: 12, max: 600 },
    attackDamage: { base: 19.5, early: 1.5, late: 4.25, max: 125 },
    attackSpeed: 0.667,
    windup: 0.3,
    projectileSpeed: 650,
    range: 550,
    armor: 0,
    magicResist: 0,
    gameplayRadius: 39, // 판정 반경
    selectionRadius: 39, // 클릭 선택 반경
    pathingRadius: 27.87185, // 이동 충돌 반경
    gold: { base: 14, perUpgrade: 0 },
    xp: 31,
    minionBonusDamage: 0.035,
    turretDamage: 0.7,
  },
  cannon: {
    name: '대포 미니언',
    hp: { base: 750, early: 85, late: 85, max: 5850 },
    attackDamage: { base: 36, early: 1.5, late: 4, max: 126 },
    attackSpeed: 1.0,
    windup: 0.3,
    projectileSpeed: 1200,
    range: 300,
    armor: 0,
    magicResist: 0,
    gameplayRadius: 45, // 판정 반경
    selectionRadius: 45, // 클릭 선택 반경
    pathingRadius: 32.87185, // 이동 충돌 반경
    gold: { base: 50, perUpgrade: 1 }, // 첫 웨이브 50, 이후 업그레이드마다 +1
    xp: 75,
    minionBonusDamage: 0.05,
    turretDamage: 0.14,
  },
};

export const MINION_TYPES = Object.keys(MINIONS);

// 미니언 전투 규칙
export const MINION_COMBAT = {
  damageVsChampion: 0.6, // 미니언 → 챔피언 피해 배율
  damageVsStructure: 0.6, // 미니언 → 포탑 피해 배율
  cannonVsTurret: 0.84, // 대포 미니언 → 포탑 (위 0.6 대신)
  searchRange: 500, // 대상 탐색 (미니언 중심 ~ 대상 가장자리)
  helpRange: 1000, // 아군 챔피언을 공격하는 적 챔피언(우선순위 1)은 여기까지 찾는다
  leashRange: 1000, // 대상이 이보다 멀어지면 놓는다
  attackingMemory: 2, // 최근 이 시간(초) 안에 피해를 줬으면 '공격 중'으로 본다
  windupCancelLeeway: 100, // 선딜레이 중 대상이 사거리 + 이 값보다 멀어지면 취소
  projectileRadius: 10,
};

export const MINION_WAVES = {
  firstWave: 30, // 첫 웨이브 (초)
  spawnInterval: 0.5, // 같은 진영 미니언이 한 마리씩 나오는 간격 (초)
  moveSpeed: 325,
  upgradeInterval: 90, // 업그레이드 간격 (초)
  lateFrom: 6, // 이 업그레이드부터 late 증가량
  // 웨이브 간격
  interval: { early: 30, mid: 25, late: 20, midFrom: 14 * 60, lateFrom: 30 * 60 },
  // 대포 웨이브: 마지막 대포 웨이브 이후 몇 번째 웨이브인지 (시각별)
  cannonEvery: [
    { from: 0, every: 3 },
    { from: 15 * 60, every: 2 },
    { from: 25 * 60, every: 1 },
  ],
  baseCount: { melee: 3, caster: 3 },
};

/** 웨이브 시각 t 다음 웨이브까지의 간격 */
export function waveInterval(t) {
  const { early, mid, late, midFrom, lateFrom } = MINION_WAVES.interval;
  if (t + EPSILON < midFrom) return early;
  if (t + mid > lateFrom + EPSILON) return late;
  return mid;
}

/** 시각 t(초)의 업그레이드 횟수 (첫 웨이브 = 1) */
export function upgradeCount(t) {
  if (t + EPSILON < MINION_WAVES.firstWave) return 0;
  return Math.floor((t - MINION_WAVES.firstWave) / MINION_WAVES.upgradeInterval + EPSILON) + 1;
}

/** 업그레이드 n회 능력치 */
export function minionStat(stat, n) {
  const early = Math.min(n, MINION_WAVES.lateFrom - 1);
  const late = Math.max(0, n - (MINION_WAVES.lateFrom - 1));
  return Math.min(stat.base + stat.early * early + stat.late * late, stat.max);
}

/** 웨이브 구성 (생성 순서대로 미니언 종류 목록) */
export function waveComposition(t, cannon) {
  let melee = MINION_WAVES.baseCount.melee;
  let caster = MINION_WAVES.baseCount.caster;
  if (cannon && t + EPSILON >= MINION_WAVES.interval.midFrom) melee -= 1;
  if (t + EPSILON >= MINION_WAVES.interval.lateFrom) caster -= 1;
  return [...Array(melee).fill('melee'), ...(cannon ? ['cannon'] : []), ...Array(caster).fill('caster')];
}

function cannonEvery(t) {
  let every = MINION_WAVES.cannonEvery[0].every;
  for (const rule of MINION_WAVES.cannonEvery) if (t + EPSILON >= rule.from) every = rule.every;
  return every;
}

/** 웨이브 일정 처음 상태 */
export function createWaveState(enabled = true) {
  return {
    enabled, // false면 웨이브가 나오지 않는다 (개발자 모드)
    nextWaveTime: MINION_WAVES.firstWave,
    waveCount: 0, // 지금까지 나온 웨이브 수
    sinceCannon: 0, // 마지막 대포 웨이브 이후 웨이브 수
    queue: [], // 생성 대기 [{ team, type, spawnAt, upgrade, wave }]
  };
}

/** 웨이브 일정을 한 번 진행한다 (시각 t의 웨이브). 이번 웨이브가 대포 웨이브인지 돌려준다 */
function advanceSchedule(waves, t) {
  waves.waveCount += 1;
  waves.sinceCannon += 1;
  const cannon = waves.sinceCannon >= cannonEvery(t);
  if (cannon) waves.sinceCannon = 0;
  waves.nextWaveTime = t + waveInterval(t);
  return cannon;
}

/** 웨이브 하나를 생성 대기열에 넣는다 (시각 t부터 맨 앞 순서 미니언이 한 마리씩) */
export function queueWave(waves, t, cannon, wave = waves.waveCount) {
  const types = waveComposition(t, cannon);
  const upgrade = upgradeCount(t);
  const queue = [...waves.queue];
  for (const team of ['blue', 'red']) {
    types.forEach((type, i) => queue.push({ team, type, spawnAt: t + i * MINION_WAVES.spawnInterval, upgrade: Math.max(upgrade, 1), wave }));
  }
  waves.queue = queue;
}

/**
 * 시각 time까지 일정을 미리 진행한 웨이브 상태 (시간 건너뛰기용). 미니언은 만들지 않는다.
 * nextWaveTime은 time 이후 첫 웨이브.
 */
export function waveStateAt(time, enabled = true) {
  const w = createWaveState(enabled);
  while (w.nextWaveTime <= time + EPSILON) advanceSchedule(w, w.nextWaveTime);
  return w;
}

/** 미니언 하나 만들기 */
export function createMinion({ id, team, type, upgrade, wave, map }) {
  const data = MINIONS[type];
  const L = map.lane.length;
  const start = laneToWorld(map, team === 'blue' ? SPAWN_INSET : L - SPAWN_INSET, 0);
  const hp = minionStat(data.hp, upgrade);
  const m = {
    id,
    name: data.name,
    unitType: 'minion',
    minionType: type,
    team,
    wave,
    upgrade,
    x: start.x,
    y: start.y,
    gameplayRadius: data.gameplayRadius,
    pathingRadius: data.pathingRadius,
    selectionRadius: data.selectionRadius,
    hp,
    maxHp: hp,
    attackDamage: minionStat(data.attackDamage, upgrade),
    attackSpeed: data.attackSpeed,
    range: data.range,
    armor: data.armor,
    magicResist: data.magicResist,
    moveSpeed: MINION_WAVES.moveSpeed,
    gold: data.gold.base + data.gold.perUpgrade * Math.max(0, upgrade - 1),
    xp: data.xp,
    windupTime: data.windup,
    projectileSpeed: data.projectileSpeed,
    minionBonusDamage: data.minionBonusDamage,
    attackTargetId: null, // 공격 대상
    attackState: 'idle', // 'idle' | 'chase' | 'windup' | 'cooldown'
    attackTimer: 0, // 공격 타이머 남은 시간
    attackTimerTotal: 0,
    windupTimer: null, // 선딜레이 남은 시간
    windupTargetId: null,
    target: null,
    casting: null,
    effects: [],
    marks: [],
    ghosted: false,
    avoidSide: 0, // 막혔을 때 돌아가는 쪽 (movement.js)
    avoidTicks: 0,
    targetable: true,
    invulnerable: false,
  };
  // 목적지: 상대 진영 라인 끝 (도착하면 멈춘다)
  m.laneEnd = laneToWorld(map, team === 'blue' ? L : 0, 0); // null이면 제자리 (검사용)
  setMoveTarget(m, m.laneEnd.x, m.laneEnd.y, map);
  m.walkingToEnd = true; // 라인 끝으로 걷는 중 (도착하면 이동 목표가 사라지고 멈춘다)
  return m;
}

/**
 * 웨이브 일정 진행과 생성. time: 이번 틱이 끝나는 시각.
 * @returns {object[]} 새로 생긴 미니언 (id 없음 → update에서 붙인다)
 */
export function updateWaves(waves, time, map) {
  // 일정은 항상 진행한다 (생성을 꺼 둔 동안에도 웨이브 번호·대포 순서가 경기 시간과 맞도록)
  while (waves.nextWaveTime <= time + EPSILON) {
    const t = waves.nextWaveTime;
    const cannon = advanceSchedule(waves, t);
    if (waves.enabled) queueWave(waves, t, cannon);
  }
  const ready = waves.queue.filter((q) => q.spawnAt <= time + EPSILON);
  if (!ready.length) return [];
  waves.queue = waves.queue.filter((q) => q.spawnAt > time + EPSILON);
  return ready.map((q) => ({ team: q.team, type: q.type, upgrade: q.upgrade, wave: q.wave, map }));
}

// ---------------------------------------------------------------------------
// 전투

/** 최근 피해 기록 { sourceId, targetId, time } 중 a가 b 쪽(팀·종류 조건)을 공격 중인지 */
function isAttacking(recent, attackerId, victimFilter) {
  return recent.some((h) => h.sourceId === attackerId && victimFilter(h.targetId));
}

/** 미니언 중심 ~ 대상 가장자리 */
function reach(m, u) {
  return Math.hypot(u.x - m.x, u.y - m.y) - u.gameplayRadius;
}

/**
 * 대상 u의 우선순위 (작을수록 높음). 대상이 될 수 없거나 탐색 범위 밖이면 Infinity
 * @param {object[]} recent  최근 피해 기록
 */
export function minionPriority(m, u, units, recent) {
  if (!canAttack(m, u)) return Infinity;
  const kind = u.unitType ?? 'champion';
  const allyOf = (kind2) => (id) => {
    const v = units[id];
    return !!v && v.team === m.team && (v.unitType ?? 'champion') === kind2;
  };
  const d = reach(m, u);
  if (kind === 'champion' && d <= MINION_COMBAT.helpRange && isAttacking(recent, u.id, allyOf('champion'))) return 1;
  if (d > MINION_COMBAT.searchRange) return Infinity;
  if (kind === 'minion' && isAttacking(recent, u.id, allyOf('champion'))) return 2;
  if (kind === 'minion' && isAttacking(recent, u.id, allyOf('minion'))) return 3;
  if (kind === 'turret' && isAttacking(recent, u.id, allyOf('minion'))) return 4;
  if (kind === 'minion') return 5;
  if (kind === 'champion') return 6;
  if (kind === 'turret') return 7;
  return Infinity;
}

/** 가장 높은 우선순위 대상 (같은 순위면 가까운 것) */
function bestTarget(m, units, recent) {
  let best = null;
  let bestRank = Infinity;
  let bestDist = Infinity;
  for (const id in units) {
    const u = units[id];
    const rank = minionPriority(m, u, units, recent);
    if (rank === Infinity) continue;
    const d = reach(m, u);
    if (rank < bestRank || (rank === bestRank && d < bestDist)) {
      best = u;
      bestRank = rank;
      bestDist = d;
    }
  }
  return best ? { unit: best, rank: bestRank } : null;
}

/** 지금 대상보다 높은 순위가 있으면 바꾼다 (같은 순위로는 바꾸지 않음) */
function reevaluate(m, units, recent) {
  const best = bestTarget(m, units, recent);
  if (!best) return;
  const cur = m.attackTargetId && units[m.attackTargetId];
  const curRank = cur ? minionPriority(m, cur, units, recent) : Infinity;
  if (!cur || best.rank < curRank) m.attackTargetId = best.unit.id;
}

/** 미니언 공격이 대상에게 주는 피해 (감소 전) */
export function minionHitRaw(attacker, target) {
  const kind = target.unitType ?? 'champion';
  const ad = attacker.attackDamage;
  if (kind === 'minion') return ad + target.hp * attacker.minionBonusDamage;
  if (kind === 'turret') return ad * (attacker.minionType === 'cannon' ? MINION_COMBAT.cannonVsTurret : MINION_COMBAT.damageVsStructure);
  return ad * MINION_COMBAT.damageVsChampion;
}

/** 미니언 공격 적중 (물리 피해) */
export function dealMinionDamage(attacker, sourceId, target, ctx) {
  const raw = minionHitRaw(attacker, target);
  const amount = applyDamage(target, mitigate(raw, 'physical', target));
  ctx.events.push({ type: 'damage', damageType: 'physical', targetId: target.id, sourceId, raw, amount, crit: false, minion: true });
}

function cancelMinionWindup(m) {
  m.windupTimer = null;
  m.windupTargetId = null;
  m.attackTimer = 0;
  m.attackTimerTotal = 0;
}

/**
 * 미니언 한 틱: 대상 확인·선택, 추적, 선딜레이, 발사, 대상 없으면 라인 끝으로.
 * @param {object} units  대상 후보 (챔피언·미니언·포탑)
 * @param {object[]} recent  최근 피해 기록
 * @returns {object|null} 새 투사체(아이디 없음)
 */
export function updateMinion(m, units, recent, map, dt, ctx) {
  m.attackTimer = Math.max(0, m.attackTimer - dt);

  // 대상을 잃음: 죽음·타겟 불가·너무 멀어짐
  const cur = m.attackTargetId && units[m.attackTargetId];
  if (m.attackTargetId && (!canAttack(m, cur) || reach(m, cur) > MINION_COMBAT.leashRange)) m.attackTargetId = null;
  if (!m.attackTargetId) reevaluate(m, units, recent);
  // 쫓는 중(선딜레이 아님, 사거리 밖)에는 매 틱 다시 고른다 → 도망치는 대상을 쫓다가도 더 높은 순위가 생기면 바로 바꾼다
  else if (m.windupTargetId === null && edgeDistance(m, units[m.attackTargetId]) > m.range) reevaluate(m, units, recent);

  let shot = null;
  // 선딜레이 진행 (대상이 사라지거나 멀어지면 취소)
  if (m.windupTargetId !== null) {
    const wt = units[m.windupTargetId];
    if (!canAttack(m, wt) || edgeDistance(m, wt) > m.range + MINION_COMBAT.windupCancelLeeway) {
      cancelMinionWindup(m);
    }
  }

  const target = m.attackTargetId && units[m.attackTargetId];
  if (m.windupTargetId === null && target) {
    if (edgeDistance(m, target) > m.range) {
      setMoveTarget(m, target.x, target.y, map); // 추적
    } else {
      m.target = null;
      if (m.attackTimer <= EPSILON) {
        m.windupTargetId = target.id;
        m.windupTimer = m.windupTime;
        m.attackTimer = m.attackTimerTotal = 1 / m.attackSpeed;
      }
    }
  } else if (!target && m.windupTargetId === null) {
    // 대상 없음: 라인 끝으로. 걸어가다 이동 목표가 없어졌으면 도착한 것 (다른 유닛에 막혀 멈춘 경우 포함) → 그대로
    if (!m.walkingToEnd && m.laneEnd) {
      setMoveTarget(m, m.laneEnd.x, m.laneEnd.y, map);
      m.walkingToEnd = true;
    }
  }
  if (target || m.windupTargetId !== null) m.walkingToEnd = false;

  if (m.windupTargetId !== null) {
    m.target = null;
    m.windupTimer -= dt;
    if (m.windupTimer <= EPSILON) {
      const wt = units[m.windupTargetId];
      if (m.projectileSpeed) {
        shot = {
          kind: 'minion',
          ownerId: m.id,
          team: m.team,
          minionType: m.minionType,
          targetId: wt.id,
          x: m.x,
          y: m.y,
          speed: m.projectileSpeed,
          radius: MINION_COMBAT.projectileRadius,
          // 맞는 순간 계산에 쓰는 발사 시점 값
          attackDamage: m.attackDamage,
          minionBonusDamage: m.minionBonusDamage,
        };
      } else {
        dealMinionDamage(m, m.id, wt, ctx);
      }
      m.windupTimer = null;
      m.windupTargetId = null;
      // 평타를 쏠 때마다 대상을 다시 고른다
      reevaluate(m, units, recent);
    }
  }

  m.attackState =
    m.windupTargetId !== null ? 'windup' : target && edgeDistance(m, target) > m.range ? 'chase' : m.attackTimer > EPSILON ? 'cooldown' : 'idle';
  return shot;
}

/**
 * 미니언 투사체 이동과 적중. 대상이 사라지거나 타겟 불가가 되면 없어진다.
 * @returns {boolean} 계속 유지할지
 */
export function updateMinionShot(proj, units, dt, ctx) {
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
  dealMinionDamage(proj, proj.ownerId, target, ctx);
  return false;
}

/** 이번 틱 피해 이벤트를 최근 피해 기록에 더하고, 오래된 것은 지운다 */
export function updateRecentHits(recent, events, time) {
  const keep = recent.filter((h) => time - h.time < MINION_COMBAT.attackingMemory - EPSILON);
  for (const ev of events) {
    if (ev.type === 'damage' && ev.raw > 0 && ev.sourceId) keep.push({ sourceId: ev.sourceId, targetId: ev.targetId, time });
  }
  return keep;
}
