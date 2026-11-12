// 명령 처리와 선입력(버퍼). "지금은 못 하지만, 가능해지는 순간 바로 실행"
//
// 선입력은 두 종류로 따로 보관한다 (docs/SKILL_DESIGN.md 5번).
// ① 행동 불가 중 선입력: queuedCommand (슬롯 하나, 마지막 입력이 이긴다)
//    - 언제: 스킬 시전 시간 중, 평타 발사 직후 1틱(commandLockTicks)
//    - 무엇이든(이동·평타·어택땅·스킬) 저장하고, 새 입력이 오면 덮어쓴다
//    - 시전 중인 스킬의 activation.castBuffer가 'deny'면 저장하지 않고 버린다
//    - 행동 불가가 끝나는 틱에 꺼내서 일반 입력처럼 다시 처리한다
// ② 쿨타임 선입력: queuedCasts (스킬별로 따로, { Q: { x, y }, ... })
//    - 언제: 쿨타임이 그 스킬의 queueTime 이하로 남았을 때 시전 시도
//    - 이동·평타·어택땅 명령으로는 지워지지 않는다
//    - 취소: 스킬이 실제로 시전될 때(다른 쿨타임 선입력 모두 취소), 정지(S)
//    - 쿨타임이 끝나는 틱에 시전 (행동 불가 중이면 그것이 끝난 뒤). 둘 이상이면 먼저 준비된 것부터
// 정지(stop)와 테스트 입력(debug)은 저장하지 않고 항상 바로 처리한다. 정지는 ①② 모두 지운다.
// 소환사 주문(summoner, 예: 점멸)도 저장하지 않고 항상 바로 처리한다 (summoners.js).
// 실행하는 순간 마나가 부족하면 시전 조건에서 막혀 아무 일도 일어나지 않는다 (버린 것과 같음).
//
// player는 update에서 복사한 객체라 직접 바꿔도 된다.
import { setMoveTarget } from './movement.js';
import { orderAttack, orderAttackMove, orderStop, cancelAttack } from './attack.js';
import { orderCast, getSkillData, SKILL_KEYS } from './skills.js';
import { applyDebugInput } from './debug.js';
import { orderSummoner } from './summoners.js';

const EPSILON = 1e-6;

/** 행동 불가 중인지 (명령을 바로 실행할 수 없는 상태) */
function isLockedOut(player) {
  return player.commandLockTicks > 0 || !!player.casting;
}

/** 명령 하나 실행 */
// units: 평타 대상 후보 (챔피언 + 포탑). 없으면 players
function execute(players, player, cmd, map, units = players) {
  if (cmd.type === 'move') {
    cancelAttack(player);
    setMoveTarget(player, cmd.x, cmd.y, map);
  } else if (cmd.type === 'attack') {
    orderAttack(player, units[cmd.targetId]);
  } else if (cmd.type === 'attackMove') {
    orderAttackMove(player, units, cmd.x, cmd.y, map);
  } else if (cmd.type === 'cast') {
    orderCast(player, cmd.skill, cmd.x, cmd.y);
    // 스킬이 실제로 시전되면 쿨타임 선입력은 모두 취소된다
    if (player.casting) player.queuedCasts = {};
  }
}

/** 행동 불가가 아닐 때의 명령 처리: 바로 실행, 쿨타임 선입력, 또는 버림 */
function handle(players, player, cmd, map, units) {
  if (cmd.type === 'cast') {
    const st = player.skills[cmd.skill];
    const data = getSkillData(player, cmd.skill);
    if (st && data && st.cooldown > EPSILON) {
      // 쿨타임 중: 허용 시간 안이면 스킬별로 저장, 아니면 버림
      if (st.cooldown <= (data.queueTime ?? 0) + EPSILON) {
        player.queuedCasts = { ...player.queuedCasts, [cmd.skill]: { x: cmd.x, y: cmd.y } };
      }
      return;
    }
  }
  execute(players, player, cmd, map, units);
}

/** 새로 들어온 명령 처리 */
// bodies: 몸 충돌 대상 (챔피언 + 미니언). 점멸·순간이동 뒤 겹침을 밀어낼 때 쓴다. 없으면 players
export function submitCommand(players, player, cmd, map, ctx, units = players, bodies = players) {
  if (cmd.type === 'summoner') {
    // 소환사 주문(점멸 등)은 시전 시간이 없어 행동 불가 중에도 바로 쓴다 (진행 중인 스킬 시전은 끊지 않음)
    orderSummoner(player, bodies, cmd.slot, cmd.x, cmd.y, map, ctx);
    return;
  }
  if (cmd.type === 'debug') {
    applyDebugInput(players, player, cmd, map, bodies);
    return;
  }
  if (cmd.type === 'stop') {
    // 정지는 저장하지 않고 바로: 모든 선입력과 이동·평타 명령을 지운다
    player.queuedCommand = null;
    player.queuedCasts = {};
    orderStop(player);
    return;
  }
  if (isLockedOut(player)) {
    // ① 행동 불가 중: 슬롯 하나에 저장 (마지막 입력이 이긴다). 시전 중인 스킬이 'deny'면 버림
    const castingData = player.casting && getSkillData(player, player.casting.skill);
    if (castingData?.activation.castBuffer !== 'deny') player.queuedCommand = cmd;
    return;
  }
  player.queuedCommand = null;
  handle(players, player, cmd, map, units);
}

/** 저장된 선입력 중 이제 실행 가능한 것을 실행한다 (매 틱 입력 처리 전, 그리고 시전이 끝난 직후) */
export function runQueuedCommands(players, player, map, units = players) {
  if (isLockedOut(player)) return;

  // ① 행동 불가 중 선입력: 일반 입력처럼 다시 처리 (쿨타임 중인 스킬이면 쿨타임 선입력으로 옮겨질 수 있다)
  if (player.queuedCommand) {
    const cmd = player.queuedCommand;
    player.queuedCommand = null;
    handle(players, player, cmd, map, units);
    if (isLockedOut(player)) return;
  }

  // ② 쿨타임 선입력: 쿨타임이 끝난 스킬부터 시전 (시전되면 나머지는 취소된다)
  for (const key of SKILL_KEYS) {
    const q = player.queuedCasts[key];
    if (!q || player.skills[key]?.cooldown > EPSILON) continue;
    const { [key]: _, ...rest } = player.queuedCasts;
    player.queuedCasts = rest;
    execute(players, player, { type: 'cast', skill: key, x: q.x, y: q.y }, map, units);
    if (player.casting) return;
  }
}
