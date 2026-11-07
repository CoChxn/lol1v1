// [개발자 모드] 시간 조절: 일시정지, 한 틱 진행, 느리게·빠르게 (×0.25 ~ ×8).
// 빠르게 할 때는 한 화면 프레임에 1/30초 틱을 여러 번 돌린다 → 판정은 1배속과 똑같다.
// 게임 로직(update)은 그대로 두고, 루프가 update를 언제·몇 번 부를지만 바꾼다.
// (Phase 4에서 로직이 서버로 옮겨 가면 서버 개발 모드 명령으로 바꾼다)

// M 키를 누를 때마다 이 순서로 바뀐다 (×8 다음은 ×0.25)
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const NORMAL = SPEEDS.indexOf(1);

/**
 * @param {() => boolean} isDevMode
 */
export function createTimeControl(isDevMode) {
  let paused = false;
  let speedIndex = NORMAL;
  let stepRequests = 0;

  const control = {
    isPaused: () => isDevMode() && paused,
    getScale: () => (isDevMode() ? SPEEDS[speedIndex] : 1),
    togglePause() {
      paused = !paused;
    },
    stepOnce() {
      if (control.isPaused()) stepRequests++;
    },
    cycleSpeed() {
      speedIndex = (speedIndex + 1) % SPEEDS.length;
    },
    setSpeed(scale) {
      const i = SPEEDS.indexOf(scale);
      if (i >= 0) speedIndex = i;
    },
    /** 루프가 호출: 처리할 한 틱 진행 요청이 있으면 하나 꺼낸다 */
    takeStepRequest() {
      if (stepRequests > 0 && control.isPaused()) {
        stepRequests--;
        return true;
      }
      stepRequests = 0;
      return false;
    },
    /** 화면 표시용 */
    status: () => ({ paused: control.isPaused(), scale: control.getScale() }),
  };

  window.addEventListener('keydown', (e) => {
    if (!isDevMode() || e.repeat) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const key = e.key.toLowerCase();
    if (key === 'p') control.togglePause();
    else if (key === 'n') control.stepOnce();
    else if (key === 'm') control.cycleSpeed();
  });

  return control;
}

export const TIME_SPEEDS = SPEEDS;
