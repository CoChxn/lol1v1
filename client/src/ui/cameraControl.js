// 카메라 조작 (화면 쪽 기능, 게임 판정과 무관).
// - 고정 모드(기본): 내 캐릭터에 딱 붙어서 즉시 따라감. 오프셋 적용
//     진영별 오프셋: 캐릭터를 화면 가운데에서 우리 진영 쪽으로 화면 폭의 15%만큼(라인 방향) 비켜 둠 (적 쪽을 더 넓게)
//       파랑(왼쪽 아래 진영)이면 캐릭터가 왼쪽 아래, 빨강이면 오른쪽 위
//     고정 오프셋: 진영과 상관없이 캐릭터를 화면 가운데에 둠
// - 자유 모드: 마우스를 화면 끝 15픽셀 안에 대면 그 방향으로 이동
// - Y: 고정 ↔ 자유 전환 (설정에 저장)
// - Space / F1: 짧게 누르면 내 캐릭터로 한 번 이동, 누르고 있으면 계속 따라감
// - 마우스 휠: 화면 가운데 기준 확대 (1.0 ~ 1.5배). 개발자 모드에서는 0.08 ~ 3배
import { ZOOM_RANGE } from './settings.js';

export const EDGE_PAN_WIDTH = 15; // 화면 끝 감지 폭 (픽셀)
const PER_SIDE_OFFSET = 0.15; // 화면 폭 대비
const ZOOM_STEP = 1.1; // 휠 한 칸
const DEV_ZOOM_RANGE = { min: 0.08, max: 3 };
const MAX_FRAME_TIME = 0.1;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * @param {object} opts
 * @param {object} opts.camera  render/camera.js
 * @param {HTMLCanvasElement} opts.canvas
 * @param {object} opts.settings  ui/settings.js
 * @param {() => boolean} opts.isDevMode
 */
export function createCameraControl({ camera, canvas, settings, isDevMode }) {
  let mode = settings.getCamera().mode;
  let zoom = settings.getCamera().zoom;
  let followHeld = false; // Space / F1을 누르고 있는 중
  let snapPending = false; // 짧게 눌렀다 떼도 한 번은 내 캐릭터로 이동하도록
  let freeX = null; // 자유 모드에서 보고 있는 지점
  let freeY = null;
  let mouse = null; // 화면 좌표 (창 밖이면 null)
  let lastTime = performance.now();

  // 설정 창에서 모드를 바꾸면 반영
  settings.onChange(() => {
    mode = settings.getCamera().mode;
  });

  const typing = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);

  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    const key = e.key.toLowerCase();
    if (key === ' ' || e.key === 'F1') {
      e.preventDefault(); // 페이지 스크롤, 브라우저 도움말 막기
      followHeld = true;
      snapPending = true;
    } else if (key === 'y' && !e.repeat) {
      mode = mode === 'locked' ? 'free' : 'locked';
      if (mode === 'free') {
        freeX = camera.x;
        freeY = camera.y;
      }
      settings.setCamera({ mode });
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'F1') followHeld = false;
  });
  window.addEventListener('blur', () => {
    followHeld = false;
    mouse = null;
  });

  window.addEventListener('mousemove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
  });
  document.addEventListener('mouseleave', () => {
    mouse = null;
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const range = isDevMode() ? DEV_ZOOM_RANGE : ZOOM_RANGE;
      zoom = clamp(zoom * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), range.min, range.max);
      // 개발자 모드의 제한 밖 배율은 저장하지 않는다
      if (zoom >= ZOOM_RANGE.min && zoom <= ZOOM_RANGE.max) settings.setCamera({ zoom });
    },
    { passive: false },
  );

  /** 고정 모드에서 화면 가운데에 둘 지점 (캐릭터 위치 + 오프셋, 월드 단위) */
  function lockedCenter(focus, team) {
    const { offsetMode } = settings.getCamera();
    if (offsetMode === 'fixed') return { x: focus.x, y: focus.y };
    const side = team === 'red' ? -1 : 1;
    return { x: focus.x + (side * camera.viewWidth * PER_SIDE_OFFSET) / camera.zoom, y: focus.y };
  }

  /** 화면 끝에 닿은 방향 (-1, 0, 1) */
  function edgeDirection() {
    if (!mouse) return { x: 0, y: 0 };
    const x = mouse.x <= EDGE_PAN_WIDTH ? -1 : mouse.x >= camera.viewWidth - EDGE_PAN_WIDTH ? 1 : 0;
    const y = mouse.y <= EDGE_PAN_WIDTH ? -1 : mouse.y >= camera.viewHeight - EDGE_PAN_WIDTH ? 1 : 0;
    return { x, y };
  }

  return {
    /** 매 프레임 그리기 전에 호출: 카메라 위치와 배율을 정한다 */
    update(focus, team, map) {
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, MAX_FRAME_TIME);
      lastTime = now;

      // 개발자 모드가 꺼지면 배율을 일반 범위로 되돌린다
      if (!isDevMode()) zoom = clamp(zoom, ZOOM_RANGE.min, ZOOM_RANGE.max);
      camera.zoom = zoom;

      if (mode === 'locked' || followHeld || snapPending || freeX === null) {
        snapPending = false;
        const c = lockedCenter(focus, team);
        camera.lookAt(c.x, c.y, map.width, map.height);
      } else {
        // 화면 끝 방향(화면 기준)을 월드 방향으로 바꿔서 이동 (화면이 회전되어 있으므로)
        const sdir = edgeDirection();
        const len = Math.hypot(sdir.x, sdir.y) || 1;
        const dir = camera.screenDirToWorld(sdir.x / len, sdir.y / len);
        const speed = settings.getCamera().panSpeed;
        camera.lookAt(freeX + dir.x * speed * dt, freeY + dir.y * speed * dt, map.width, map.height);
      }
      // 맵 끝에서 멈춘 위치를 기억한다 (자유 모드로 바꾸거나 Space를 뗐을 때 그 자리에서 시작)
      freeX = camera.x;
      freeY = camera.y;
    },

    /** [개발자 모드] 표시용 */
    status: () => ({ mode, zoom, followHeld, mouse, edge: mode === 'free' && !followHeld ? edgeDirection() : { x: 0, y: 0 } }),
  };
}
