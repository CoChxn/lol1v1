// 미니언 그리기: 팀 색 원 + 작은 체력바. 근접 = 원, 원거리 = 가운데 점, 대포 = 네모.
// 이전 틱 위치와 보간해서 부드럽게 그린다.
import { lerpPlayerPos } from './players.js';

const COLORS = {
  blue: { body: '#3f7fe8', edge: '#bcd4ff', bar: '#4a90ff' },
  red: { body: '#e04848', edge: '#ffc4c4', bar: '#ff4d4d' },
};
const BAR_WIDTH = 56;
const BAR_HEIGHT = 5;

const NO_ROTATION = (wx, wy, fn) => fn(wx, wy);

export function drawMinions(ctx, prevState, state, alpha, upright = NO_ROTATION) {
  const prev = prevState.minions ?? {};
  for (const m of Object.values(state.minions ?? {})) {
    const { x, y } = lerpPlayerPos(prev[m.id], m, alpha);
    const c = COLORS[m.team];
    const r = m.gameplayRadius;
    ctx.fillStyle = c.body;
    ctx.strokeStyle = c.edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (m.minionType === 'cannon') ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
    else ctx.arc(x, y, m.minionType === 'caster' ? r * 0.8 : r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (m.minionType === 'caster') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }

    upright(x, y, (ux, uy) => {
      const left = Math.round(ux - BAR_WIDTH / 2);
      const top = Math.round(uy - r - 14);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(left - 1, top - 1, BAR_WIDTH + 2, BAR_HEIGHT + 2);
      ctx.fillStyle = c.bar;
      ctx.fillRect(left, top, BAR_WIDTH * Math.max(0, m.hp / m.maxHp), BAR_HEIGHT);
    });
  }
}

/** [개발자 모드] 미니언 판정·이동 충돌 반경, 이동 목표 */
export function drawMinionDebug(ctx, prevState, state, alpha) {
  const prev = prevState.minions ?? {};
  for (const m of Object.values(state.minions ?? {})) {
    const { x, y } = lerpPlayerPos(prev[m.id], m, alpha);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(x, y, m.gameplayRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(90, 220, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(x, y, m.pathingRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
