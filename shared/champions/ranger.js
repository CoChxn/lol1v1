// 챔피언 데이터: Ranger (원거리)
// 이 파일은 숫자만 담는다. 항목 설명·단위·공식은 docs/CHAMPION_STATS.md 참고.
// 수정 후 루트에서 `npm run check`로 검사한다.
// [개발 세션 규칙] 새 항목은 맨 끝에만 추가하고, 기존 줄은 고치거나 순서를 바꾸지 않는다.

export default {
  name: 'Ranger',

  // 크기
  gameplayRadius: 65,
  pathingRadius: 35,

  // 기본 능력치
  maxHp: 600,
  maxMana: 375,
  moveSpeed: 325,

  // 기본 공격(평타)
  attack: {
    range: 550,
    damage: 60,
    attackSpeed: 0.625,
    windupRatio: 0.2,
    projectileSpeed: 2000,
    projectileRadius: 8,
  },

  // 클릭 선택 반경
  selectionRadius: 75,

  // 방어·치명타
  armor: 24,
  critChance: 0,
  critDamage: 2,

  // 스킬 (레벨별 값은 [1레벨, 2레벨, 3레벨, 4레벨, 5레벨])
  skills: {
    // Q 비전 화살: 방향 지정 + 일반 발동 + 투사체(처음 맞은 적) → 물리 피해, 적중 시 모든 스킬 쿨타임 감소
    Q: {
      name: '비전 화살',
      manaCost: [28, 31, 34, 37, 40],
      cooldown: [5.5, 5.25, 5, 4.75, 4.5],
      targeting: {
        type: 'direction',
        range: 1150,
        outOfRange: 'maxRange',
      },
      activation: { type: 'normal', castTime: 0.25 },
      effects: [
        {
          type: 'projectile',
          speed: 2000,
          radius: 30,
          collision: 'first',
          onHit: [
            { type: 'damage', damageType: 'physical', base: [20, 45, 70, 95, 120], adRatio: 1.3, apRatio: 0.4 },
            { type: 'reduceCooldowns', amount: 1.5 },
          ],
        },
      ],
    },
  },
};
