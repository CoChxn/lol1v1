// 아레나 그리기: 바닥, 바깥 벽, 중앙선, 진영 시작 지점.

export const WALL_THICKNESS = 60;
const GRID = 100;

const TEAM_COLORS = {
  blue: { fill: 'rgba(60, 130, 255, 0.25)', stroke: '#3c82ff' },
  red: { fill: 'rgba(255, 70, 70, 0.25)', stroke: '#ff4646' },
};

export function drawArena(ctx, map) {
  const { width, height, spawns } = map;

  // 바깥 벽
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(-WALL_THICKNESS, -WALL_THICKNESS, width + WALL_THICKNESS * 2, height + WALL_THICKNESS * 2);

  // 바닥
  ctx.fillStyle = '#1f3a24';
  ctx.fillRect(0, 0, width, height);

  // 격자 (이동 감각용)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = GRID; x < width; x += GRID) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
  }
  for (let y = GRID; y < height; y += GRID) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
  }
  ctx.stroke();

  // 중앙선과 중앙 원
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 3;
  ctx.setLineDash([20, 15]);
  ctx.beginPath();
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(width / 2, height);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, 120, 0, Math.PI * 2);
  ctx.stroke();

  // 벽 안쪽 테두리
  ctx.strokeStyle = '#5a5a66';
  ctx.lineWidth = 4;
  ctx.strokeRect(-2, -2, width + 4, height + 4);

  // 진영 시작 지점
  for (const team of Object.keys(spawns)) {
    const { x, y } = spawns[team];
    const color = TEAM_COLORS[team];
    ctx.fillStyle = color.fill;
    ctx.strokeStyle = color.stroke;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, 110, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
