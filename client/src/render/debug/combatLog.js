// [개발자 모드] 전투 기록: 최근 데미지 이벤트를 모아 둔다.
const MAX_ENTRIES = 10;

export function createCombatLog() {
  const entries = [];

  return {
    /** 이번 틱 이벤트를 기록한다. state는 이벤트가 일어난 직후 상태 */
    add(event, state) {
      if (event.type !== 'damage') return;
      const unit = (id) => state.players[id] ?? state.turrets?.[id] ?? state.minions?.[id];
      // 챔피언이 끼지 않은 피해(미니언끼리 등)는 기록하지 않는다 (너무 많아서)
      if (!state.players[event.targetId] && !state.players[event.sourceId]) return;
      const target = unit(event.targetId);
      const source = event.sourceId ? unit(event.sourceId) : null;
      entries.unshift({
        time: state.time,
        source: source?.name ?? '?',
        target: target?.name ?? '?',
        raw: event.raw,
        damageType: event.damageType,
        label: event.turret ? '포탑' : event.minion ? '미니언' : event.mark ? `${event.skill} 표식` : event.skill ?? '평타',
        resist: event.damageType === 'magic' ? `MR ${target?.magicResist ?? 0}` : event.damageType === 'physical' ? `armor ${target?.armor ?? 0}${event.turret ? ' 관통 30%' : ''}` : '고정',
        blocked: !!target?.invulnerable,
        armor: target?.armor ?? 0,
        amount: event.amount,
        crit: event.crit,
      });
      if (entries.length > MAX_ENTRIES) entries.pop();
    },
    entries: () => entries,
  };
}
