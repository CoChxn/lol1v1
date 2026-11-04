// 입력 수집: 마우스·키보드 → 게임 입력 객체. 판정은 하지 않는다.
//
// - 우클릭: 적 위면 평타(attack), 아니면 이동(move). 누른 채 끌면 계속 갱신
// - A: 어택땅 모드 → 좌클릭: 적 위면 평타, 땅이면 어택땅(attackMove)
//      우클릭·Esc로 모드 취소 (우클릭은 원래 동작도 한다)
// - S: 정지(stop)
// - Q/W/E/R: 누르고 있으면 범위 표시, 키를 떼거나 좌클릭하면 마우스 방향으로 시전(cast). 우클릭·Esc로 취소

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {(sx: number, sy: number) => {x: number, y: number}} opts.screenToWorld
 * @param {(wx: number, wy: number) => string|null} opts.pickEnemy  그 지점에 있는 적 ID (없으면 null)
 * @param {(input: object) => void} opts.onInput  만들어진 입력 전달
 * @param {() => number|undefined} [opts.getDummyArmor]  [테스트용] 허수아비의 현재 방어력
 * @param {() => boolean} [opts.isDevMode]  개발자 모드 여부 (테스트 키는 개발자 모드에서만 동작)
 * @returns {{ isAttackMoveMode: () => boolean, getAim: () => ({ skill: string, x: number, y: number } | null) }}
 */
export function setupInput(canvas, { screenToWorld, pickEnemy, onInput, getDummyArmor = () => 0, isDevMode = () => false }) {
  let rightHeld = false;
  let attackMoveMode = false;
  let lastMouse = null;
  let aimingSkill = null; // 범위 표시 중인 스킬 키
  const SKILL_KEYS = ['q', 'w', 'e', 'r'];

  function castAimed() {
    if (!aimingSkill || !lastMouse) {
      aimingSkill = null;
      return;
    }
    const { x, y } = screenToWorld(lastMouse.x, lastMouse.y);
    onInput({ type: 'cast', skill: aimingSkill, x, y });
    aimingSkill = null;
  }

  function updateCursor() {
    if (attackMoveMode) {
      canvas.style.cursor = 'crosshair';
      return;
    }
    if (!lastMouse) return;
    const { x, y } = screenToWorld(lastMouse.x, lastMouse.y);
    // 적 위에 마우스를 올리면 커서 변경
    canvas.style.cursor = pickEnemy(x, y) ? 'crosshair' : 'default';
  }

  // 브라우저 우클릭 메뉴 차단
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // 우클릭: 적 위면 평타, 아니면 이동
  function sendRightClick(e) {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const enemyId = pickEnemy(x, y);
    if (enemyId) onInput({ type: 'attack', targetId: enemyId });
    else onInput({ type: 'move', x, y });
  }

  // 어택땅 좌클릭: 적 위면 평타, 아니면 어택땅
  function sendAttackMove(e) {
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const enemyId = pickEnemy(x, y);
    if (enemyId) onInput({ type: 'attack', targetId: enemyId });
    else onInput({ type: 'attackMove', x, y });
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      attackMoveMode = false;
      aimingSkill = null; // 우클릭: 스킬 조준 취소
      rightHeld = true;
      sendRightClick(e);
    } else if (e.button === 0 && isDevMode() && (e.ctrlKey || e.shiftKey)) {
      // [개발자 모드] Ctrl+좌클릭: 허수아비 순간이동 / Shift+좌클릭: 내 캐릭터 순간이동
      const { x, y } = screenToWorld(e.clientX, e.clientY);
      onInput({ type: 'debug', action: 'teleport', targetId: e.ctrlKey ? 'dummy' : undefined, x, y });
    } else if (e.button === 0 && aimingSkill) {
      lastMouse = { x: e.clientX, y: e.clientY };
      castAimed();
    } else if (e.button === 0 && attackMoveMode) {
      attackMoveMode = false;
      sendAttackMove(e);
    }
    updateCursor();
  });

  canvas.addEventListener('mousemove', (e) => {
    lastMouse = { x: e.clientX, y: e.clientY };
    updateCursor();
    // 우클릭을 누른 채 움직이면 명령을 계속 갱신 (LoL 방식)
    if (rightHeld) sendRightClick(e);
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) rightHeld = false;
  });
  window.addEventListener('blur', () => {
    rightHeld = false;
    attackMoveMode = false;
    aimingSkill = null;
  });

  // [개발자 모드] 숫자 테스트 키
  const DEBUG_KEYS = { 1: 'damage', 2: 'spendMana', 3: 'restoreAll', 4: 'slow', 5: 'haste', 6: 'attackSpeed', 7: 'crit' };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    // 개발자 패널 입력칸에 글자를 치는 중에는 게임 키를 무시한다
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = e.key.toLowerCase();
    if (SKILL_KEYS.includes(key)) {
      attackMoveMode = false;
      aimingSkill = key.toUpperCase();
    } else if (key === 'a') {
      attackMoveMode = true;
    } else if (key === 'escape') {
      attackMoveMode = false;
      aimingSkill = null;
    } else if (key === 's') {
      attackMoveMode = false;
      onInput({ type: 'stop' });
    } else if (!isDevMode()) {
      // 아래 테스트 키는 개발자 모드에서만
    } else if (e.key === '8') {
      // [테스트용] 허수아비 방어력 변경
      const answer = window.prompt('허수아비 방어력 입력 (음수 가능)', String(getDummyArmor()));
      const value = Number(answer);
      if (answer !== null && answer.trim() !== '' && Number.isFinite(value)) {
        onInput({ type: 'debug', action: 'setArmor', targetId: 'dummy', value });
      }
    } else if (DEBUG_KEYS[e.key]) {
      onInput({ type: 'debug', action: DEBUG_KEYS[e.key] });
    }
    updateCursor();
  });

  // 스킬 키를 떼면 시전
  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (aimingSkill && key === aimingSkill.toLowerCase()) castAimed();
  });

  return {
    isAttackMoveMode: () => attackMoveMode,
    getAim() {
      if (!aimingSkill || !lastMouse) return null;
      return { skill: aimingSkill, ...screenToWorld(lastMouse.x, lastMouse.y) };
    },
  };
}
