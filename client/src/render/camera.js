// 카메라: 월드 좌표 ↔ 화면 좌표 변환. (화면 쪽 기능, 게임 판정과 무관)
// - x, y: 화면 가운데에 보이는 월드 좌표
// - zoom: 확대 배율 (1 = 월드 1이 화면 1픽셀, 1.5 = 1.5배 크게 보임)
// - angle: 화면 회전 (기본 0 = 돌리지 않음). 아레나의 대각선 통로는 월드 안에 실제로 대각선으로 놓여 있다.
// 어디를 볼지(모드·오프셋·이동)는 client/src/ui/cameraControl.js가 정한다.

export const VIEW_ANGLE = 0;

/**
 * @param {number} margin  맵 바깥으로 보여 줄 여유 (벽 두께 등, 월드 단위)
 */
export function createCamera(margin = 0, angle = VIEW_ANGLE) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const cam = {
    x: 0,
    y: 0,
    zoom: 1,
    angle,
    viewWidth: 0, // 화면 크기 (픽셀)
    viewHeight: 0,

    setViewport(width, height) {
      cam.viewWidth = width;
      cam.viewHeight = height;
    },

    /** 화면 직사각형이 월드 x·y축 방향으로 덮는 절반 길이 (회전 반영) */
    worldHalfExtents() {
      const w = cam.viewWidth / cam.zoom;
      const h = cam.viewHeight / cam.zoom;
      return {
        x: (w * Math.abs(cos) + h * Math.abs(sin)) / 2,
        y: (w * Math.abs(sin) + h * Math.abs(cos)) / 2,
      };
    },

    /** 화면 가운데를 (x, y)로. 맵(+여유) 밖은 보이지 않게 제한한다. */
    lookAt(x, y, mapWidth, mapHeight) {
      const ext = cam.worldHalfExtents();
      cam.x = clampAxis(x, ext.x, mapWidth, margin);
      cam.y = clampAxis(y, ext.y, mapHeight, margin);
    },

    /** 그리기 전에 호출: 이후 ctx 좌표는 월드 좌표가 된다 (확대·회전 포함) */
    apply(ctx) {
      const z = cam.zoom;
      ctx.setTransform(
        z * cos,
        z * sin,
        -z * sin,
        z * cos,
        Math.round(cam.viewWidth / 2 - z * (cos * cam.x - sin * cam.y)),
        Math.round(cam.viewHeight / 2 - z * (sin * cam.x + cos * cam.y)),
      );
    },

    worldToScreen(wx, wy) {
      const dx = wx - cam.x;
      const dy = wy - cam.y;
      return {
        x: cam.viewWidth / 2 + cam.zoom * (cos * dx - sin * dy),
        y: cam.viewHeight / 2 + cam.zoom * (sin * dx + cos * dy),
      };
    },

    screenToWorld(sx, sy) {
      const dx = (sx - cam.viewWidth / 2) / cam.zoom;
      const dy = (sy - cam.viewHeight / 2) / cam.zoom;
      return { x: cam.x + cos * dx + sin * dy, y: cam.y - sin * dx + cos * dy };
    },

    /** 화면 방향(벡터)을 월드 방향으로 */
    screenDirToWorld(vx, vy) {
      return { x: cos * vx + sin * vy, y: -sin * vx + cos * vy };
    },
  };
  return cam;
}

function clampAxis(target, halfView, size, margin) {
  const min = -margin + halfView;
  const max = size + margin - halfView;
  // 화면이 맵보다 크면 맵을 가운데에 둔다.
  if (min > max) return size / 2;
  return Math.min(Math.max(target, min), max);
}
