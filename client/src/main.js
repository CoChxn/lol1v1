// 클라이언트 진입점: 렌더링, 입력 수집, 서버 통신을 담당한다.
import { io } from 'socket.io-client';
import { TICK_DT, createGameState, update } from '@lol1v1/shared';
import { startLoop } from './game/loop.js';
import { createRenderer } from './render/renderer.js';

// --- 서버 연결 ---
const socket = io();

socket.on('connect', () => {
  console.log('Connected to server', socket.id);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected from server:', reason);
});

// --- 게임 루프 (Phase 2: 로직을 브라우저에서 직접 실행) ---
let state = createGameState();
let pendingInputs = [];

const renderer = createRenderer(document.getElementById('game'));

// [임시, 2-3에서 "내 캐릭터 따라가기"로 교체] 키보드로 카메라 이동
const CAMERA_PAN_SPEED = 900; // 픽셀/초
const cameraFocus = { ...state.map.spawns.blue };
const heldKeys = new Set();
window.addEventListener('keydown', (e) => heldKeys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => heldKeys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => heldKeys.clear());

function panCamera(dt) {
  let dx = 0;
  let dy = 0;
  if (heldKeys.has('a') || heldKeys.has('arrowleft')) dx -= 1;
  if (heldKeys.has('d') || heldKeys.has('arrowright')) dx += 1;
  if (heldKeys.has('w') || heldKeys.has('arrowup')) dy -= 1;
  if (heldKeys.has('s') || heldKeys.has('arrowdown')) dy += 1;
  cameraFocus.x = Math.min(Math.max(cameraFocus.x + dx * CAMERA_PAN_SPEED * dt, 0), state.map.width);
  cameraFocus.y = Math.min(Math.max(cameraFocus.y + dy * CAMERA_PAN_SPEED * dt, 0), state.map.height);
}

startLoop({
  stepDt: TICK_DT,
  step(dt) {
    state = update(state, pendingInputs, dt);
    pendingInputs = [];
    panCamera(dt);
  },
  render() {
    renderer.render(state, cameraFocus);
  },
});
