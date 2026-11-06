// 아레나 그리기: 직사각형 맵 전체는 벽, 그 안의 대각선 통로(라인)가 바닥.
// 통로 위에 격자, 가운데 선과 원, 진영 시작 지점을 그린다. (맵 모양은 shared/map.js)

export const WALL_THICKNESS = 60; // 맵 바깥 테두리 두께 (카메라가 맵 밖을 얼마나 보여 줄지)
const GRID = 100;

const TEAM_COLORS = {
  blue: { fill: 'rgba(60, 130, 255, 0.25)', stroke: '#3c82ff' },
  red: { fill: 'rgba(255, 70, 70, 0.25)', stroke: '#ff4646' },
};

export function drawArena(ctx, map) {
  const { width, height, spawns, lane } = map;

  // 벽: 맵 전체 (+ 바깥 테두리)
  ctx.fillStyle = '#2e2e36';
  ctx.fillRect(-WALL_THICKNESS, -WALL_THICKNESS, width + WALL_THICKNESS * 2, height + WALL_THICKNESS * 2);
  ctx.fillStyle = '#3a3a44';
  ctx.fillRect(0, 0, width, height);

  // 통로 바닥 (통로 기준 좌표로 그린다: u = 라인 방향, v = 가로 방향)
  ctx.save();
  ctx.translate(lane.x0, lane.y0);
  ctx.rotate(Math.atan2(lane.dirY, lane.dirX));
  const half = lane.width / 2;
  ctx.fillStyle = '#1f3a24';
  ctx.fillRect(0, -half, lane.length, lane.width);

  // 가운데 선과 원
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 3;
  ctx.setLineDash([20, 15]);
  ctx.beginPath();
  ctx.moveTo(lane.length / 2, -half);
  ctx.lineTo(lane.length / 2, half);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(lane.length / 2, 0, 240, 0, Math.PI * 2);
  ctx.stroke();

  // 통로 테두리 (벽과의 경계)
  ctx.strokeStyle = '#5a5a66';
  ctx.lineWidth = 4;
  ctx.strokeRect(-2, -half - 2, lane.length + 4, lane.width + 4);
  ctx.restore();

  // 격자 (월드 축 기준, 통로 안에만)
  ctx.save();
  ctx.beginPath();
  const c = [
    [0, -lane.width / 2],
    [lane.length, -lane.width / 2],
    [lane.length, lane.width / 2],
    [0, lane.width / 2],
  ].map(([u, v]) => [lane.x0 + u * lane.dirX - v * lane.dirY, lane.y0 + u * lane.dirY + v * lane.dirX]);
  ctx.moveTo(c[0][0], c[0][1]);
  for (const [x, y] of c.slice(1)) ctx.lineTo(x, y);
  ctx.closePath();
  ctx.clip();
  const xs = c.map((p) => p[0]);
  const ys = c.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs) / GRID) * GRID;
  const x1 = Math.max(...xs);
  const y0 = Math.floor(Math.min(...ys) / GRID) * GRID;
  const y1 = Math.max(...ys);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += GRID) {
    ctx.moveTo(x + 0.5, y0);
    ctx.lineTo(x + 0.5, y1);
  }
  for (let y = y0; y <= y1; y += GRID) {
    ctx.moveTo(x0, y + 0.5);
    ctx.lineTo(x1, y + 0.5);
  }
  ctx.stroke();
  ctx.restore();

  // 진영 시작 지점
  for (const team of Object.keys(spawns)) {
    const { x, y } = spawns[team];
    const color = TEAM_COLORS[team];
    ctx.fillStyle = color.fill;
    ctx.strokeStyle = color.stroke;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, 220, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
