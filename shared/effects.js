// 지속 효과(버프·디버프). 이동속도 효과 종류:
// - flat:    고정 증가량 (F)        예: { kind: 'flat', value: 25 }
// - percent: 퍼센트 증가 (P, 합산)  예: { kind: 'percent', value: 0.5 }  → +50%
// - mult:    곱연산 증가 (M, 곱셈)  예: { kind: 'mult', value: 0.1 }     → ×1.1
// - slow:    둔화 (S, 가장 강한 것 하나만) 예: { kind: 'slow', value: 0.4 } → 40% 둔화
// player는 update에서 복사한 객체라 직접 바꿔도 된다. (effects 배열은 새로 만들어 교체한다)

/** 효과 추가. duration은 초. */
export function addEffect(player, { kind, value, duration }) {
  player.effects = [...player.effects, { kind, value, remaining: duration }];
}

// 소수점 오차로 효과가 한 틱 더 남는 것을 막기 위한 여유값
const EPSILON = 1e-6;

/** 남은 시간을 줄이고 끝난 효과를 지운다. */
export function tickEffects(player, dt) {
  if (player.effects.length === 0) return;
  player.effects = player.effects
    .map((e) => ({ ...e, remaining: e.remaining - dt }))
    .filter((e) => e.remaining > EPSILON);
}
