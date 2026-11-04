// 클라이언트 진입점: 렌더링, 입력 수집, 서버 통신을 담당한다.
import { io } from 'socket.io-client';
import { TICK_DT, createGameState, createPlayer, addPlayer, update, getSkillData } from '@lol1v1/shared';
import { startLoop } from './game/loop.js';
import { createRenderer } from './render/renderer.js';
import { setupInput } from './input.js';
import { createDevMode } from './dev/devMode.js';
import { createStatPanel } from './dev/statPanel.js';
import { createTimeControl } from './dev/timeControl.js';
import { createSettings } from './ui/settings.js';
import { createSettingsPanel } from './ui/settingsPanel.js';

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

// 처음 상태 (개발자 모드 "전체 초기화"도 이 함수를 쓴다. Phase 4에서는 서버가 만든다)
function createInitialState() {
  let s = createGameState();
  const spawn = s.map.spawns.blue;
  s = addPlayer(s, createPlayer({ id: MY_ID, name: 'Player', team: 'blue', x: spawn.x, y: spawn.y }));
  // 연습용 허수아비 (개발자 모드에서 행동을 바꿀 수 있다)
  s = addPlayer(s, createPlayer({ id: 'dummy', name: 'Dummy', team: 'red', x: spawn.x + 1100, y: spawn.y, isDummy: true }));
  return s;
}

let state = createInitialState();
let prevState = state;
let pendingInputs = [];

const canvas = document.getElementById('game');
const renderer = createRenderer(canvas);
const devMode = createDevMode();
const timeControl = createTimeControl(devMode.isEnabled);
const settings = createSettings();
createSettingsPanel(settings);

// 스킬 키의 실제 입력 방식: 설정값. 단, 지정할 대상이 없는 스킬(자동·자기·근접 조준)은 항상 빠른 시전
const ALWAYS_QUICK_TARGETING = ['auto', 'self', 'proximity'];
function getCastMode(skill) {
  const me = state.players[MY_ID];
  const data = me && getSkillData(me, skill);
  if (data && ALWAYS_QUICK_TARGETING.includes(data.targeting.type)) return 'quick';
  return settings.getCastMode(skill);
}

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

function sendInput(input) {
  pendingInputs.push({ ...input, playerId: MY_ID });
}

function resetGame() {
  state = createInitialState();
  prevState = state;
  pendingInputs = [];
}

const statPanel = createStatPanel({ getState: () => state, myId: MY_ID, onInput: sendInput, timeControl, onReset: resetGame });

const inputControl = setupInput(canvas, {
  screenToWorld: (sx, sy) => renderer.camera.screenToWorld(sx, sy),
  pickEnemy,
  getDummyArmor: () => state.players.dummy?.armor,
  isDevMode: devMode.isEnabled,
  getCastMode,
  onInput(input) {
    sendInput(input);
    if (input.type === 'move') renderer.clickMarker.show(input.x, input.y);
    if (input.type === 'attackMove') renderer.clickMarker.show(input.x, input.y, '255, 90, 90');
  },
});

// --- 게임 루프 ---
startLoop({
  stepDt: TICK_DT,
  getScale: timeControl.getScale,
  isPaused: timeControl.isPaused,
  takeStepRequest: timeControl.takeStepRequest,
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
      if (ev.type === 'manaRestore' && target && ev.amount > 0) {
        renderer.damageNumbers.add(ev, { x: target.x, y: target.y - target.gameplayRadius - 40 });
      }
      renderer.combatLog.add(ev, state);
    }
  },
  render(alpha) {
    statPanel.update(devMode.isEnabled());
    renderer.render(prevState, state, alpha, MY_ID, { attackMoveMode: inputControl.isAttackMoveMode(), devMode: devMode.isEnabled(), time: timeControl.status(), aim: inputControl.getAim() });
  },
});

// 개발용: 브라우저 콘솔에서 상태 확인 (window.__game.state)
if (import.meta.env.DEV) {
  window.__game = { get state() { return state; } };
}
