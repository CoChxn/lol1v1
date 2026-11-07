// 소환사 주문. 챔피언과 상관없이 모든 플레이어가 가진다 (지금은 F = 점멸).
// - 입력: { type: 'summoner', slot: 'F', x, y }  (x, y: 커서 위치)
// - 시전 시간이 없어 누르는 즉시 발동한다. 스킬 시전 중·평타 발사 직후에도 바로 쓸 수 있고, 진행 중인 스킬 시전은 끊지 않는다.
//
// 점멸(flash): 위치 지정 + 일반 발동(즉시) + 순간이동
// - 커서가 사거리 안이면 그 지점으로, 밖이면 커서 방향으로 사거리만큼
// - 벽 밖이면 가장 가까운 통로 안 지점, 다른 캐릭터 몸 안이면 바로 바깥으로 밀어냄
// - 이동 명령: 점멸 방향과 이동 방향의 각도 차이가 KEEP_MOVE_ANGLE 미만이면 유지, 아니면 멈춤
// - 평타 명령은 유지. 평타 선딜레이 중이면 그대로 진행하고, 점멸 뒤 사거리 밖이어도 그 평타는 취소되지 않음
//
// player는 update에서 복사한 객체라 직접 바꿔도 된다.
import { clampToMap, resolveOverlap } from './movement.js';

export const SUMMONER_SPELLS = {
  flash: {
    name: '점멸',
    cooldown: 300,
    queueTime: 0,
    targeting: { type: 'location', range: 400, outOfRange: 'maxRange' },
    activation: { type: 'normal', castTime: 0 },
    effects: [{ type: 'blink' }],
  },
};

// 기본 소환사 주문 배치
export const DEFAULT_SUMMONERS = { F: 'flash' };

// 점멸 뒤 이동 명령을 유지할 최대 각도 (점멸 방향과 이동 방향의 차이)
export const KEEP_MOVE_ANGLE = Math.PI / 2;

const EPSILON = 1e-6;

/** 플레이어 소환사 주문 상태 초기값: { F: { spell: 'flash', cooldown: 0 } } */
export function createSummonerStates() {
  const states = {};
  for (const slot in DEFAULT_SUMMONERS) states[slot] = { spell: DEFAULT_SUMMONERS[slot], cooldown: 0 };
  return states;
}

export function getSummonerData(spellId) {
  return SUMMONER_SPELLS[spellId] ?? null;
}

/** 매 틱 쿨타임 감소 */
export function tickSummonerCooldowns(player, dt) {
  for (const slot in player.summoners) {
    const st = player.summoners[slot];
    if (st.cooldown > 0) st.cooldown = Math.max(0, st.cooldown - dt);
  }
}

/** 소환사 주문 사용 */
export function orderSummoner(player, players, slot, x, y, map, ctx) {
  const st = player.summoners?.[slot];
  const data = st && getSummonerData(st.spell);
  if (!data || player.hp <= 0 || st.cooldown > EPSILON) return;

  if (st.spell === 'flash') flash(player, players, data, x, y, map, ctx);
  if (!player.noCooldown) st.cooldown = data.cooldown;
}

function flash(player, players, data, x, y, map, ctx) {
  const fromX = player.x;
  const fromY = player.y;
  const dx = x - fromX;
  const dy = y - fromY;
  const len = Math.hypot(dx, dy);
  const dist = Math.min(len, data.targeting.range);
  const dirX = len > 0 ? dx / len : 1;
  const dirY = len > 0 ? dy / len : 0;

  const dest = clampToMap(fromX + dirX * dist, fromY + dirY * dist, player.pathingRadius, map);
  player.x = dest.x;
  player.y = dest.y;
  resolveOverlap(player, players, map, dirX, dirY);

  // 이동 명령: 점멸 방향과 비슷하면(각도 차이 KEEP_MOVE_ANGLE 미만) 유지, 아니면 멈춤
  if (player.target) {
    const mx = player.target.x - fromX;
    const my = player.target.y - fromY;
    const mlen = Math.hypot(mx, my);
    const cos = mlen > 0 && len > 0 ? (mx * dirX + my * dirY) / mlen : -1;
    if (!(cos > Math.cos(KEEP_MOVE_ANGLE) + EPSILON)) player.target = null;
  }

  // 평타 선딜레이 중이면: 이번 평타는 점멸 뒤 사거리 밖이어도 취소하지 않는다 (attack.js)
  if (player.attackWindup !== null) player.attackWindupKeepRange = true;

  ctx.events.push({ type: 'flash', sourceId: player.id, fromX, fromY, toX: player.x, toY: player.y });
}
