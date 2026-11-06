// [개발자 모드] 카메라 표시: 화면 끝 감지 영역(15픽셀 띠), 카메라 위치·배율, 마우스 아래 월드 좌표.
import { EDGE_PAN_WIDTH } from '../../ui/cameraControl.js';

export function drawCameraDebug(ctx, camera, status) {
  const w = camera.viewWidth;
  const h = camera.viewHeight;
  const e = EDGE_PAN_WIDTH;

  // 화면 끝 감지 영역 (자유 모드에서 마우스가 닿은 쪽은 진하게)
  const base = status.mode === 'free' ? 'rgba(255, 220, 80, 0.12)' : 'rgba(255, 255, 255, 0.05)';
  const hot = 'rgba(255, 220, 80, 0.45)';
  ctx.fillStyle = status.edge.y < 0 ? hot : base;
  ctx.fillRect(0, 0, w, e);
  ctx.fillStyle = status.edge.y > 0 ? hot : base;
  ctx.fillRect(0, h - e, w, e);
  ctx.fillStyle = status.edge.x < 0 ? hot : base;
  ctx.fillRect(0, e, e, h - 2 * e);
  ctx.fillStyle = status.edge.x > 0 ? hot : base;
  ctx.fillRect(w - e, e, e, h - 2 * e);

  // 화면 가운데 표시
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 8, h / 2);
  ctx.lineTo(w / 2 + 8, h / 2);
  ctx.moveTo(w / 2, h / 2 - 8);
  ctx.lineTo(w / 2, h / 2 + 8);
  ctx.stroke();

  // 수치
  const mouseWorld = status.mouse ? camera.screenToWorld(status.mouse.x, status.mouse.y) : null;
  const lines = [
    `[카메라] ${status.mode === 'locked' ? '고정' : '자유'}${status.followHeld ? ' (Space/F1 따라가는 중)' : ''}  배율 ×${status.zoom.toFixed(2)}`,
    `  화면 가운데 월드 ${camera.x.toFixed(0)}, ${camera.y.toFixed(0)}`,
    `  마우스 아래 월드 ${mouseWorld ? `${mouseWorld.x.toFixed(0)}, ${mouseWorld.y.toFixed(0)}` : '-'}`,
    '  Y: 모드 전환  Space/F1: 내 캐릭터  휠: 확대 (개발자 모드 0.3~3배)',
  ];
  ctx.font = '13px monospace';
  const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
  // 화면 위 가운데 (시간 조절 표시 아래)
  const x = Math.round(w / 2 - boxW / 2);
  const y = 52;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(x, y, boxW, lines.length * 17 + 14);
  ctx.fillStyle = '#9df';
  lines.forEach((l, i) => ctx.fillText(l, x + 10, y + 20 + i * 17));
}
