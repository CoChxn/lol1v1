// 포탑 그리기: 팀 색 큰 원 + 체력바. 파괴되면 회색 잔해.
// [개발자 모드] 공격 사거리 원, 지형 원, 대상 선, 피해 증가(%), 공격 상태(포착·선딜레이·쿨다운)와 진행 바.
import { TURRET } from '@lol1v1/shared';

const TEAM_COLORS = {
  blue: { body: '#2f6fe0', ring: '#9cc2ff', bar: '#4a90ff' },
  red: { body: '#d94040', ring: '#ffb0b0', bar: '#ff4d4d' },
};
const BAR_WIDTH = 140;
const BAR_HEIGHT = 10;

const NO_ROTATION = (wx, wy, fn) => fn(wx, wy);

/** 포탑 본체 (캐릭터보다 먼저 그린다) */
export function drawTurrets(ctx, state) {
  for (const t of Object.values(state.turrets ?? {})) {
    const c = TEAM_COLORS[t.team];
    if (t.destroyed) {
      // 잔해: 회색 조각 몇 개
      ctx.fillStyle = '#55555c';
      ctx.beginPath();
      ctx.arc(t.x, t.y, TURRET.obstacleRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6e6e76';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4;
        ctx.beginPath();
        ctx.arc(t.x + Math.cos(a) * 45, t.y + Math.sin(a) * 45, 18 + (i % 3) * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }
    // 바닥(지형) + 본체
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.arc(t.x, t.y, TURRET.obstacleRadius + 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.body;
    ctx.strokeStyle = c.ring;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.gameplayRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.gameplayRadius * 0.4, 0, Math.PI * 2);
    ctx.fill();

  }
}

/** 포탑 체력바. 다른 어떤 것에도 가려지지 않도록 렌더러가 맨 마지막에 그린다 */
export function drawTurretBars(ctx, state, upright = NO_ROTATION) {
  for (const t of Object.values(state.turrets ?? {})) {
    if (t.destroyed) continue;
    const c = TEAM_COLORS[t.team];
    upright(t.x, t.y, (x, y) => {
      const left = Math.round(x - BAR_WIDTH / 2);
      const top = Math.round(y - t.gameplayRadius - 30);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(left - 2, top - 2, BAR_WIDTH + 4, BAR_HEIGHT + 4);
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(left, top, BAR_WIDTH, BAR_HEIGHT);
      ctx.fillStyle = c.bar;
      ctx.fillRect(left, top, BAR_WIDTH * Math.max(0, t.hp / t.maxHp), BAR_HEIGHT);
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(`${Math.ceil(t.hp)}`, x, top - 4);
      ctx.textAlign = 'start';
    });
  }
}

/** 포탑 공격 사거리 (대상 가장자리 기준이라 원 반지름 = 사거리 + 챔피언 판정 반경) */
export function drawTurretRange(ctx, t, championRadius, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(t.x, t.y, t.range + championRadius, 0, Math.PI * 2);
  ctx.stroke();
}

/** 내 캐릭터가 적 포탑 사거리 근처에 오면 사거리 원을 보여 준다 (LoL처럼) */
export function drawTurretWarnings(ctx, state, me, mePos) {
  if (!me) return;
  for (const t of Object.values(state.turrets ?? {})) {
    if (t.destroyed || t.team === me.team) continue;
    const reach = t.range + me.gameplayRadius;
    const d = Math.hypot(mePos.x - t.x, mePos.y - t.y);
    if (d > reach + 400) continue;
    const targetingMe = t.targetId === me.id || t.windupTargetId === me.id; // 포착 시작부터 빨간색
    drawTurretRange(ctx, t, me.gameplayRadius, targetingMe ? 'rgba(255, 60, 60, 0.85)' : 'rgba(255, 120, 120, 0.4)');
  }
}

/** [개발자 모드] 사거리·지형 원, 대상 선, 피해 증가·공격 타이머 */
export function drawTurretDebug(ctx, state, championRadius, upright = NO_ROTATION) {
  for (const t of Object.values(state.turrets ?? {})) {
    ctx.setLineDash([10, 8]);
    drawTurretRange(ctx, t, championRadius, 'rgba(255, 200, 80, 0.5)');
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(90, 220, 255, 0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(t.x, t.y, TURRET.obstacleRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (t.destroyed) continue;

    const target = t.targetId && (state.players[t.targetId] ?? state.turrets[t.targetId]);
    if (target) {
      ctx.strokeStyle = 'rgba(255, 80, 80, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    }
    upright(t.x, t.y, (x, y) => {
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      const ramp = Math.round(TURRET.ramp.perHit * t.rampStacks * 100);
      ctx.fillText(`AD ${t.attackDamage}  방어 ${t.armor}  증가 +${ramp}%${t.rampStacks ? ` (${t.rampTimer.toFixed(1)}s)` : ''}`, x, y + t.gameplayRadius + 22);
      const state = { idle: '대기', acquire: '포착', windup: '선딜레이', cooldown: '쿨다운' }[t.attackState] ?? t.attackState;
      const left = t.attackState === 'acquire' ? t.acquireTimer : t.attackState === 'windup' ? t.windupTimer : t.attackTimer;
      ctx.fillText(`${state} ${left > 0 ? left.toFixed(2) + 's' : ''}  대상 ${target?.name ?? '-'}`, x, y + t.gameplayRadius + 38);
      ctx.textAlign = 'start';
      drawTurretTimer(ctx, t, x, y + t.gameplayRadius + 46);
    });
  }
}

/** 포탑 공격 진행 바: 포착 주황(차오름) / 선딜레이 노랑(차오름) / 쿨다운 회색(줄어듦) */
function drawTurretTimer(ctx, t, x, top) {
  const W = 100;
  const H = 6;
  let color;
  let ratio;
  if (t.attackState === 'acquire') {
    color = '#ff9a3c';
    ratio = 1 - t.acquireTimer / TURRET.acquireTime;
  } else if (t.attackState === 'windup') {
    color = '#ffd84a';
    ratio = 1 - t.windupTimer / TURRET.windupTime;
  } else if (t.attackState === 'cooldown' && t.attackTimerTotal > 0) {
    color = '#9a9a9a';
    const cd = t.attackTimerTotal - TURRET.windupTime;
    ratio = cd > 0 ? t.attackTimer / cd : 0;
  } else {
    return;
  }
  const left = Math.round(x - W / 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(left - 1, top - 1, W + 2, H + 2);
  ctx.fillStyle = color;
  ctx.fillRect(left, top, W * Math.min(Math.max(ratio, 0), 1), H);
}
