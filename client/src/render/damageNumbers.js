// 데미지 숫자 (화면 효과일 뿐, 게임 판정과 무관). 맞은 캐릭터 머리 위에 떠올랐다가 사라진다.
// 색은 피해 종류로 구분하고, 치명타는 같은 색으로 크게 표시한다.

const DAMAGE_COLORS = {
  physical: '#ff9a2e', // 물리: 주황
  magic: '#4aa8ff', // 마법: 파랑
  true: '#ffffff', // 고정: 흰색 (임시)
};

const DURATION = 0.9; // 초

// 치명타 숫자 앞에 붙는 아이콘 (client/public/images/crit.png)
const critIcon = new Image();
critIcon.src = '/images/crit.png';
const CRIT_ICON_SCALE = 1.1; // 아이콘 높이 = 글자 크기 × 이 값
const CRIT_ICON_GAP = 2; // 아이콘과 숫자 사이 간격
const RISE = 50; // 떠오르는 높이

export function createDamageNumbers() {
  let items = [];

  return {
    /** @param {{ amount: number, crit: boolean }} event  @param {{x:number,y:number}} pos 맞은 위치 */
    add(event, pos) {
      if (event.type === 'manaRestore') {
        items.push({ x: pos.x, y: pos.y + 20, text: `+${Math.round(event.amount)} 마나`, crit: false, color: '#6cb8ff', small: true, start: performance.now() });
        return;
      }
      items.push({
        x: pos.x + (Math.random() - 0.5) * 30, // 겹치지 않게 살짝 흩뿌림 (화면 효과라 Math.random 사용)
        y: pos.y - (event.mark ? 26 : 0), // 표식 피해는 같은 순간의 다른 피해와 겹치지 않게 위에
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
        const size = it.crit ? 30 : it.small ? 15 : 20;
        ctx.font = `bold ${size}px sans-serif`;
        ctx.globalAlpha = 1 - t * t;
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
        const y = it.y - RISE * t;
        let textX = it.x;
        // 치명타: 아이콘 + 숫자를 한 묶음으로 가운데 정렬
        if (it.crit && critIcon.complete && critIcon.naturalWidth > 0) {
          const iconH = size * CRIT_ICON_SCALE;
          const iconW = iconH * (critIcon.naturalWidth / critIcon.naturalHeight);
          const textW = ctx.measureText(it.text).width;
          const left = it.x - (iconW + CRIT_ICON_GAP + textW) / 2;
          ctx.drawImage(critIcon, left, y - iconH / 2, iconW, iconH);
          textX = left + iconW + CRIT_ICON_GAP + textW / 2;
        }
        ctx.strokeText(it.text, textX, y);
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, textX, y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    },
  };
}
