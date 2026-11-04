// 입력 수집: 마우스·키보드 → 게임 입력 객체. 판정은 하지 않는다.

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {(sx: number, sy: number) => {x: number, y: number}} opts.screenToWorld
 * @param {(input: object) => void} opts.onInput  만들어진 입력 전달
 */
export function setupInput(canvas, { screenToWorld, onInput }) {
  let rightHeld = false;

  // 브라우저 우클릭 메뉴 차단
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function sendMove(e) {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    onInput({ type: 'move', x, y });
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    rightHeld = true;
    sendMove(e);
  });

  // 우클릭을 누른 채 움직이면 목표를 계속 갱신 (LoL 방식)
  canvas.addEventListener('mousemove', (e) => {
    if (rightHeld) sendMove(e);
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) rightHeld = false;
  });
  window.addEventListener('blur', () => {
    rightHeld = false;
  });
}
