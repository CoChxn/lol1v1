// 고정 간격 게임 루프.
// 로직(step)은 정확히 stepDt 간격으로 실행하고, 그리기(render)는 화면 주사율에 맞춰 실행한다.

// 탭이 멈췄다 돌아왔을 때 한꺼번에 너무 많은 틱을 돌리지 않도록 상한을 둔다.
const MAX_FRAME_TIME = 0.25;

/**
 * @param {object} opts
 * @param {number} opts.stepDt  로직 한 번의 간격(초)
 * @param {(dt: number) => void} opts.step  로직 한 틱 실행
 * @param {(alpha: number) => void} opts.render  그리기 (alpha: 다음 틱까지 진행 비율 0~1)
 * @returns {{ stop: () => void }}
 */
export function startLoop({ stepDt, step, render }) {
  let last = performance.now();
  let accumulator = 0;
  let rafId = 0;

  function frame(now) {
    const frameTime = Math.min((now - last) / 1000, MAX_FRAME_TIME);
    last = now;
    accumulator += frameTime;

    while (accumulator >= stepDt) {
      step(stepDt);
      accumulator -= stepDt;
    }

    render(accumulator / stepDt);
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);
  return { stop: () => cancelAnimationFrame(rafId) };
}
