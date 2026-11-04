// 플레이어 데이터 생성. 능력치는 챔피언 데이터에서 가져온다.
import { getChampion, DEFAULT_CHAMPION } from './champions.js';

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
    attackTargetId: null, // 공격 대상 ID
    attackCooldown: 0, // 다음 공격까지 남은 시간(초)
    attackWindup: null, // 발사까지 남은 준비 시간(초). null이면 준비 중 아님
    // 유체화: true면 다른 캐릭터와의 이동 충돌을 무시한다
    ghosted: false,
    isDummy,
  };
}
