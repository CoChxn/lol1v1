// 플레이어 그리기. 이전 상태와 현재 상태 사이를 보간해서 부드럽게 그린다.
import { drawOverhead, drawAttackTimer } from './overhead.js';

const TEAM_COLORS = {
  blue: { body: '#4a90ff', outline: '#cfe0ff' },
  red: { body: '#ff5a5a', outline: '#ffd0d0' },
};

/** 두 상태 사이의 플레이어 위치 (alpha: 0이면 prev, 1이면 curr) */
export function lerpPlayerPos(prev, curr, alpha) {
  if (!prev) return { x: curr.x, y: curr.y };
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
    if (id === myId) drawAttackTimer(ctx, p, x, y);
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
