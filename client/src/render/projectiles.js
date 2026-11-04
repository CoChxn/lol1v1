// 투사체 그리기. 이전 틱 위치와 보간한다.

export function drawProjectiles(ctx, prevState, state, alpha) {
  const prevById = new Map(prevState.projectiles.map((p) => [p.id, p]));

  for (const proj of state.projectiles) {
    const prev = prevById.get(proj.id);
    const x = prev ? prev.x + (proj.x - prev.x) * alpha : proj.x;
    const y = prev ? prev.y + (proj.y - prev.y) * alpha : proj.y;
    const owner = state.players[proj.ownerId];
    const team = proj.team ?? owner?.team;
    const color = team === 'red' ? '255, 120, 90' : '120, 200, 255';

    if (proj.kind === 'skillshot' && proj.shape === 'orb') {
      // 구체: 둥근 빛 덩어리
      const glow = ctx.createRadialGradient(x, y, 0, x, y, proj.radius * 1.4);
      glow.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      glow.addColorStop(0.35, `rgba(${color}, 0.85)`);
      glow.addColorStop(1, `rgba(${color}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, proj.radius * 1.4, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    if (proj.kind === 'skillshot') {
      // 직선 투사체: 진행 방향으로 길쭉한 빛 화살
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(proj.dirY, proj.dirX));
      ctx.fillStyle = `rgba(${color}, 0.25)`;
      ctx.beginPath();
      ctx.ellipse(-proj.radius, 0, proj.radius * 2.6, proj.radius, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${color}, 0.9)`;
      ctx.beginPath();
      ctx.ellipse(0, 0, proj.radius * 1.4, proj.radius * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(proj.radius * 0.4, 0, proj.radius * 0.6, proj.radius * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }

    // 빛 번짐
    ctx.fillStyle = `rgba(${color}, 0.3)`;
    ctx.beginPath();
    ctx.arc(x, y, proj.radius * 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgb(${color})`;
    ctx.beginPath();
    ctx.arc(x, y, proj.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
