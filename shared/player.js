// 플레이어 데이터 생성. 능력치는 챔피언 데이터에서 가져온다.
import { getChampion, DEFAULT_CHAMPION } from './champions/index.js';

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.name   닉네임
 * @param {'blue'|'red'} opts.team
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {string} [opts.championId]
 * @param {boolean} [opts.isDummy]  연습용 허수아비 여부
 */
export function createPlayer({ id, name, team, x, y, championId = DEFAULT_CHAMPION, isDummy = false }) {
  const champ = getChampion(championId);
  return {
    id,
    name,
    team,
    championId,
    x,
    y,
    gameplayRadius: champ.gameplayRadius,
    pathingRadius: champ.pathingRadius,
    selectionRadius: champ.selectionRadius,
    baseMoveSpeed: champ.moveSpeed, // 기본 이동속도 (B)
    moveSpeed: champ.moveSpeed, // 최종 이동속도. 매 틱 효과를 반영해 다시 계산한다
    slowResist: 0, // 둔화 저항 (R, 0~1)
    effects: [], // 지속 효과 목록 (effects.js)
    hp: champ.maxHp,
    maxHp: champ.maxHp,
    mana: champ.maxMana,
    maxMana: champ.maxMana,
    // 이동 목표 지점. null이면 정지.
    target: null,
    // 평타 상태
    attackState: 'idle', // 'idle' | 'chase' | 'windup' | 'cooldown'
    attackTargetId: null, // 평타 명령 대상 ID (추적·반복 공격)
    attackMoveTarget: null, // 어택땅 목적지 {x, y}. 이동하면서 사거리 안의 적을 찾는다
    attackWindupTargetId: null, // 지금 선딜레이 중인 평타의 대상 ID
    attackSpeed: champ.attack.attackSpeed, // 총 공격속도. 매 틱 효과를 반영해 다시 계산한다
    attackTimer: 0, // 공격 타이머 남은 시간(초). 0이면 새 평타 가능
    attackTimerTotal: 0, // 이번 공격 타이머 전체 길이 T (표시용)
    attackWindup: null, // 선딜레이 남은 시간(초). null이면 선딜레이 중 아님
    attackWindupTotal: 0, // 이번 선딜레이 전체 길이 W (표시용)
    commandLockTicks: 0, // 남은 명령 잠금 틱 수. 0보다 크면 새 명령을 다음 틱으로 미룬다 (발사 직후 1틱)
    targetable: true, // false면 평타·스킬의 대상이 될 수 없다
    // 유체화: true면 다른 캐릭터와의 이동 충돌을 무시한다
    ghosted: false,
    isDummy,
  };
}
