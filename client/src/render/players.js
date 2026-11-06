// 플레이어 그리기. 이전 상태와 현재 상태 사이를 보간해서 부드럽게 그린다.
import { drawOverhead } from './overhead.js';

const TEAM_COLORS = {
  blue: { body: '#4a90ff', outline: '#cfe0ff' },
  red: { body: '#ff5a5a', outline: '#ffd0d0' },
};

/** 두 상태 사이의 플레이어 위치 (alpha: 0이면 prev, 1이면 curr) */
// 한 틱에 이보다 멀리 움직였으면 순간이동으로 보고 보간하지 않는다 (가장 빠른 이동도 한 틱에 수십 정도)
const TELEPORT_DISTANCE = 150;

export function lerpPlayerPos(prev, curr, alpha) {
  if (!prev) return { x: curr.x, y: curr.y };
  if (Math.hypot(curr.x - prev.x, curr.y - prev.y) > TELEPORT_DISTANCE) return { x: curr.x, y: curr.y };
  return {
    x: prev.x + (curr.x - prev.x) * alpha,
    y: prev.y + (curr.y - prev.y) * alpha,
  };
}

export function drawPlayers(ctx, prevState, state, alpha, myId) {
  for (const id in state.players) {
    drawBody(ctx, prevState, state, alpha, myId, id);
  }
  // 머리 위 UI는 다른 캐릭터 몸체에 가려지지 않도록 나중에 그린다.
  for (const id in state.players) {
    const p = state.players[id];
    const { x, y } = lerpPlayerPos(prevState.players[id], p, alpha);
    drawOverhead(ctx, p, x, y, id === myId);
    drawMarks(ctx, p, x, y);
  }
}

function drawBody(ctx, prevState, state, alpha, myId, id) {
  const p = state.players[id];
  const { x, y } = lerpPlayerPos(prevState.players[id], p, alpha);
  const color = TEAM_COLORS[p.team];

  // 몸체는 게임플레이 반경(판정 크기)으로 그린다. 이동 충돌 반경은 그리지 않는다.
  const body = p.gameplayRadius;

  // 그림자
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + body * 0.6, body * 0.9, body * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  // 몸체
  ctx.fillStyle = color.body;
  ctx.strokeStyle = id === myId ? '#ffe066' : color.outline;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, body, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** 캐릭터에 붙은 표식: 체력바 위쪽에 빛나는 구슬 + 남은 시간 */
function drawMarks(ctx, p, x, y) {
  if (!p.marks?.length) return;
  const top = y - p.gameplayRadius - 66;
  p.marks.forEach((m, i) => {
    const mx = x + (i - (p.marks.length - 1) / 2) * 34;
    const pulse = 1 + 0.12 * Math.sin(performance.now() / 120);
    const r = 11 * pulse;
    const glow = ctx.createRadialGradient(mx, top, 0, mx, top, r * 1.8);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    glow.addColorStop(0.4, 'rgba(255, 200, 80, 0.9)');
    glow.addColorStop(1, 'rgba(255, 160, 40, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(mx, top, r * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 3;
    const label = `${m.skill} ${m.remaining.toFixed(1)}`;
    ctx.strokeText(label, mx, top - 22);
    ctx.fillText(label, mx, top - 22);
    ctx.textAlign = 'start';
  });
}
