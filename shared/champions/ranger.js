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
    // Q 비전 화살: 직선 투사체. 처음 맞은 적에게 물리 피해, 적중 시 모든 스킬 쿨타임 감소
    Q: {
      name: '비전 화살',
      type: 'linearProjectile',
      range: 1150,
      projectileSpeed: 2000,
      projectileRadius: 30,
      castTime: 0.25,
      manaCost: [28, 31, 34, 37, 40],
      cooldown: [5.5, 5.25, 5, 4.75, 4.5],
      damage: [20, 45, 70, 95, 120],
      adRatio: 1.3,
      apRatio: 0.4,
      damageType: 'physical',
      onHitCooldownReduction: 1.5,
    },
  },
};
