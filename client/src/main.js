// 클라이언트 진입점: 렌더링, 입력 수집, 서버 통신을 담당한다.
import { io } from 'socket.io-client';
import { TICK_DT, createGameState, createPlayer, addPlayer, update } from '@lol1v1/shared';
import { startLoop } from './game/loop.js';
import { createRenderer } from './render/renderer.js';
import { setupInput } from './input.js';
import { createDevMode } from './dev/devMode.js';

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
// 연습용 허수아비: 입력을 받지 않으므로 움직이지 않는다 (Phase 3 전투 테스트용)
state = addPlayer(state, createPlayer({ id: 'dummy', name: 'Dummy', team: 'red', x: spawn.x + 1100, y: spawn.y, isDummy: true }));
let prevState = state;
let pendingInputs = [];

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const devMode = createDevMode();

// --- 입력 ---
// 클릭한 지점의 적 찾기: 선택 반경(selectionRadius) 안에 있는 적 중 마우스에 가장 가까운 적.
// (클릭은 넉넉하게 선택 반경, 공격 판정은 정확하게 게임플레이 반경. 실제 공격 가능 여부는 shared 로직이 다시 확인한다)
function pickEnemy(wx, wy) {
  const me = state.players[MY_ID];
  let best = null;
  let bestDist = Infinity;
  for (const id in state.players) {
    const p = state.players[id];
    if (p.team === me.team || p.hp <= 0 || p.targetable === false) continue;
    const d = Math.hypot(p.x - wx, p.y - wy);
    if (d <= p.selectionRadius && d < bestDist) {
      best = id;
      bestDist = d;
    }
  }
  return best;
}

const inputControl = setupInput(canvas, {
  screenToWorld: (sx, sy) => renderer.camera.screenToWorld(sx, sy),
  pickEnemy,
  getDummyArmor: () => state.players.dummy?.armor,
  isDevMode: devMode.isEnabled,
  onInput(input) {
    pendingInputs.push({ ...input, playerId: MY_ID });
    if (input.type === 'move') renderer.clickMarker.show(input.x, input.y);
    if (input.type === 'attackMove') renderer.clickMarker.show(input.x, input.y, '255, 90, 90');
  },
});

// --- 게임 루프 ---
startLoop({
  stepDt: TICK_DT,
  step(dt) {
    prevState = state;
    state = update(state, pendingInputs, dt);
    pendingInputs = [];
    // 이번 틱 이벤트 → 화면 효과
    for (const ev of state.events) {
      const target = state.players[ev.targetId];
      if (ev.type === 'damage' && target) {
        renderer.damageNumbers.add(ev, { x: target.x, y: target.y - target.gameplayRadius - 40 });
      }
      renderer.combatLog.add(ev, state);
    }
  },
  render(alpha) {
    renderer.render(prevState, state, alpha, MY_ID, { attackMoveMode: inputControl.isAttackMoveMode(), devMode: devMode.isEnabled() });
  },
});

// 개발용: 브라우저 콘솔에서 상태 확인 (window.__game.state)
if (import.meta.env.DEV) {
  window.__game = { get state() { return state; } };
}
