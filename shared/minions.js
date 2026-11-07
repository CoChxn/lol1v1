// 미니언: 웨이브 생성, 업그레이드 능력치, 라인 이동. (M1: 공격·대상 선택은 아직 없음)
//
// - 웨이브: 0:30 첫 웨이브. 14분 전 30초마다, 14분부터 25초마다, 다음 웨이브가 30분을 넘으면 20초마다
//   (13:30 → 14:00 → 14:25 … 29:25 → 29:50 → 30:10)
// - 구성: 근접 3 + (대포 웨이브면 대포 1) + 원거리 3. 생성 순서도 이 순서.
//   14분 이후 대포 웨이브는 근접 2, 30분 이후는 원거리 2.
// - 대포 웨이브: 3번째 웨이브부터. 마지막 대포 웨이브 이후 15분 전 3번째, 15분부터 2번째, 25분부터 매 웨이브.
// - 생성: 진영 시작 지점에서 맨 앞 순서 미니언부터 한 마리씩 (spawnInterval 간격)
// - 업그레이드: 첫 웨이브 = 1회, 이후 90초마다 +1. 생성될 때의 횟수로 능력치를 정하고, 살아 있는 동안 그대로.
//   v(n) = base + early × min(n, 5) + late × max(0, n − 5)  (max를 넘지 않음)
// - 이동: 라인을 따라 상대 진영 끝까지 일직선으로 가서 멈춘다.
//   항상 유체화 상태라 챔피언·미니언과는 서로 통과하고, 포탑 지형·벽에만 막힌다.
//
// 아직 없는 것: 공격·대상 선택(M2), 포탑과의 관계(M3), 첫 웨이브 특수 동작·골드/경험치(M4),
// 이동속도 상승·어그로(나중에 구현할 것: docs/ROADMAP.md)
//
// minion은 update에서 복사한 객체라 직접 바꿔도 된다.
import { laneToWorld } from './map.js';
import { SPAWN_INSET } from './constants.js';
import { setMoveTarget } from './movement.js';

const EPSILON = 1e-6;

// 미니언 데이터 (숫자 조정은 여기서)
// 능력치 { base, early, late, max }: early는 업그레이드 1~5회, late는 6회부터의 업그레이드당 증가량
export const MINIONS = {
  melee: {
    name: '근접 미니언',
    hp: { base: 430, early: 35, late: 35, max: 1550 },
    attackDamage: { base: 11, early: 0, late: 3, max: 80 },
    attackSpeed: 1.25,
    range: 110,
    armor: 0,
    magicResist: 0,
    gameplayRadius: 48,
    pathingRadius: 35.7437,
    gold: { base: 20, perUpgrade: 0 },
    xp: 62,
    minionBonusDamage: 0.02, // 미니언끼리 추가 피해 (대상 현재 체력 비율) — M2
    turretDamage: 0.45, // 포탑에게 받는 피해 (최대 체력 비율) — M3
  },
  caster: {
    name: '원거리 미니언',
    hp: { base: 275, early: 9, late: 12, max: 600 },
    attackDamage: { base: 19.5, early: 1.5, late: 4.25, max: 125 },
    attackSpeed: 0.667,
    range: 550,
    armor: 0,
    magicResist: 0,
    gameplayRadius: 48,
    pathingRadius: 35.7437,
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
    range: 300,
    armor: 0,
    magicResist: 0,
    gameplayRadius: 50,
    pathingRadius: 35.7437,
    gold: { base: 50, perUpgrade: 1 }, // 첫 웨이브 50, 이후 업그레이드마다 +1
    xp: 75,
    minionBonusDamage: 0.05,
    turretDamage: 0.14,
  },
};

export const MINION_TYPES = Object.keys(MINIONS);

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
    selectionRadius: data.gameplayRadius,
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
    target: null,
    casting: null,
    effects: [],
    marks: [],
    ghosted: true, // 항상 유체화: 챔피언·미니언과 서로 통과 (포탑 지형·벽에는 막힘)
    targetable: true,
    invulnerable: false,
  };
  // 목적지: 상대 진영 라인 끝 (도착하면 멈춘다)
  const end = laneToWorld(map, team === 'blue' ? L : 0, 0);
  setMoveTarget(m, end.x, end.y, map);
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
