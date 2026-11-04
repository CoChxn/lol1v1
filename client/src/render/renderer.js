// Canvas 2D 렌더러. 게임 상태를 읽어서 그리기만 하고, 상태를 바꾸지 않는다.
import { createCamera } from './camera.js';
import { drawArena, WALL_THICKNESS } from './arena.js';
import { drawPlayers, lerpPlayerPos } from './players.js';
import { createClickMarker } from './clickMarker.js';
import { drawProjectiles } from './projectiles.js';
import { drawRangeRing } from './rangeRing.js';
import { createDamageNumbers } from './damageNumbers.js';
import { drawSkillIndicator } from './skillIndicator.js';
import { drawSkillBar } from './skillBar.js';
import { drawDebugOverlays, drawOverlayLegend } from './debug/overlays.js';
import { drawInfoPanel, drawModeBadge, drawTimeBanner } from './debug/infoPanel.js';
import { createCombatLog } from './debug/combatLog.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const camera = createCamera(WALL_THICKNESS + 40);
  const clickMarker = createClickMarker();
  const damageNumbers = createDamageNumbers();
  const combatLog = createCombatLog();

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
   * @param {object} [ui]  화면 상태 { attackMoveMode, devMode, time: { paused, scale }, aim: { skill, x, y } }
   */
  function render(prevState, state, alpha, myId, ui = {}) {
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
    // 사거리 원: 어택땅 모드일 때 (LoL처럼)
    if (me && ui.attackMoveMode) drawRangeRing(ctx, me, focus.x, focus.y, true);
    if (me && ui.aim) drawSkillIndicator(ctx, me, focus.x, focus.y, ui.aim);
    clickMarker.draw(ctx);
    drawPlayers(ctx, prevState, state, alpha, myId);
    if (ui.devMode) drawDebugOverlays(ctx, prevState, state, alpha);
    drawProjectiles(ctx, prevState, state, alpha);
    damageNumbers.draw(ctx);

    // 화면 고정 UI
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (me) drawSkillBar(ctx, canvas.width, canvas.height, me);
    if (ui.devMode) {
      drawInfoPanel(ctx, state, myId, { fps, combatLog });
      drawOverlayLegend(ctx, canvas.width, canvas.height);
      if (ui.time) drawTimeBanner(ctx, canvas.width, state, ui.time);
    }
    drawModeBadge(ctx, canvas.width, ui.devMode);
  }

  return { render, camera, clickMarker, damageNumbers, combatLog };
}
