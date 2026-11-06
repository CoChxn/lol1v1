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
      queueTime: 0.05,
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
    // W 공명 구체: 방향 지정 + 일반 발동 + 투사체(처음 맞은 챔피언) → 표식 4초
    //   표식이 붙은 대상을 시전자의 평타나 다른 스킬로 맞히면 터지면서 마법 피해 + 마나 회복
    W: {
      name: '공명 구체',
      queueTime: 0.5,
      manaCost: [50, 50, 50, 50, 50],
      cooldown: [8, 8, 8, 8, 8],
      targeting: {
        type: 'direction',
        range: 1150,
        outOfRange: 'maxRange',
      },
      activation: { type: 'normal', castTime: 0.25 },
      effects: [
        {
          type: 'projectile',
          speed: 1700,
          radius: 50,
          collision: 'first',
          targets: 'champions',
          shape: 'orb',
          onHit: [
            {
              type: 'applyMark',
              duration: 4,
              onDetonate: [
                { type: 'damage', damageType: 'magic', base: [80, 135, 190, 245, 300], bonusAdRatio: 1, apRatio: 0.9 },
                { type: 'restoreMana', base: 60, plusTriggerCost: true },
              ],
            },
          ],
        },
      ],
    },
    // E 섬광 도약: 위치 지정 + 일반 발동 + 순간이동(최대 475) → 도착 지점 기준 750 안의 적에게 유도 투사체
    //   대상 우선순위: 내 표식이 붙은 적 중 가장 가까운 적 → 없으면 가장 가까운 적. 대상이 없으면 순간이동만
    E: {
      name: '섬광 도약',
      queueTime: 0.5,
      manaCost: [70, 70, 70, 70, 70],
      cooldown: [26, 23, 20, 17, 14],
      targeting: {
        type: 'location',
        range: 475,
        outOfRange: 'maxRange',
      },
      activation: { type: 'normal', castTime: 0.25 },
      effects: [
        { type: 'blink' },
        {
          type: 'homingProjectile',
          speed: 2000,
          acquireRadius: 750,
          priority: 'markedFirst',
          onHit: [
            { type: 'damage', damageType: 'magic', base: [80, 130, 180, 230, 280], bonusAdRatio: 0.5, apRatio: 0.75 },
            { type: 'reveal', duration: 1 },
          ],
        },
      ],
    },
    // R 섬멸 파동: 방향 지정(전 맵) + 일반 발동(시전 1초) + 관통 투사체 → 지나가는 모든 적에게 마법 피해
    //   시전을 시작한 위치에서 발사 (시전 중 밀려도 발사 위치는 그대로). 궁극기라 3레벨까지
    R: {
      name: '섬멸 파동',
      queueTime: 0.5,
      manaCost: [100, 100, 100],
      cooldown: [120, 105, 90],
      targeting: {
        type: 'direction',
        range: 20000,
        outOfRange: 'maxRange',
      },
      activation: { type: 'normal', castTime: 1 },
      effects: [
        {
          type: 'projectile',
          speed: 2000,
          radius: 160,
          collision: 'pierce',
          origin: 'castStart',
          shape: 'wave',
          onHit: [
            { type: 'damage', damageType: 'magic', base: [350, 550, 750], nonChampionBase: [150, 225, 300], bonusAdRatio: 1, apRatio: 1.1 },
          ],
        },
      ],
    },
  },

  // 마법 방어
  magicResist: 33,

  // 패시브 마력 공명: 스킬이 적을 맞힐 때마다(맞은 적 하나당) 1중첩, 중첩당 추가 공격속도 +10%
  //   최대 5중첩, 6초 유지. 새로 쌓이면 모든 중첩이 6초로 다시 시작하고, 끝나면 한꺼번에 사라짐
  passive: {
    name: '마력 공명',
    trigger: 'skillHit',
    maxStacks: 5,
    duration: 6,
    perStack: { kind: 'attackSpeed', value: 0.1 },
  },
};
