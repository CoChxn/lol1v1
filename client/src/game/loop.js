// 고정 간격 게임 루프.
// 로직(step)은 정확히 stepDt 간격으로 실행하고, 그리기(render)는 화면 주사율에 맞춰 실행한다.
// 개발자 모드 시간 조절: 속도 배율(getScale), 일시정지(isPaused), 한 틱 진행(takeStepRequest)

// 탭이 멈췄다 돌아왔을 때 한꺼번에 너무 많은 틱을 돌리지 않도록 상한을 둔다.
const MAX_FRAME_TIME = 0.25;

/**
 * @param {object} opts
 * @param {number} opts.stepDt  로직 한 번의 간격(초)
 * @param {(dt: number) => void} opts.step  로직 한 틱 실행
 * @param {(alpha: number) => void} opts.render  그리기 (alpha: 다음 틱까지 진행 비율 0~1)
 * @param {() => number} [opts.getScale]  시간 배율 (1 = 정상, 0.5 = 절반 속도)
 * @param {() => boolean} [opts.isPaused]  일시정지 여부
 * @param {() => boolean} [opts.takeStepRequest]  일시정지 중 한 틱 진행 요청
 * @returns {{ stop: () => void }}
 */
export function startLoop({ stepDt, step, render, getScale = () => 1, isPaused = () => false, takeStepRequest = () => false }) {
  let last = performance.now();
  let accumulator = 0;
  let rafId = 0;

  function frame(now) {
    const frameTime = Math.min((now - last) / 1000, MAX_FRAME_TIME);
    last = now;

    if (isPaused()) {
      // 일시정지: 요청이 있을 때만 정확히 한 틱 진행하고, 보간 없이 현재 상태를 그린다
      accumulator = 0;
      while (takeStepRequest()) step(stepDt);
      render(1);
    } else {
      accumulator += frameTime * getScale();
      while (accumulator >= stepDt) {
        step(stepDt);
        accumulator -= stepDt;
      }
      render(accumulator / stepDt);
    }
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);
  return { stop: () => cancelAnimationFrame(rafId) };
}
