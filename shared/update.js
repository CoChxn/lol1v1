// 게임 로직 한 틱. 순수 함수: 입력 상태를 바꾸지 않고 새 상태를 돌려준다.
import { movePlayer, computeMoveSpeed } from './movement.js';
import { tickEffects } from './effects.js';
import { dummyInputs } from './dummyAI.js';
import { tickSkillCooldowns, updateCasting, updateSkillshot, updateHomingSkill } from './skills.js';
import { tickMarks } from './marks.js';
import { submitCommand, runQueuedCommands } from './commands.js';
import { updateAttack, updateAttackMove, updateProjectile, computeAttackSpeed } from './attack.js';

/**
 * @param {object} state  현재 게임 상태
 * @param {Array<object>} inputs  이번 틱에 처리할 입력 목록
 *   - { playerId, type: 'move', x, y }
 *   - { playerId, type: 'attack', targetId }
 *   - { playerId, type: 'attackMove', x, y }  어택땅
 *   - { playerId, type: 'stop' }  정지
 *   - { playerId, type: 'cast', skill: 'Q', x, y }  스킬 시전 (x, y: 방향을 정하는 지점)
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
    players[id] = { ...p, skills, casting: p.casting && { ...p.casting }, marks: p.marks.map((m) => ({ ...m })) };
  }
  let projectiles = state.projectiles.map((p) => ({ ...p }));
  let nextId = state.nextId;
  // 허수아비 행동(개발자 모드)이 만든 입력도 일반 입력과 똑같이 처리한다
  const allInputs = [...inputs, ...dummyInputs(players)];
  // 난수·이벤트 (난수 시드는 다음 상태로 이어진다)
  const ctx = { rng: { seed: state.rngSeed }, events: [] };

  // 0. 지속 효과·스킬 쿨타임·표식 시간 감소
  for (const id in players) {
    tickEffects(players[id], dt);
    tickSkillCooldowns(players[id], dt);
    tickMarks(players[id], dt);
    if (players[id].revealed > 0) players[id].revealed = Math.max(0, players[id].revealed - dt);
  }

  // 1. 선입력 → 새 입력 처리 (commands.js: 행동 불가 중 선입력 / 쿨타임 선입력)
  for (const id in players) {
    runQueuedCommands(players, players[id], state.map);
  }
  for (const input of allInputs) {
    const player = players[input.playerId];
    if (player) submitCommand(players, player, input, state.map);
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
    for (const shot of updateCasting(players[id], dt, players, state.map)) projectiles.push({ id: nextId++, ...shot });
    if (wasCasting && !players[id].casting) runQueuedCommands(players, players[id], state.map);
  }

  // 2-1. 평타 진행 (어택땅 대상 찾기, 추적 이동 목표 설정, 발사)
  for (const id in players) {
    updateAttackMove(players[id], players, state.map);
    const shot = updateAttack(players[id], players, state.map, dt, ctx);
    if (shot) projectiles.push({ id: nextId++, ...shot });
  }

  // 3. 이동
  for (const id in players) {
    movePlayer(players[id], players, dt, state.map);
  }

  // 4. 투사체 이동·적중
  projectiles = projectiles.filter((proj) => {
    if (proj.kind === 'skillshot') return updateSkillshot(proj, players, dt, ctx);
    if (proj.kind === 'homingSkill') return updateHomingSkill(proj, players, dt, ctx);
    return updateProjectile(proj, players, dt, ctx);
  });

  return {
    ...state,
    time: state.time + dt,
    tick: state.tick + 1,
    players,
    projectiles,
    nextId,
    rngSeed: ctx.rng.seed,
    events: ctx.events,
  };
}
