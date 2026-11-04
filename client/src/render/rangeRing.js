// 내 평타 사거리 표시 (가장자리 기준이므로 반지름 = 사거리 + 내 반지름)
import { getChampion } from '@lol1v1/shared';

export function drawRangeRing(ctx, player, x, y) {
  const range = getChampion(player.championId).attack.range + player.radius;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, range, 0, Math.PI * 2);
  ctx.stroke();
}
