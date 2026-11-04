// 내 평타 사거리 표시. 적의 가장자리가 이 원 안에 들어오면 공격 가능 (반지름 = 사거리 + 내 게임플레이 반경)
import { getChampion } from '@lol1v1/shared';

export function drawRangeRing(ctx, player, x, y) {
  const range = getChampion(player.championId).attack.range + player.gameplayRadius;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, range, 0, Math.PI * 2);
  ctx.stroke();
}
