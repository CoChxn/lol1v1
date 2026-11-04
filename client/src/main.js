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

startLoop({
  stepDt: TICK_DT,
  step(dt) {
    state = update(state, pendingInputs, dt);
    pendingInputs = [];
  },
  render() {
    renderer.render(state);
  },
});
