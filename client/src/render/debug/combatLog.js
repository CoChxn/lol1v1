// [개발자 모드] 전투 기록: 최근 데미지 이벤트를 모아 둔다.
import { armorMultiplier } from '@lol1v1/shared';

const MAX_ENTRIES = 10;

export function createCombatLog() {
  const entries = [];

  return {
    /** 이번 틱 이벤트를 기록한다. state는 이벤트가 일어난 직후 상태 */
    add(event, state) {
      if (event.type !== 'damage') return;
      const target = state.players[event.targetId];
      const source = event.sourceId ? state.players[event.sourceId] : null;
      const mult = target ? armorMultiplier(target.armor) : 1;
      entries.unshift({
        time: state.time,
        source: source?.name ?? '?',
        target: target?.name ?? '?',
        raw: event.amount / mult,
        armor: target?.armor ?? 0,
        amount: event.amount,
        crit: event.crit,
      });
      if (entries.length > MAX_ENTRIES) entries.pop();
    },
    entries: () => entries,
  };
}
