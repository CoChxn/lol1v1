// 우클릭 지점 표시 (화면 효과일 뿐, 게임 판정과 무관)

const DURATION = 0.4; // 초

export function createClickMarker() {
  let marker = null;

  return {
    /** color: 'r, g, b' 형식 (기본 초록 = 이동, 빨강 = 어택땅) */
    show(x, y, color = '120, 255, 140') {
      marker = { x, y, color, start: performance.now() };
    },
    draw(ctx) {
      if (!marker) return;
      const t = (performance.now() - marker.start) / 1000 / DURATION;
      if (t >= 1) {
        marker = null;
        return;
      }
      ctx.strokeStyle = `rgba(${marker.color}, ${1 - t})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, 18 * (1 - t) + 4, 0, Math.PI * 2);
      ctx.stroke();
    },
  };
}
