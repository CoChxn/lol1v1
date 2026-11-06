// [개발자 모드] 허수아비 행동. 허수아비가 매 틱 스스로 입력을 만든다 (판정은 일반 입력과 같은 로직).
// dummyMode:
// - 'idle':   가만히 있기
// - 'patrol': 기준 위치(patrolAnchor)에서 라인 방향으로 앞뒤 왔다 갔다 (추적·유도 투사체 테스트)
// - 'attack': 가장 가까운 적에게 평타 (나를 쫓아와서 때림)
import { canAttack } from './attack.js';
import { laneDirection } from './map.js';

export const DUMMY_MODES = ['idle', 'patrol', 'attack'];
export const PATROL_HALF_WIDTH = 300;

/** 허수아비들이 이번 틱에 보낼 입력 목록 */
export function dummyInputs(players, map) {
  const inputs = [];
  for (const id in players) {
    const p = players[id];
    if (!p.isDummy || p.hp <= 0) continue;

    if (p.dummyMode === 'patrol' && p.patrolAnchor) {
      // 이동 목표가 없으면(끝에 도착하면) 반대쪽 끝으로
      if (!p.target) {
        const d = laneDirection(map);
        const a = { x: p.patrolAnchor.x - d.x * PATROL_HALF_WIDTH, y: p.patrolAnchor.y - d.y * PATROL_HALF_WIDTH };
        const b = { x: p.patrolAnchor.x + d.x * PATROL_HALF_WIDTH, y: p.patrolAnchor.y + d.y * PATROL_HALF_WIDTH };
        const goB = Math.hypot(p.x - a.x, p.y - a.y) < Math.hypot(p.x - b.x, p.y - b.y);
        const dest = goB ? b : a;
        inputs.push({ playerId: id, type: 'move', x: dest.x, y: dest.y });
      }
    } else if (p.dummyMode === 'attack') {
      // 이미 공격 가능한 대상을 잡고 있으면 그대로
      if (p.attackTargetId && canAttack(p, players[p.attackTargetId])) continue;
      let best = null;
      let bestDist = Infinity;
      for (const oid in players) {
        const o = players[oid];
        if (!canAttack(p, o)) continue;
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < bestDist) {
          best = o;
          bestDist = d;
        }
      }
      if (best) inputs.push({ playerId: id, type: 'attack', targetId: best.id });
    }
  }
  return inputs;
}
