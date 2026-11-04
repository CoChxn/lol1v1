// 플레이어 데이터 생성.
import { PLAYER_RADIUS, DEFAULT_MOVE_SPEED, DEFAULT_MAX_HP, DEFAULT_MAX_MANA } from './constants.js';

/**
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.name   닉네임
 * @param {'blue'|'red'} opts.team
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {boolean} [opts.isDummy]  연습용 허수아비 여부
 */
export function createPlayer({ id, name, team, x, y, isDummy = false }) {
  return {
    id,
    name,
    team,
    x,
    y,
    radius: PLAYER_RADIUS,
    moveSpeed: DEFAULT_MOVE_SPEED,
    hp: DEFAULT_MAX_HP,
    maxHp: DEFAULT_MAX_HP,
    mana: DEFAULT_MAX_MANA,
    maxMana: DEFAULT_MAX_MANA,
    // 이동 목표 지점. null이면 정지.
    target: null,
    isDummy,
  };
}
