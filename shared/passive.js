// 패시브 로직. 챔피언 데이터의 passive 정의를 따른다.
// - trigger 'skillHit': 시전자의 스킬이 적을 맞힐 때 맞은 적 하나당 1중첩 (표식이 터질 때·평타는 제외)
// - 새로 쌓이면 모든 중첩이 duration으로 다시 시작하고, 시간이 끝나면 한꺼번에 사라진다
// - perStack: 중첩당 효과. attackSpeed는 추가 공격속도(공격속도 공식의 x)에 더한다
// player는 update에서 복사한 객체라 직접 바꿔도 된다.
import { getChampion } from './champions/index.js';

const EPSILON = 1e-6;

export function getPassiveData(player) {
  return getChampion(player.championId).passive ?? null;
}

/** 스킬 적중 시 호출 (맞은 적 하나당 한 번) */
export function onSkillHit(owner, target) {
  if (!owner || !target || target.team === owner.team) return;
  const data = getPassiveData(owner);
  if (data?.trigger !== 'skillHit') return;
  owner.passive = {
    stacks: Math.min(owner.passive.stacks + 1, data.maxStacks),
    remaining: data.duration,
  };
}

/** 매 틱 시간 감소, 끝나면 모든 중첩 제거 */
export function tickPassive(player, dt) {
  if (player.passive.stacks <= 0) return;
  const remaining = player.passive.remaining - dt;
  player.passive = remaining > EPSILON ? { ...player.passive, remaining } : { stacks: 0, remaining: 0 };
}

/** 패시브가 주는 보너스 (kind가 맞을 때 중첩 × 값) */
export function passiveBonus(player, kind) {
  const data = getPassiveData(player);
  if (!data || data.perStack.kind !== kind) return 0;
  return player.passive.stacks * data.perStack.value;
}
