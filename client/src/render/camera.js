// 카메라: 월드 좌표(픽셀) ↔ 화면 좌표 변환.
// x, y는 화면 가운데에 보이는 월드 좌표.

/**
 * @param {number} margin  맵 바깥으로 보여 줄 여유(벽 두께 등)
 */
export function createCamera(margin = 0) {
  const cam = {
    x: 0,
    y: 0,
    viewWidth: 0,
    viewHeight: 0,

    setViewport(width, height) {
      cam.viewWidth = width;
      cam.viewHeight = height;
    },

    /** 목표 지점을 화면 가운데로. 맵(+여유) 밖은 보이지 않게 제한한다. */
    follow(targetX, targetY, mapWidth, mapHeight) {
      cam.x = clampAxis(targetX, cam.viewWidth, mapWidth, margin);
      cam.y = clampAxis(targetY, cam.viewHeight, mapHeight, margin);
    },

    /** 그리기 전에 호출: 이후 ctx 좌표는 월드 좌표가 된다. */
    apply(ctx) {
      ctx.setTransform(1, 0, 0, 1, Math.round(cam.viewWidth / 2 - cam.x), Math.round(cam.viewHeight / 2 - cam.y));
    },

    screenToWorld(sx, sy) {
      return { x: sx - cam.viewWidth / 2 + cam.x, y: sy - cam.viewHeight / 2 + cam.y };
    },
  };
  return cam;
}

function clampAxis(target, view, size, margin) {
  const min = -margin + view / 2;
  const max = size + margin - view / 2;
  // 화면이 맵보다 크면 맵을 가운데에 둔다.
  if (min > max) return size / 2;
  return Math.min(Math.max(target, min), max);
}
