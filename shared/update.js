// 게임 로직 한 틱. 순수 함수: 입력 상태를 바꾸지 않고 새 상태를 돌려준다.
import { setMoveTarget, movePlayer, computeMoveSpeed } from './movement.js';
import { addEffect, tickEffects } from './effects.js';
import { applyDamage, spendMana, restoreFull } from './combat.js';
import {
  orderAttack,
  orderAttackMove,
  orderStop,
  cancelAttack,
  updateAttack,
  updateAttackMove,
  updateProjectile,
  computeAttackSpeed,
} from './attack.js';

/**
 * @param {object} state  현재 게임 상태
 * @param {Array<object>} inputs  이번 틱에 처리할 입력 목록
 *   - { playerId, type: 'move', x, y }
 *   - { playerId, type: 'attack', targetId }
 *   - { playerId, type: 'attackMove', x, y }  어택땅
 *   - { playerId, type: 'stop' }  정지
 * @param {number} dt  흐른 시간(초)
 * @returns {object} 다음 게임 상태
 */
export function update(state, inputs, dt) {
  // 원본을 바꾸지 않도록 복사해서 작업한다.
  const players = {};
  for (const id in state.players) {
    players[id] = { ...state.players[id] };
  }
  let projectiles = state.projectiles.map((p) => ({ ...p }));
  let nextId = state.nextId;
  // 발사 직후라 처리하지 못하고 미뤄 둔 명령을 먼저 처리한다
  const allInputs = [...state.deferredInputs, ...inputs];
  const deferredInputs = [];

  // 0. 지속 효과 시간 감소
  for (const id in players) {
    tickEffects(players[id], dt);
  }

  // 1. 입력 처리
  for (const input of allInputs) {
    const player = players[input.playerId];
    if (!player) continue;

    // 발사 직후 1틱은 새 명령을 받지 않고 다음 틱으로 미룬다 (테스트용 입력은 제외)
    if (player.commandLockTicks > 0 && input.type !== 'debug') {
      deferredInputs.push(input);
      continue;
    }

    if (input.type === 'move') {
      cancelAttack(player);
      setMoveTarget(player, input.x, input.y, state.map);
    } else if (input.type === 'attack') {
      orderAttack(player, players[input.targetId]);
    } else if (input.type === 'attackMove') {
      orderAttackMove(player, players, input.x, input.y, state.map);
    } else if (input.type === 'stop') {
      orderStop(player);
    } else if (input.type === 'debug') {
      applyDebugInput(players, player, input.action);
    }
  }

  for (const id in players) {
    if (players[id].commandLockTicks > 0) players[id].commandLockTicks--;
  }

  // 최종 이동속도·총 공격속도 계산 (이번 틱 이동·평타에 사용)
  for (const id in players) {
    players[id].moveSpeed = computeMoveSpeed(players[id]);
    players[id].attackSpeed = computeAttackSpeed(players[id]);
  }

  // 2. 평타 진행 (어택땅 대상 찾기, 추적 이동 목표 설정, 발사)
  for (const id in players) {
    updateAttackMove(players[id], players, state.map);
    const shot = updateAttack(players[id], players, state.map, dt);
    if (shot) projectiles.push({ id: nextId++, ...shot });
  }

  // 3. 이동
  for (const id in players) {
    movePlayer(players[id], players, dt, state.map);
  }

  // 4. 투사체 이동·적중
  projectiles = projectiles.filter((proj) => updateProjectile(proj, players, dt));

  return {
    ...state,
    time: state.time + dt,
    tick: state.tick + 1,
    players,
    projectiles,
    nextId,
    deferredInputs,
  };
}

// 테스트용 입력 (Phase 4에서 서버는 개발 모드일 때만 허용한다)
function applyDebugInput(players, player, action) {
  if (action === 'damage') applyDamage(player, 100);
  else if (action === 'spendMana') spendMana(player, 50);
  else if (action === 'slow') addEffect(player, { kind: 'slow', value: 0.4, duration: 3 });
  else if (action === 'haste') addEffect(player, { kind: 'percent', value: 0.5, duration: 3 });
  else if (action === 'attackSpeed') addEffect(player, { kind: 'attackSpeed', value: 1, duration: 3 });
  else if (action === 'restore') {
    for (const id in players) restoreFull(players[id]);
  }
}
