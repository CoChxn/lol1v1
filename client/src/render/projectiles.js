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

    if (proj.kind === 'skillshot' || proj.kind === 'homingSkill') {
      // 스킬 투사체: 판정(히트박스)과 똑같은 크기의 원으로 그린다
      //   orb(예: W): 노란색 / wave(예: R): 흰빛 하늘색 / bolt(예: Q): 팀 색
      const SHAPE_COLORS = { orb: '255, 210, 60', wave: '190, 235, 255' };
      const fill = SHAPE_COLORS[proj.shape] ?? color;
      const r = proj.radius;
      ctx.fillStyle = `rgba(${fill}, 0.55)`;
      ctx.strokeStyle = `rgba(${fill}, 1)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // 진행 방향 표시: 원 안쪽 앞부분에 밝은 점 (원 밖으로 나가지 않음)
      const hx = x + (proj.dirX ?? 0) * r * 0.45;
      const hy = y + (proj.dirY ?? 0) * r * 0.45;
      const core = ctx.createRadialGradient(hx, hy, 0, hx, hy, r * 0.5);
      core.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      core.addColorStop(1, `rgba(${fill}, 0)`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(hx, hy, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
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
