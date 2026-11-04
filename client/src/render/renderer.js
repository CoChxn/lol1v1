// Canvas 2D 렌더러. 게임 상태를 읽어서 그리기만 하고, 상태를 바꾸지 않는다.

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');

  // FPS 측정용
  let frames = 0;
  let fps = 0;
  let fpsTimer = performance.now();

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  function render(state) {
    frames++;
    const now = performance.now();
    if (now - fpsTimer >= 1000) {
      fps = frames;
      frames = 0;
      fpsTimer = now;
    }

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 디버그 정보: 루프가 돌고 있는지 확인용
    ctx.fillStyle = '#8f8';
    ctx.font = '14px monospace';
    ctx.fillText(`tick ${state.tick}  time ${state.time.toFixed(1)}s  fps ${fps}`, 10, 20);
  }

  return { render };
}
