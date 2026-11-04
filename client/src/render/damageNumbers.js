// 데미지 숫자 (화면 효과일 뿐, 게임 판정과 무관). 맞은 캐릭터 머리 위에 떠올랐다가 사라진다.
// 색은 피해 종류로 구분하고, 치명타는 같은 색으로 크게 표시한다.

const DAMAGE_COLORS = {
  physical: '#ff9a2e', // 물리: 주황
  magic: '#4aa8ff', // 마법: 파랑
  true: '#ffffff', // 고정: 흰색 (임시)
};

const DURATION = 0.9; // 초
const RISE = 50; // 떠오르는 높이

export function createDamageNumbers() {
  let items = [];

  return {
    /** @param {{ amount: number, crit: boolean }} event  @param {{x:number,y:number}} pos 맞은 위치 */
    add(event, pos) {
      items.push({
        x: pos.x + (Math.random() - 0.5) * 30, // 겹치지 않게 살짝 흩뿌림 (화면 효과라 Math.random 사용)
        y: pos.y,
        text: String(Math.round(event.amount)),
        crit: event.crit,
        color: DAMAGE_COLORS[event.damageType] ?? '#ffffff',
        start: performance.now(),
      });
    },
    draw(ctx) {
      const now = performance.now();
      items = items.filter((it) => (now - it.start) / 1000 < DURATION);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const it of items) {
        const t = (now - it.start) / 1000 / DURATION;
        const size = it.crit ? 30 : 20;
        ctx.font = `bold ${size}px sans-serif`;
        ctx.globalAlpha = 1 - t * t;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        const y = it.y - RISE * t;
        ctx.strokeText(it.text, it.x, y);
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, it.x, y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    },
  };
}
