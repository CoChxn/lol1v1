// 명령 처리와 선입력(버퍼).
// "지금은 못 하지만, 가능해지는 순간 바로 실행"을 플레이어마다 슬롯 하나(queuedCommand)로 처리한다.
// - 새 명령이 바로 실행 가능하면 실행하고 슬롯을 비운다 (마지막 입력이 이긴다)
// - 지금 못 하지만 선입력이 허용되면 슬롯에 저장한다 (기존 선입력은 덮어쓴다)
// - 선입력도 안 되면 버린다
//
// 선입력이 되는 경우:
// 1) 쿨타임 선입력: 스킬 쿨타임이 queueTime 이하로 남았을 때 시전 시도
// 2) 시전 중 선입력: 스킬 시전 시간 중의 이동·평타·어택땅·스킬 (시전 중인 스킬의 activation.castBuffer가 'deny'면 버림)
// 3) 평타 발사 직후 1틱(commandLockTicks)의 명령
// 정지(stop)와 테스트 입력(debug)은 저장하지 않고 항상 바로 처리한다. 정지는 저장된 선입력도 지운다.
//
// player는 update에서 복사한 객체라 직접 바꿔도 된다.
import { setMoveTarget } from './movement.js';
import { orderAttack, orderAttackMove, orderStop, cancelAttack } from './attack.js';
import { orderCast, getSkillData } from './skills.js';
import { applyDebugInput } from './debug.js';

const EPSILON = 1e-6;

/** 명령 하나 실행 */
function execute(players, player, cmd, map) {
  if (cmd.type === 'move') {
    cancelAttack(player);
    setMoveTarget(player, cmd.x, cmd.y, map);
  } else if (cmd.type === 'attack') {
    orderAttack(player, players[cmd.targetId]);
  } else if (cmd.type === 'attackMove') {
    orderAttackMove(player, players, cmd.x, cmd.y, map);
  } else if (cmd.type === 'cast') {
    orderCast(player, cmd.skill, cmd.x, cmd.y);
  }
}

/**
 * 명령을 지금 어떻게 처리할지
 * @returns {'now' | 'queue' | 'drop'}
 */
function classify(player, cmd) {
  // 평타 발사 직후 1틱
  if (player.commandLockTicks > 0) return 'queue';

  // 스킬 시전 시간 중
  if (player.casting) {
    const castingData = getSkillData(player, player.casting.skill);
    return castingData?.activation.castBuffer === 'deny' ? 'drop' : 'queue';
  }

  // 쿨타임 선입력
  if (cmd.type === 'cast') {
    const st = player.skills[cmd.skill];
    const data = getSkillData(player, cmd.skill);
    if (st && data && st.cooldown > EPSILON) {
      return st.cooldown <= (data.queueTime ?? 0) + EPSILON ? 'queue' : 'drop';
    }
  }
  // 그 밖에는 바로 실행 (마나 부족 등으로 시전이 안 되면 그냥 아무 일도 일어나지 않는다)
  return 'now';
}

/** 새로 들어온 명령 처리 */
export function submitCommand(players, player, cmd, map) {
  if (cmd.type === 'debug') {
    applyDebugInput(players, player, cmd, map);
    return;
  }
  if (cmd.type === 'stop') {
    // 정지는 저장하지 않고 바로: 저장된 선입력과 이동·평타 명령을 모두 지운다
    player.queuedCommand = null;
    orderStop(player);
    return;
  }
  const how = classify(player, cmd);
  if (how === 'now') {
    player.queuedCommand = null;
    execute(players, player, cmd, map);
  } else if (how === 'queue') {
    player.queuedCommand = cmd;
  }
}

/** 저장된 선입력이 이제 실행 가능하면 실행한다 (매 틱 입력 처리 전, 그리고 시전이 끝난 직후) */
export function runQueuedCommand(players, player, map) {
  const cmd = player.queuedCommand;
  if (!cmd) return;
  const how = classify(player, cmd);
  if (how === 'queue') return;
  player.queuedCommand = null;
  if (how === 'now') execute(players, player, cmd, map);
}
