// 클라이언트 진입점: 렌더링, 입력 수집, 서버 통신을 담당한다.
import { io } from 'socket.io-client';
import { TICK_DT, createGameState, createPlayer, addPlayer, update } from '@lol1v1/shared';
import { startLoop } from './game/loop.js';
import { createRenderer } from './render/renderer.js';
import { setupInput } from './input.js';

// --- 서버 연결 ---
const socket = io();

socket.on('connect', () => {
  console.log('Connected to server', socket.id);
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected from server:', reason);
});

// --- 게임 상태 (Phase 2: 로직을 브라우저에서 직접 실행) ---
const MY_ID = 'local'; // Phase 4에서 서버가 준 ID로 바뀐다

let state = createGameState();
const spawn = state.map.spawns.blue;
state = addPlayer(state, createPlayer({ id: MY_ID, name: 'Player', team: 'blue', x: spawn.x, y: spawn.y }));
let prevState = state;
let pendingInputs = [];

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);

// --- 입력 ---
setupInput(canvas, {
  screenToWorld: (sx, sy) => renderer.camera.screenToWorld(sx, sy),
  onInput(input) {
    pendingInputs.push({ ...input, playerId: MY_ID });
    if (input.type === 'move') renderer.clickMarker.show(input.x, input.y);
  },
});

// --- 게임 루프 ---
startLoop({
  stepDt: TICK_DT,
  step(dt) {
    prevState = state;
    state = update(state, pendingInputs, dt);
    pendingInputs = [];
  },
  render(alpha) {
    renderer.render(prevState, state, alpha, MY_ID);
  },
});

// 개발용: 브라우저 콘솔에서 상태 확인 (window.__game.state)
if (import.meta.env.DEV) {
  window.__game = { get state() { return state; } };
}
