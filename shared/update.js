// 게임 로직 한 틱. 순수 함수: 입력 상태를 바꾸지 않고 새 상태를 돌려준다.
import { movePlayer, computeMoveSpeed } from './movement.js';
import { tickEffects } from './effects.js';
import { dummyInputs } from './dummyAI.js';
import { tickSkillCooldowns, updateCasting, updateSkillshot, updateHomingSkill } from './skills.js';
import { tickMarks } from './marks.js';
import { tickPassive } from './passive.js';
import { submitCommand, runQueuedCommands } from './commands.js';
import { tickSummonerCooldowns } from './summoners.js';
import { updateAttack, updateAttackMove, updateProjectile, computeAttackSpeed } from './attack.js';
import { tickTurret, updateTurret, updateTurretShot, checkTurretDestroyed } from './turret.js';
import { updateWaves, createMinion, queueWave, waveStateAt, updateMinion, updateMinionShot, updateRecentHits } from './minions.js';

// 게임 전체에 적용되는 개발자 입력: { type: 'debug', action, value? }
//   skipTime: value초만큼 게임 시간 건너뛰기 / setMinionSpawning: 웨이브 생성 켜기·끄기
//   spawnWave: 지금 웨이브 하나 생성 (cannon: 대포 포함) / clearMinions: 미니언 모두 제거
export const WORLD_DEBUG = ['skipTime', 'setMinionSpawning', 'spawnWave', 'clearMinions'];

/**
 * @param {object} state  현재 게임 상태
 * @param {Array<object>} inputs  이번 틱에 처리할 입력 목록
 *   - { playerId, type: 'move', x, y }
 *   - { playerId, type: 'attack', targetId }
 *   - { playerId, type: 'attackMove', x, y }  어택땅
 *   - { playerId, type: 'stop' }  정지
 *   - { playerId, type: 'cast', skill: 'Q', x, y }  스킬 시전 (x, y: 방향을 정하는 지점)
 *   - { playerId, type: 'summoner', slot: 'F', x, y }  소환사 주문 (점멸 등)
 * @param {number} dt  흐른 시간(초)
 * @returns {object} 다음 게임 상태
 */
