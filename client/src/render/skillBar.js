// 화면 아래 스킬 칸: 키, 이름, 레벨, 마나, 쿨타임 숫자.
import { SKILL_KEYS, getSkillData, levelValue, castBlockReason, getPassiveData } from '@lol1v1/shared';

const SIZE = 64;
const GAP = 10;

export function drawSkillBar(ctx, width, height, player) {
  const keys = SKILL_KEYS.filter((k) => player.skills[k]);
  const passive = getPassiveData(player);
  const slots = keys.length + (passive ? 1 : 0);
  if (!slots) return;
  const total = slots * SIZE + (slots - 1) * GAP;
  let x = Math.round(width / 2 - total / 2);
  const y = height - SIZE - 28;

  if (passive) {
    drawPassiveSlot(ctx, x, y, player, passive);
    x += SIZE + GAP;
  }

  for (const key of keys) {
    const data = getSkillData(player, key);
    const st = player.skills[key];
    const cost = levelValue(data.manaCost, st.level);
    const reason = castBlockReason(player, key);

    // 칸
    ctx.fillStyle = 'rgba(15, 20, 30, 0.9)';
    ctx.fillRect(x, y, SIZE, SIZE);
    ctx.fillStyle = reason === 'mana' ? 'rgba(40, 60, 140, 0.9)' : 'rgba(60, 110, 160, 0.9)';
    ctx.fillRect(x + 3, y + 3, SIZE - 6, SIZE - 6);

    // 쿨타임: 남은 비율만큼 어둡게 + 숫자
    if (st.cooldown > 0) {
      const total = levelValue(data.cooldown, st.level);
      const ratio = total > 0 ? Math.min(st.cooldown / total, 1) : 0;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillRect(x + 3, y + 3 + (SIZE - 6) * (1 - ratio), SIZE - 6, (SIZE - 6) * ratio);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(st.cooldown < 1 ? st.cooldown.toFixed(1) : String(Math.ceil(st.cooldown)), x + SIZE / 2, y + SIZE / 2);
    } else {
      ctx.fillStyle = reason === 'mana' ? '#9ab' : '#fff';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(key, x + SIZE / 2, y + SIZE / 2 - 4);
    }

    // 테두리, 레벨, 마나
    const queued = !!player.queuedCasts?.[key] || (player.queuedCommand?.type === 'cast' && player.queuedCommand.skill === key);
    if (queued) {
      // 선입력됨: 테두리가 깜빡인다 (곧 시전됨)
      const blink = 0.5 + 0.5 * Math.sin(performance.now() / 60);
      ctx.strokeStyle = `rgba(255, 230, 90, ${0.4 + 0.6 * blink})`;
      ctx.lineWidth = 4;
    } else {
      ctx.strokeStyle = reason === null ? '#cfa' : '#556';
      ctx.lineWidth = 2;
    }
    ctx.strokeRect(x, y, SIZE, SIZE);
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fd8';
    ctx.fillText(`Lv${st.level}`, x + 5, y + SIZE - 6);
    ctx.textAlign = 'right';
    ctx.fillStyle = reason === 'mana' ? '#f88' : '#8cf';
    ctx.fillText(String(cost), x + SIZE - 5, y + SIZE - 6);
    // 키·이름
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ccd';
    ctx.fillText(`${key} ${data.name}`, x + SIZE / 2, y + SIZE + 15);

    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    x += SIZE + GAP;
  }
}

/** 패시브 칸: 중첩 수(가운데), 남은 시간 막대(아래), 이름 */
function drawPassiveSlot(ctx, x, y, player, data) {
  const { stacks, remaining } = player.passive;
  const active = stacks > 0;
  ctx.fillStyle = 'rgba(15, 20, 30, 0.9)';
  ctx.fillRect(x, y, SIZE, SIZE);
  ctx.fillStyle = active ? 'rgba(150, 110, 40, 0.95)' : 'rgba(55, 50, 45, 0.9)';
  ctx.fillRect(x + 3, y + 3, SIZE - 6, SIZE - 6);
  ctx.strokeStyle = active && stacks >= data.maxStacks ? '#ffd84a' : '#665';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, SIZE, SIZE);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = active ? '#fff' : '#998';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(active ? String(stacks) : 'P', x + SIZE / 2, y + SIZE / 2 - 4);

  // 남은 시간 막대
  if (active) {
    const ratio = Math.min(remaining / data.duration, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x + 5, y + SIZE - 10, SIZE - 10, 5);
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(x + 5, y + SIZE - 10, (SIZE - 10) * ratio, 5);
  }
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ccd';
  ctx.fillText(data.name, x + SIZE / 2, y + SIZE + 15);
  ctx.textAlign = 'start';
}
