// 점멸 효과 (화면 효과일 뿐, 판정과 무관): 출발 지점과 도착 지점에 짧게 퍼지는 빛.

const DURATION = 0.35; // 초

export function createFlashEffects() {
  let items = [];
  return {
    add(ev) {
      items.push({ ...ev, start: performance.now() });
    },
    draw(ctx) {
      const now = performance.now();
      items = items.filter((it) => (now - it.start) / 1000 < DURATION);
      for (const it of items) {
        const t = (now - it.start) / 1000 / DURATION;
        for (const [x, y, base] of [
          [it.fromX, it.fromY, 'rgba(255, 240, 150,'],
          [it.toX, it.toY, 'rgba(255, 255, 220,'],
        ]) {
          const r = 25 + 55 * t;
          const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
          glow.addColorStop(0, `${base} ${0.8 * (1 - t)})`);
          glow.addColorStop(1, `${base} 0)`);
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  };
}
