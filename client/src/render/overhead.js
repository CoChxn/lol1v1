// 캐릭터 머리 위 표시: 닉네임, 체력바, 마나바.

const BAR_WIDTH = 80;
const HP_HEIGHT = 9;
const MANA_HEIGHT = 4;
const HP_TICK = 100; // 체력바 눈금 간격

const HP_COLORS = {
  me: '#4cd964',
  blue: '#4a90ff',
  red: '#ff4d4d',
};

/**
 * @param {number} x, y  캐릭터 중심(보간된 화면 위치)
 */
export function drawOverhead(ctx, p, x, y, isMe) {
  const left = Math.round(x - BAR_WIDTH / 2);
  const hpTop = Math.round(y - p.radius - 26);
  const manaTop = hpTop + HP_HEIGHT + 1;

  // 바 배경(테두리)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(left - 2, hpTop - 2, BAR_WIDTH + 4, HP_HEIGHT + MANA_HEIGHT + 5);

  // 체력
  const hpRatio = p.maxHp > 0 ? p.hp / p.maxHp : 0;
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(left, hpTop, BAR_WIDTH, HP_HEIGHT);
  ctx.fillStyle = isMe ? HP_COLORS.me : HP_COLORS[p.team];
  ctx.fillRect(left, hpTop, BAR_WIDTH * hpRatio, HP_HEIGHT);

  // 체력 눈금
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  for (let v = HP_TICK; v < p.maxHp; v += HP_TICK) {
    const tx = left + Math.round((v / p.maxHp) * BAR_WIDTH);
    ctx.fillRect(tx, hpTop, 1, HP_HEIGHT);
  }

  // 마나
  const manaRatio = p.maxMana > 0 ? p.mana / p.maxMana : 0;
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(left, manaTop, BAR_WIDTH, MANA_HEIGHT);
  ctx.fillStyle = '#3d7bff';
  ctx.fillRect(left, manaTop, BAR_WIDTH * manaRatio, MANA_HEIGHT);

  // 닉네임
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.strokeText(p.name, x, hpTop - 4);
  ctx.fillStyle = '#fff';
  ctx.fillText(p.name, x, hpTop - 4);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}
