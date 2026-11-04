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
};
