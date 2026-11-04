// [개발자 모드] 월드 위에 그리는 확인용 표시: 반경 3종, 사거리, 이동 목표, 공격 타이머, 평타 상태.
import { getChampion, WINDUP_CANCEL_LEEWAY } from '@lol1v1/shared';
import { lerpPlayerPos } from '../players.js';
import { drawAttackTimer } from '../overhead.js';

function circle(ctx, x, y, r, color, dash = [], width = 1.5) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawDebugOverlays(ctx, prevState, state, alpha) {
  for (const id in state.players) {
    const p = state.players[id];
    const { x, y } = lerpPlayerPos(prevState.players[id], p, alpha);
    const atk = getChampion(p.championId).attack;

    // 사거리 (가장자리 기준이므로 원 반지름 = 사거리 + 내 게임플레이 반경) / 선딜레이 취소 거리
    circle(ctx, x, y, atk.range + p.gameplayRadius, 'rgba(255, 255, 255, 0.25)', [], 1.5);
    circle(ctx, x, y, atk.range + WINDUP_CANCEL_LEEWAY + p.gameplayRadius, 'rgba(255, 255, 255, 0.12)', [4, 8], 1);

    // 반경 3종
    circle(ctx, x, y, p.gameplayRadius, 'rgba(255, 255, 255, 0.9)', [], 2); // 판정
    circle(ctx, x, y, p.pathingRadius, 'rgba(90, 220, 255, 0.95)', [6, 4], 2); // 이동 충돌
    circle(ctx, x, y, p.selectionRadius, 'rgba(255, 220, 80, 0.8)', [2, 4], 1.5); // 클릭 선택

    // 이동 목표 선
    if (p.target) {
      ctx.strokeStyle = 'rgba(120, 255, 140, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(p.target.x, p.target.y);
      ctx.stroke();
    }
    // 어택땅 목적지
    if (p.attackMoveTarget) {
      const { x: ax, y: ay } = p.attackMoveTarget;
      ctx.strokeStyle = 'rgba(255, 90, 90, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ax - 10, ay - 10);
      ctx.lineTo(ax + 10, ay + 10);
      ctx.moveTo(ax + 10, ay - 10);
      ctx.lineTo(ax - 10, ay + 10);
      ctx.stroke();
    }
    // 평타 대상 선
    const target = p.attackTargetId && state.players[p.attackTargetId];
    if (target) {
      ctx.strokeStyle = 'rgba(255, 90, 90, 0.5)';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 공격 타이머 바와 평타 상태
    drawAttackTimer(ctx, p, x, y);
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillText(p.attackState, x, y + p.gameplayRadius + 32);
    ctx.textAlign = 'start';
  }
}

/** 반경 색 안내 (화면 고정, 오른쪽 아래) */
export function drawOverlayLegend(ctx, width, height) {
  const items = [
    ['게임플레이 반경 (판정)', 'rgba(255, 255, 255, 0.9)', []],
    ['이동 충돌 반경', 'rgba(90, 220, 255, 0.95)', [6, 4]],
    ['선택 반경 (클릭)', 'rgba(255, 220, 80, 0.8)', [2, 4]],
    ['평타 사거리', 'rgba(255, 255, 255, 0.4)', []],
    ['선딜레이 취소 거리', 'rgba(255, 255, 255, 0.3)', [4, 8]],
  ];
  const x = width - 200;
  let y = height - items.length * 20 - 16;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(x - 10, y - 12, 200, items.length * 20 + 12);
  ctx.font = '12px sans-serif';
  for (const [label, color, dash] of items) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 30, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ddd';
    ctx.fillText(label, x + 38, y + 4);
    y += 20;
  }
}
