// [개발자 모드] 화면 고정 정보 패널: 상태 수치, 키 안내, 전투 기록.
import { getChampion, computeWindup, computeCritChance, WINDUP_CANCEL_LEEWAY } from '@lol1v1/shared';

const LINE = 17;
const PAD = 10;

function panel(ctx, x, y, lines, color = '#8f8') {
  ctx.font = '13px monospace';
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + PAD * 2;
  const height = lines.length * LINE + PAD * 2 - 4;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = color;
  lines.forEach((l, i) => ctx.fillText(l, x + PAD, y + PAD + 10 + i * LINE));
  return height;
}

function unitLines(label, p) {
  const atk = getChampion(p.championId).attack;
  const effects = p.effects.map((e) => `${e.kind} ${e.value} (${e.remaining.toFixed(1)}s)`).join(', ') || '-';
  return [
    `[${label}] ${p.name}  pos ${p.x.toFixed(0)}, ${p.y.toFixed(0)}  ${p.target ? 'moving' : 'still'}`,
    `  hp ${Math.ceil(p.hp)}/${p.maxHp}  mana ${p.mana}/${p.maxMana}  armor ${p.armor}  crit ${(computeCritChance(p) * 100).toFixed(0)}%`,
    `  move speed ${p.moveSpeed.toFixed(1)} (base ${p.baseMoveSpeed})`,
    `  attack speed ${p.attackSpeed.toFixed(3)}  T ${(1 / p.attackSpeed).toFixed(3)}s  W ${computeWindup(atk, p.attackSpeed).toFixed(3)}s`,
    `  attack [${p.attackState}]${p.attackMoveTarget ? ' attack-move' : ''}  AD ${atk.damage}  range ${atk.range} (+${WINDUP_CANCEL_LEEWAY})`,
    `  effects ${effects}`,
  ];
}

export function drawInfoPanel(ctx, state, myId, { fps, combatLog }) {
  let y = 10;
  const header = [`tick ${state.tick}  time ${state.time.toFixed(1)}s  fps ${fps}`];
  const me = state.players[myId];
  if (me) header.push(...unitLines('나', me));
  const dummy = state.players.dummy;
  if (dummy) header.push(...unitLines('허수아비', dummy));
  y += panel(ctx, 10, y, header) + 8;

  y += panel(ctx, 10, y, [
    '[키] 1: 내 체력-100  2: 내 마나-50  3: 모두 회복  4: 둔화 40% 3초',
    '     5: 이속 +50% 3초  6: 공속 +100% 3초  7: 치명타 100% 3초  8: 허수아비 방어력',
    '     A+좌클릭: 어택땅  S: 정지  F2: 개발자 모드 끄기',
  ], '#cde') + 8;

  const log = combatLog.entries();
  if (log.length) {
    panel(
      ctx,
      10,
      y,
      [
        '[전투 기록] 시간  공격자 → 대상  원래 피해 × 방어력 배율 = 최종',
        ...log.map(
          (e) =>
            `${e.time.toFixed(2).padStart(7)}s  ${e.source} → ${e.target}  ${e.raw.toFixed(1)} (armor ${e.armor}) = ${e.amount.toFixed(1)}${e.crit ? '  치명타!' : ''}`,
        ),
      ],
      '#fd8',
    );
  }
}

/** 오른쪽 위 모드 표시 */
export function drawModeBadge(ctx, width, devMode) {
  ctx.font = devMode ? 'bold 14px monospace' : '12px sans-serif';
  const text = devMode ? 'DEV' : 'F2: 개발자 모드';
  const w = ctx.measureText(text).width + 16;
  ctx.fillStyle = devMode ? 'rgba(255, 80, 80, 0.85)' : 'rgba(0, 0, 0, 0.35)';
  ctx.fillRect(width - w - 10, 10, w, 24);
  ctx.fillStyle = devMode ? '#fff' : 'rgba(255, 255, 255, 0.6)';
  ctx.fillText(text, width - w - 2, 27);
}
