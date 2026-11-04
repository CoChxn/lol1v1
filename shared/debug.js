// 테스트용(개발자 모드) 입력 처리. 게임 규칙이 아니라 테스트 편의 기능이다.
// Phase 4에서 서버는 개발 모드로 켰을 때만 { type: 'debug' } 입력을 받는다.
// player·players는 update에서 복사한 객체라 직접 바꿔도 된다.
import { addEffect } from './effects.js';
import { applyDamage, spendMana, restoreFull } from './combat.js';

// 바꿀 수 있는 스탯과 허용 범위
export const DEBUG_STATS = {
  hp: { min: 0, max: (p) => p.maxHp },
  maxHp: { min: 1 },
  mana: { min: 0, max: (p) => p.maxMana },
  maxMana: { min: 0 },
  attackDamage: { min: 0 },
  bonusAttackSpeed: { min: -1 },
  armor: {},
  critChance: { min: 0, max: () => 1 },
  critDamage: { min: 1 },
  baseMoveSpeed: { min: 0 },
  slowResist: { min: 0, max: () => 1 },
};

// 걸 수 있는 효과 종류
const EFFECT_KINDS = ['flat', 'percent', 'mult', 'slow', 'attackSpeed', 'critChance'];

/** 스탯 하나를 value로 바꾼다. 범위를 벗어나면 범위 끝으로 맞춘다. */
export function setStat(player, stat, value) {
  const rule = DEBUG_STATS[stat];
  if (!rule || !Number.isFinite(value)) return;
  let v = value;
  if (rule.min !== undefined) v = Math.max(v, rule.min);
  if (rule.max) v = Math.min(v, rule.max(player));
  player[stat] = v;
  // 최대치를 낮추면 현재값도 맞춘다
  if (stat === 'maxHp') player.hp = Math.min(player.hp, v);
  if (stat === 'maxMana') player.mana = Math.min(player.mana, v);
}

/**
 * @param {object} players
 * @param {object} player  입력을 보낸 플레이어
 * @param {object} input  { action, targetId?, stat?, value?, effect? }  targetId가 없으면 보낸 사람이 대상
 */
export function applyDebugInput(players, player, input) {
  const { action } = input;
  const target = input.targetId ? players[input.targetId] : player;
  if (!target) return;

  if (action === 'setStat') setStat(target, input.stat, input.value);
  else if (action === 'setArmor') setStat(target, 'armor', input.value);
  else if (action === 'addEffect') {
    const e = input.effect;
    if (e && EFFECT_KINDS.includes(e.kind) && Number.isFinite(e.value) && e.duration > 0) addEffect(target, e);
  } else if (action === 'clearEffects') target.effects = [];
  else if (action === 'restore') restoreFull(target);
  else if (action === 'restoreAll') {
    for (const id in players) restoreFull(players[id]);
  }
  // 숫자 키 단축 (보낸 사람 기준)
  else if (action === 'damage') applyDamage(target, 100);
  else if (action === 'spendMana') spendMana(target, 50);
  else if (action === 'slow') addEffect(target, { kind: 'slow', value: 0.4, duration: 3 });
  else if (action === 'haste') addEffect(target, { kind: 'percent', value: 0.5, duration: 3 });
  else if (action === 'attackSpeed') addEffect(target, { kind: 'attackSpeed', value: 1, duration: 3 });
  else if (action === 'crit') addEffect(target, { kind: 'critChance', value: 1, duration: 3 });
}
