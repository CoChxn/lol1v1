// 카메라: 월드 좌표 ↔ 화면 좌표 변환. (화면 쪽 기능, 게임 판정과 무관)
// - x, y: 화면 가운데에 보이는 월드 좌표
// - zoom: 확대 배율 (1 = 월드 1이 화면 1픽셀, 1.5 = 1.5배 크게 보임)
// 어디를 볼지(모드·오프셋·이동)는 client/src/ui/cameraControl.js가 정한다.

/**
 * @param {number} margin  맵 바깥으로 보여 줄 여유 (벽 두께 등, 월드 단위)
 */
export function createCamera(margin = 0) {
  const cam = {
    x: 0,
    y: 0,
    zoom: 1,
    viewWidth: 0, // 화면 크기 (픽셀)
    viewHeight: 0,

    setViewport(width, height) {
      cam.viewWidth = width;
      cam.viewHeight = height;
    },

    /** 화면에 보이는 월드 크기 */
    worldViewWidth: () => cam.viewWidth / cam.zoom,
    worldViewHeight: () => cam.viewHeight / cam.zoom,

    /** 화면 가운데를 (x, y)로. 맵(+여유) 밖은 보이지 않게 제한한다. */
    lookAt(x, y, mapWidth, mapHeight) {
      cam.x = clampAxis(x, cam.worldViewWidth(), mapWidth, margin);
      cam.y = clampAxis(y, cam.worldViewHeight(), mapHeight, margin);
    },

    /** 그리기 전에 호출: 이후 ctx 좌표는 월드 좌표가 된다. */
    apply(ctx) {
      const z = cam.zoom;
      ctx.setTransform(z, 0, 0, z, Math.round(cam.viewWidth / 2 - cam.x * z), Math.round(cam.viewHeight / 2 - cam.y * z));
    },

    screenToWorld(sx, sy) {
      return {
        x: (sx - cam.viewWidth / 2) / cam.zoom + cam.x,
        y: (sy - cam.viewHeight / 2) / cam.zoom + cam.y,
      };
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
