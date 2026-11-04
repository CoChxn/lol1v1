// 표식(부착) 로직. 스킬이 대상에게 표식을 붙이고, 시전자의 다음 평타나 다른 스킬이 그 대상을 맞히면 터진다.
// - 표식: target.marks = [{ ownerId, skill, remaining }]
// - 같은 스킬로 다시 맞히면 터지지 않고 시간만 갱신
// - 터질 때 효과(onDetonate)는 챔피언 데이터의 applyMark 정의를 따른다
//   damage: 피해 (터지는 순간 시전자의 스킬 레벨·스탯으로 계산)
//   restoreMana: 시전자 마나 회복 = base + (plusTriggerCost면 터뜨린 스킬의 마나 소모량, 평타면 0)
// player는 update에서 복사한 객체라 직접 바꿔도 된다.
import { getChampion } from './champions/index.js';
import { dealSkillDamage, damageRaw } from './damage.js';

const EPSILON = 1e-6;

/** 스킬 데이터에서 표식 정의(applyMark 효과)를 찾는다 */
export function findMarkSpec(championId, skill) {
  const data = getChampion(championId).skills?.[skill];
  for (const effect of data?.effects ?? []) {
    const spec = effect.onHit?.find((e) => e.type === 'applyMark');
    if (spec) return spec;
  }
  return null;
}

/** 표식 부착. 같은 시전자의 같은 스킬 표식이 있으면 시간만 갱신 */
export function applyMark(ownerId, target, skill, duration) {
  const others = target.marks.filter((m) => !(m.ownerId === ownerId && m.skill === skill));
  target.marks = [...others, { ownerId, skill, remaining: duration }];
}

/** 매 틱 표식 시간 감소, 끝난 표식 제거 */
export function tickMarks(player, dt) {
  if (player.marks.length === 0) return;
  player.marks = player.marks.map((m) => ({ ...m, remaining: m.remaining - dt })).filter((m) => m.remaining > EPSILON);
}

/**
 * 시전자(owner)의 평타·스킬이 target을 맞혔을 때, owner가 붙인 표식을 터뜨린다.
 * @param {object|undefined} owner
 * @param {object} target
 * @param {{ by: 'attack' | 'skill', skill?: string, manaCost?: number }} trigger  무엇으로 맞혔는지
 */
export function triggerMarks(owner, target, trigger, ctx) {
  if (!owner || target.hp <= 0 || target.marks.length === 0) return;
  const toDetonate = target.marks.filter(
    (m) => m.ownerId === owner.id && !(trigger.by === 'skill' && trigger.skill === m.skill),
  );
  if (toDetonate.length === 0) return;
  target.marks = target.marks.filter((m) => !toDetonate.includes(m));

  for (const mark of toDetonate) {
    const spec = findMarkSpec(owner.championId, mark.skill);
    if (!spec) continue;
    const level = owner.skills[mark.skill]?.level ?? 1;
    ctx.events.push({ type: 'markDetonate', targetId: target.id, sourceId: owner.id, skill: mark.skill });
    for (const e of spec.onDetonate) {
      if (e.type === 'damage') {
        dealSkillDamage(owner, target, damageRaw(owner, e, level), e.damageType, mark.skill, ctx, { mark: true });
      } else if (e.type === 'restoreMana') {
        const amount = e.base + (e.plusTriggerCost ? (trigger.manaCost ?? 0) : 0);
        const before = owner.mana;
        owner.mana = Math.min(owner.maxMana, owner.mana + amount);
        ctx.events.push({ type: 'manaRestore', targetId: owner.id, amount: owner.mana - before });
      }
    }
  }
}