export function update(state, inputs, dt) {
  // 원본을 바꾸지 않도록 복사해서 작업한다.
  const players = {};
  for (const id in state.players) {
    const p = state.players[id];
    // 안쪽 객체(스킬 상태, 시전 정보)도 복사해서 원본을 바꾸지 않는다
    const skills = {};
    for (const key in p.skills) skills[key] = { ...p.skills[key] };
    const summoners = {};
    for (const slot in p.summoners) summoners[slot] = { ...p.summoners[slot] };
    players[id] = { ...p, skills, summoners, casting: p.casting && { ...p.casting }, marks: p.marks.map((m) => ({ ...m })), passive: { ...p.passive } };
  }
  // 게임 전체에 적용되는 개발자 입력 (시간 건너뛰기, 미니언 생성 켜기/끄기 등)
  let time = state.time;
  let waves = { ...state.waves ?? { enabled: false, nextWaveTime: Infinity, waveCount: 0, sinceCannon: 0, queue: [] } };
  let minionsIn = state.minions ?? {};
  const worldInputs = inputs.filter((i) => i.type === 'debug' && WORLD_DEBUG.includes(i.action));
  for (const i of worldInputs) {
    if (i.action === 'skipTime' && i.value > 0) {
      time += i.value;
      waves = { ...waveStateAt(time, waves.enabled), queue: [] };
    } else if (i.action === 'setMinionSpawning') {
      // 다시 켤 때 그동안의 일정을 지금 시각에 맞춘다 (이미 대기 중인 미니언은 그대로)
      waves = { ...waveStateAt(time, !!i.value), queue: waves.queue };
    } else if (i.action === 'spawnWave') {
      queueWave(waves, time, !!i.cannon, waves.waveCount);
    } else if (i.action === 'clearMinions') {
      minionsIn = {};
      waves.queue = [];
    }
  }
  inputs = inputs.filter((i) => !worldInputs.includes(i));

  const minions = {};
  for (const id in minionsIn) minions[id] = { ...minionsIn[id], marks: minionsIn[id].marks.map((mk) => ({ ...mk })) };
  const turrets = {};
  for (const id in state.turrets ?? {}) turrets[id] = { ...state.turrets[id] };
  // 대상 후보 (같은 객체를 가리킨다)
  // - units: 평타·미니언의 대상 (챔피언 + 포탑 + 미니언)
  // - skillUnits: 스킬의 대상 (챔피언 + 미니언). 포탑은 스킬에 맞지 않는다
  // - turretUnits: 포탑의 대상 (챔피언). 포탑과 미니언의 관계는 M3에서
  const units = { ...players, ...turrets, ...minions };
  const skillUnits = { ...players, ...minions };
  const turretUnits = { ...players, ...turrets };
  const recentHits = state.recentHits ?? [];
  let projectiles = state.projectiles.map((p) => ({ ...p }));
  let nextId = state.nextId;
  // 허수아비 행동(개발자 모드)이 만든 입력도 일반 입력과 똑같이 처리한다
  const allInputs = [...inputs, ...dummyInputs(players, state.map)];
  // 난수·이벤트 (난수 시드는 다음 상태로 이어진다)
  const ctx = { rng: { seed: state.rngSeed }, events: [] };

  // 0. 지속 효과·스킬 쿨타임·표식·패시브 시간 감소
  for (const id in players) {
    tickEffects(players[id], dt);
    tickSkillCooldowns(players[id], dt);
    tickSummonerCooldowns(players[id], dt);
    tickMarks(players[id], dt);
    tickPassive(players[id], dt);
    if (players[id].revealed > 0) players[id].revealed = Math.max(0, players[id].revealed - dt);
  }
  for (const id in turrets) tickTurret(turrets[id], time + dt, dt);

  // 0-1. 미니언 웨이브: 일정에 맞춰 한 마리씩 생성
  for (const spec of updateWaves(waves, time + dt, state.map)) {
    const m = createMinion({ id: `minion-${nextId++}`, ...spec });
    minions[m.id] = m;
    units[m.id] = m;
    skillUnits[m.id] = m;
  }

  // 1. 선입력 → 새 입력 처리 (commands.js: 행동 불가 중 선입력 / 쿨타임 선입력)
  for (const id in players) {
    runQueuedCommands(players, players[id], state.map, units);
  }
  for (const input of allInputs) {
    const player = players[input.playerId];
    if (player) submitCommand(players, player, input, state.map, ctx, units);
  }

  for (const id in players) {
    if (players[id].commandLockTicks > 0) players[id].commandLockTicks--;
  }

  // 최종 이동속도·총 공격속도 계산 (이번 틱 이동·평타에 사용)
  for (const id in players) {
    players[id].moveSpeed = computeMoveSpeed(players[id]);
    players[id].attackSpeed = computeAttackSpeed(players[id]);
  }

  // 2. 스킬 시전 진행 (시전 시간이 끝나면 발동하고, 그 틱에 바로 시전 중 선입력을 실행)
  for (const id in players) {
    const wasCasting = !!players[id].casting;
    for (const shot of updateCasting(players[id], dt, skillUnits, state.map)) projectiles.push({ id: nextId++, ...shot });
    if (wasCasting && !players[id].casting) runQueuedCommands(players, players[id], state.map, units);
  }

  // 2-1. 평타 진행 (어택땅 대상 찾기, 추적 이동 목표 설정, 발사)
  for (const id in players) {
    updateAttackMove(players[id], units, state.map);
    const shot = updateAttack(players[id], units, state.map, dt, ctx);
    if (shot) projectiles.push({ id: nextId++, ...shot });
  }

  // 2-2. 미니언: 대상 선택, 추적, 공격
  for (const id in minions) {
    const shot = updateMinion(minions[id], units, recentHits, state.map, dt, ctx);
    if (shot) projectiles.push({ id: nextId++, ...shot });
  }

  // 3. 이동 (챔피언끼리는 몸으로 막는다. 미니언은 항상 유체화)
  const bodies = { ...players, ...minions };
  for (const id in players) {
    movePlayer(players[id], bodies, dt, state.map);
  }
  for (const id in minions) {
    movePlayer(minions[id], bodies, dt, state.map);
  }

  // 4. 투사체 이동·적중
  projectiles = projectiles.filter((proj) => {
    if (proj.kind === 'skillshot') return updateSkillshot(proj, skillUnits, dt, ctx);
    if (proj.kind === 'homingSkill') return updateHomingSkill(proj, skillUnits, dt, ctx);
    if (proj.kind === 'turret') return updateTurretShot(proj, units, dt, ctx);
    if (proj.kind === 'minion') return updateMinionShot(proj, units, dt, ctx);
    return updateProjectile(proj, units, dt, ctx);
  });

  // 4-1. 체력이 0이 된 미니언은 사라진다 (막타: 이번 틱 마지막으로 피해를 준 유닛)
  for (const id in minions) {
    if (minions[id].hp > 0) continue;
    const last = ctx.events.filter((ev) => ev.type === 'damage' && ev.targetId === id && ev.amount > 0).pop();
    ctx.events.push({ type: 'minionDeath', minionId: id, team: minions[id].team, minionType: minions[id].minionType, killerId: last?.sourceId ?? null });
    delete minions[id];
    delete units[id];
  }

  // 5. 포탑: 파괴 확인 → 대상 선택(이번 틱 피해로 어그로 전환) → 포착 → 선딜레이 → 발사 (투사체는 다음 틱부터 움직인다)
  for (const id in turrets) checkTurretDestroyed(turrets[id], ctx);
  for (const id in turrets) {
    const shot = updateTurret(turrets[id], turretUnits, ctx.events, dt);
    if (shot) projectiles.push({ id: nextId++, ...shot });
  }

  return {
    ...state,
    time: time + dt,
    tick: state.tick + 1,
    players,
    turrets,
    minions,
    waves,
    recentHits: updateRecentHits(recentHits, ctx.events, time + dt),
    projectiles,
    nextId,
    rngSeed: ctx.rng.seed,
    events: ctx.events,
  };
}
