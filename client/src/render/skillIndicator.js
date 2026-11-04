// 스킬 범위 표시 (조준 중). 직선 투사체: 내 위치에서 마우스 방향으로 사거리 길이의 띠.
import { getSkillData } from '@lol1v1/shared';

export function drawSkillIndicator(ctx, player, x, y, aim) {
  const data = getSkillData(player, aim.skill);
  if (!data) return;
  const angle = Math.atan2(aim.y - y, aim.x - x);
  if (data.type === 'linearProjectile') {
    const w = data.projectileRadius * 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(120, 200, 255, 0.18)';
    ctx.strokeStyle = 'rgba(160, 220, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.fillRect(0, -w / 2, data.range, w);
    ctx.strokeRect(0, -w / 2, data.range, w);
    // 화살표 끝
    ctx.beginPath();
    ctx.moveTo(data.range, -w);
    ctx.lineTo(data.range + w, 0);
    ctx.lineTo(data.range, w);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
