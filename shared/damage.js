// 데미지 계산과 난수.
// - 평타: 공격력(AD) 100% 물리 피해 → 치명타 → 방어력으로 감소 → 적중 시 효과(on-hit)
// - 데미지 이벤트: { type: 'damage', damageType: 'physical' | 'magic' | 'true', amount, raw, crit, skill? }
// - 난수는 Math.random 대신 게임 상태에 저장된 시드로 만든다.
//   같은 상태 + 같은 입력이면 서버·테스트에서 항상 같은 결과가 나온다 (update가 순수 함수로 유지됨).
import { applyDamage } from './combat.js';

/**
 * 방어력에 따른 피해 배율
 *   방어력 ≥ 0: 100 / (100 + 방어력)
 *   방어력 < 0: 2 − 100 / (100 − 방어력)
 */
export function armorMultiplier(armor) {
  if (armor >= 0) return 100 / (100 + armor);
  return 2 - 100 / (100 - armor);
}

/** 물리 피해: 방어력으로 감소한 최종 피해 */
export function physicalDamage(raw, armor) {
  return raw * armorMultiplier(armor);
}

/**
 * 피해 종류별 감소 적용
 * - physical: 방어력, magic: 마법 저항력 (같은 공식), true(고정): 감소 없음
 */
export function mitigate(raw, damageType, target) {
  if (damageType === 'physical') return raw * armorMultiplier(target.armor);
  if (damageType === 'magic') return raw * armorMultiplier(target.magicResist);
  return raw;
}

/**
 * 피해 효과의 피해량 (감소 전)
 *   기본 피해(레벨별) + 총 공격력 × adRatio + 추가 공격력 × bonusAdRatio + 주문력 × apRatio
 *   추가 공격력 = 총 공격력 − 챔피언 기본 공격력
 *   baseValues: 기본 피해 배열 (챔피언이 아닌 대상에게는 nonChampionBase를 넘긴다)
 */
export function damageRaw(player, effect, level, baseValues = effect.base) {
  const base = baseValues[Math.min(Math.max(level, 1), baseValues.length) - 1];
  const bonusAd = player.attackDamage - player.baseAttackDamage;
  return (
    base +
    player.attackDamage * (effect.adRatio ?? 0) +
    bonusAd * (effect.bonusAdRatio ?? 0) +
    player.abilityPower * (effect.apRatio ?? 0)
  );
}

/**
 * 시드 기반 난수 (mulberry32). rng 객체의 seed를 바꾸고 0 이상 1 미만의 값을 돌려준다.
 * @param {{ seed: number }} rng
 */
export function nextRandom(rng) {
  rng.seed = (rng.seed + 0x6d2b79f5) | 0;
  let t = rng.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 총 치명타 확률 (기본값 + 효과). 0~1로 제한 */
export function computeCritChance(player) {
  let chance = player.critChance;
  for (const e of player.effects) {
    if (e.kind === 'critChance') chance += e.value;
  }
  return Math.min(Math.max(chance, 0), 1);
}

/** 치명타 판정 (확률이 0이면 난수를 쓰지 않는다) */
export function rollCrit(player, rng) {
  const chance = computeCritChance(player);
  if (chance <= 0) return false;
  if (chance >= 1) return true;
  return nextRandom(rng) < chance;
}

// 적중 시 효과(on-hit) 목록. 아이템·스킬이 생기면 여기에 함수를 추가한다.
// 각 함수: (attacker, target, ctx) => void
const ON_HIT_EFFECTS = [];

/**
 * 평타 적중 처리
 * @param {object|undefined} attacker  공격자 (투사체가 날아가는 동안 사라졌으면 undefined)
 * @param {object} target
 * @param {{ raw: number, crit: boolean, critDamage: number }} hit  발사 시점에 정해진 값
 * @param {{ events: object[] }} ctx
 */
export function dealAttackDamage(attacker, target, hit, ctx) {
  const raw = hit.crit ? hit.raw * hit.critDamage : hit.raw;
  const damageType = hit.damageType ?? 'physical'; // 포탑을 때리면 마법 피해일 수 있다 (attack.js structureHit)
  const amount = applyDamage(target, mitigate(raw, damageType, target));
  // raw: 방어력 적용 전 피해, amount: 실제로 들어간 피해 (무적이면 0)
  ctx.events.push({ type: 'damage', damageType, targetId: target.id, sourceId: attacker?.id ?? null, raw, amount, crit: hit.crit });
  for (const effect of ON_HIT_EFFECTS) effect(attacker, target, ctx);
}

/**
 * 스킬 피해 (치명타 없음)
 * @param {object|undefined} attacker
 * @param {object} target
 * @param {number} raw  감소 전 피해
 * @param {string} damageType  'physical' | 'magic' | 'true'
 * @param {string} skill  스킬 키 (예: 'Q')
 * @param {object} [extra]  이벤트에 덧붙일 정보 (예: { mark: true })
 */
export function dealSkillDamage(attacker, target, raw, damageType, skill, ctx, extra = {}) {
  const amount = applyDamage(target, mitigate(raw, damageType, target));
  ctx.events.push({ type: 'damage', damageType, targetId: target.id, sourceId: attacker?.id ?? null, raw, amount, crit: false, skill, ...extra });
}
