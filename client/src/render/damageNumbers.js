// 데미지 숫자 (화면 효과일 뿐, 게임 판정과 무관). 맞은 캐릭터 머리 위에 떠올랐다가 사라진다.

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
        skill: !!event.skill,
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
        ctx.fillStyle = it.crit ? '#ff9a2e' : it.skill ? '#ffd84a' : '#ffffff';
        ctx.fillText(it.text, it.x, y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    },
  };
}
