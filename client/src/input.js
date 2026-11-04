// 입력 수집: 마우스·키보드 → 게임 입력 객체. 판정은 하지 않는다.

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {(sx: number, sy: number) => {x: number, y: number}} opts.screenToWorld
 * @param {(wx: number, wy: number) => string|null} opts.pickEnemy  그 지점에 있는 적 ID (없으면 null)
 * @param {(input: object) => void} opts.onInput  만들어진 입력 전달
 */
export function setupInput(canvas, { screenToWorld, pickEnemy, onInput }) {
  let rightHeld = false;

  // 브라우저 우클릭 메뉴 차단
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // 우클릭: 적 위면 평타, 아니면 이동
  function sendRightClick(e) {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const enemyId = pickEnemy(x, y);
    if (enemyId) onInput({ type: 'attack', targetId: enemyId });
    else onInput({ type: 'move', x, y });
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    rightHeld = true;
    sendRightClick(e);
  });

  canvas.addEventListener('mousemove', (e) => {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    // 적 위에 마우스를 올리면 커서 변경
    canvas.style.cursor = pickEnemy(x, y) ? 'crosshair' : 'default';
    // 우클릭을 누른 채 움직이면 명령을 계속 갱신 (LoL 방식)
    if (rightHeld) sendRightClick(e);
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) rightHeld = false;
  });
  window.addEventListener('blur', () => {
    rightHeld = false;
  });

  // [테스트용] 숫자 키로 체력·마나 변경 (Phase 3 이후 제거 예정)
  const DEBUG_KEYS = { 1: 'damage', 2: 'spendMana', 3: 'restore' };
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const action = DEBUG_KEYS[e.key];
    if (action) onInput({ type: 'debug', action });
  });
}
