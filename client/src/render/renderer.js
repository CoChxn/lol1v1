// Canvas 2D 렌더러. 게임 상태를 읽어서 그리기만 하고, 상태를 바꾸지 않는다.
import { getChampion, computeWindup } from '@lol1v1/shared';
import { createCamera } from './camera.js';
import { drawArena, WALL_THICKNESS } from './arena.js';
import { drawPlayers, lerpPlayerPos } from './players.js';
import { createClickMarker } from './clickMarker.js';
import { drawProjectiles } from './projectiles.js';
import { drawRangeRing } from './rangeRing.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const camera = createCamera(WALL_THICKNESS + 40);
  const clickMarker = createClickMarker();

  // FPS 측정용
  let frames = 0;
  let fps = 0;
  let fpsTimer = performance.now();

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    camera.setViewport(canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  /**
   * @param {object} prevState  직전 틱 상태
   * @param {object} state  현재 틱 상태
   * @param {number} alpha  두 틱 사이 진행 비율(0~1)
   * @param {string} myId  내 플레이어 ID (카메라가 따라감)
   */
  function render(prevState, state, alpha, myId) {
    frames++;
    const now = performance.now();
    if (now - fpsTimer >= 1000) {
      fps = frames;
      frames = 0;
      fpsTimer = now;
    }

    // 배경(맵 바깥)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 카메라: 내 캐릭터 위치(보간된 값)를 따라간다
    const me = state.players[myId];
    const focus = me ? lerpPlayerPos(prevState.players[myId], me, alpha) : state.map.spawns.blue;
    camera.follow(focus.x, focus.y, state.map.width, state.map.height);

    // 월드
    camera.apply(ctx);
    drawArena(ctx, state.map);
    if (me) drawRangeRing(ctx, me, focus.x, focus.y);
    clickMarker.draw(ctx);
    drawPlayers(ctx, prevState, state, alpha, myId);
    drawProjectiles(ctx, prevState, state, alpha);

    // 화면 고정 UI
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#8f8';
    ctx.font = '14px monospace';
    ctx.fillText(`tick ${state.tick}  time ${state.time.toFixed(1)}s  fps ${fps}`, 10, 20);
    if (me) {
      ctx.fillText(`pos ${me.x.toFixed(0)}, ${me.y.toFixed(0)}  ${me.target ? 'moving' : 'idle'}`, 10, 40);
      ctx.fillText(`hp ${me.hp}/${me.maxHp}  mana ${me.mana}/${me.maxMana}`, 10, 60);
      const dummy = state.players.dummy;
      if (dummy) ctx.fillText(`dummy hp ${dummy.hp}/${dummy.maxHp}`, 10, 100);
      const effects = me.effects.map((e) => `${e.kind} ${e.value} (${e.remaining.toFixed(1)}s)`).join(', ');
      ctx.fillText(`move speed ${me.moveSpeed.toFixed(1)} (base ${me.baseMoveSpeed})  ${effects}`, 10, 120);
      const atk = getChampion(me.championId).attack;
      const T = 1 / me.attackSpeed;
      const phase = me.attackWindup !== null ? 'windup' : me.attackTimer > 0 ? 'cooldown' : 'ready';
      ctx.fillText(
        `attack speed ${me.attackSpeed.toFixed(3)}  T ${T.toFixed(3)}s  W ${computeWindup(atk, me.attackSpeed).toFixed(3)}s  [${phase}]`,
        10,
        140,
      );
      ctx.fillText('[테스트] 1: 내 체력-100  2: 내 마나-50  3: 모두 회복  4: 둔화 40% 3초  5: 이속 +50% 3초  6: 공속 +100% 3초', 10, 80);
    }
  }

  return { render, camera, clickMarker };
}
