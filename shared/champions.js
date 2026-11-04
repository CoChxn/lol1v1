// 챔피언 데이터. 능력치와 스킬은 모두 여기서 정의한다.
// 거리: 월드 픽셀, 시간: 초, 공격속도: 초당 공격 횟수.

export const CHAMPIONS = {
  ranger: {
    name: 'Ranger',
    radius: 30,
    maxHp: 600,
    maxMana: 300,
    moveSpeed: 330,

    // 기본 공격(평타)
    attack: {
      range: 550, // 내 가장자리 ~ 대상 가장자리 거리
      damage: 50,
      attackSpeed: 0.625, // 초당 공격 횟수 → 1.6초에 한 번
      windupRatio: 0.2, // 공격 주기 중 발사 전 준비 동작 비율 (0.32초)
      projectileSpeed: 1500,
      projectileRadius: 8,
    },

    // 스킬 Q/W/E/R은 3-3에서 추가
  },
};

export const DEFAULT_CHAMPION = 'ranger';

export function getChampion(id) {
  const champ = CHAMPIONS[id];
  if (!champ) throw new Error(`Unknown champion: ${id}`);
  return champ;
}
