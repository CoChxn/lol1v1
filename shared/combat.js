// 체력·마나 변화. player는 update에서 복사한 객체라 직접 바꿔도 된다.

/** 체력을 amount만큼 깎는다. 0 아래로 내려가지 않는다. */
export function applyDamage(player, amount) {
  player.hp = Math.max(0, player.hp - amount);
}

/** 체력을 amount만큼 회복한다. 최대 체력을 넘지 않는다. */
export function heal(player, amount) {
  player.hp = Math.min(player.maxHp, player.hp + amount);
}

/** 마나를 amount만큼 쓴다. 0 아래로 내려가지 않는다. */
export function spendMana(player, amount) {
  player.mana = Math.max(0, player.mana - amount);
}

/** 체력·마나를 최대치로 채운다. */
export function restoreFull(player) {
  player.hp = player.maxHp;
  player.mana = player.maxMana;
}
