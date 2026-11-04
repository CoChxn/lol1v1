// 화면 아래 스킬 칸: 키, 이름, 레벨, 마나, 쿨타임 숫자.
import { SKILL_KEYS, getSkillData, levelValue, castBlockReason } from '@lol1v1/shared';

const SIZE = 64;
const GAP = 10;

export function drawSkillBar(ctx, width, height, player) {
  const keys = SKILL_KEYS.filter((k) => player.skills[k]);
  if (!keys.length) return;
  const total = keys.length * SIZE + (keys.length - 1) * GAP;
  let x = Math.round(width / 2 - total / 2);
  const y = height - SIZE - 28;

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
    ctx.strokeStyle = reason === null ? '#cfa' : '#556';
    ctx.lineWidth = 2;
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
