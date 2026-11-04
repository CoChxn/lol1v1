// Canvas 2D 렌더러. 게임 상태를 읽어서 그리기만 하고, 상태를 바꾸지 않는다.
import { createCamera } from './camera.js';
import { drawArena, WALL_THICKNESS } from './arena.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const camera = createCamera(WALL_THICKNESS + 40);

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
   * @param {object} state  게임 상태
   * @param {{x: number, y: number}} focus  카메라가 따라갈 월드 좌표
   */
  function render(state, focus) {
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

    // 월드
    camera.follow(focus.x, focus.y, state.map.width, state.map.height);
    camera.apply(ctx);
    drawArena(ctx, state.map);

    // 화면 고정 UI
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#8f8';
    ctx.font = '14px monospace';
    ctx.fillText(`tick ${state.tick}  time ${state.time.toFixed(1)}s  fps ${fps}`, 10, 20);
    ctx.fillText('[임시] WASD / 방향키: 카메라 이동', 10, 40);
  }

  return { render, camera };
}
