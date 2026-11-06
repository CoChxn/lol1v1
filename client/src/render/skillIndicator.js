// 스킬 범위 표시 (조준 중). 조준 방식과 범위 표시 모양은 따로 정한다 (docs/SKILL_DESIGN.md).
// - direction: 내 위치에서 마우스 방향으로 사거리 길이의 띠
// - location: 내 위치 중심 사거리 원 + 도착 지점 표시 (사거리 밖이면 그 방향 최대 사거리 지점)
import { getSkillData, getProjectileEffect } from '@lol1v1/shared';

export function drawSkillIndicator(ctx, player, x, y, aim) {
  const data = getSkillData(player, aim.skill);
  if (!data) return;
  const angle = Math.atan2(aim.y - y, aim.x - x);
  if (data.targeting.type === 'direction') {
    // 방향 지정: 사거리 길이의 띠 (폭 = 투사체 폭)
    const range = data.targeting.range;
    const w = (getProjectileEffect(data)?.radius ?? 20) * 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(120, 200, 255, 0.18)';
    ctx.strokeStyle = 'rgba(160, 220, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.fillRect(0, -w / 2, range, w);
    ctx.strokeRect(0, -w / 2, range, w);
    // 화살표 끝
    ctx.beginPath();
    ctx.moveTo(range, -w);
    ctx.lineTo(range + w, 0);
    ctx.lineTo(range, w);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  if (data.targeting.type === 'location') {
    const range = data.targeting.range;
    const dx = aim.x - x;
    const dy = aim.y - y;
    const len = Math.hypot(dx, dy);
    const k = len > range ? range / len : 1;
    const tx = x + dx * k;
    const ty = y + dy * k;
    ctx.fillStyle = 'rgba(120, 200, 255, 0.08)';
    ctx.strokeStyle = 'rgba(160, 220, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, range, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 도착 지점: 내 몸 크기 원
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(200, 240, 255, 0.95)';
    ctx.beginPath();
    ctx.arc(tx, ty, player.gameplayRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }
}
