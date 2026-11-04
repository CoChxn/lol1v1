// [개발자 모드] 스탯 조절 패널 (화면 오른쪽 HTML 패널).
// 값을 직접 바꾸지 않고 { type: 'debug', ... } 입력으로 보내서 shared 로직이 처리한다.

// 패널에 보여 줄 스탯: [스탯 이름, 표시 이름, 입력 간격, 소수 자릿수]
const FIELDS = [
  ['hp', '체력', 10, 0],
  ['maxHp', '최대 체력', 10, 0],
  ['mana', '마나', 10, 0],
  ['maxMana', '최대 마나', 10, 0],
  ['attackDamage', '공격력 (AD)', 1, 1],
  ['bonusAttackSpeed', '추가 공격속도 (0.5 = +50%)', 0.1, 2],
  ['armor', '방어력', 1, 1],
  ['critChance', '치명타 확률 (0~1)', 0.05, 2],
  ['critDamage', '치명타 배율', 0.05, 2],
  ['baseMoveSpeed', '기본 이동속도', 5, 0],
  ['slowResist', '둔화 저항 (0~1)', 0.05, 2],
];

const EFFECT_BUTTONS = [
  ['둔화 40% 3초', { kind: 'slow', value: 0.4, duration: 3 }],
  ['이속 +50% 3초', { kind: 'percent', value: 0.5, duration: 3 }],
  ['공속 +100% 3초', { kind: 'attackSpeed', value: 1, duration: 3 }],
  ['치명타 100% 3초', { kind: 'critChance', value: 1, duration: 3 }],
];

const CSS = `
.dev-panel { position: fixed; top: 44px; right: 10px; width: 270px; max-height: calc(100vh - 200px); overflow-y: auto;
  background: rgba(10, 14, 18, 0.88); color: #dde; font: 12px sans-serif; border: 1px solid #455; border-radius: 6px;
  padding: 8px 10px; box-sizing: border-box; user-select: none; }
.dev-panel h3 { margin: 4px 0 6px; font-size: 13px; color: #fd8; }
.dev-panel .tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.dev-panel .tabs button { flex: 1; }
.dev-panel .tabs button.on { background: #3a6; color: #fff; border-color: #5c8; }
.dev-panel label { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin: 3px 0; }
.dev-panel input { width: 80px; background: #111; color: #fff; border: 1px solid #556; border-radius: 3px; padding: 2px 4px; font: 12px monospace; text-align: right; }
.dev-panel input:focus { border-color: #fd8; outline: none; }
.dev-panel button { background: #223; color: #dde; border: 1px solid #556; border-radius: 3px; padding: 4px 6px; font: 12px sans-serif; cursor: pointer; }
.dev-panel button:hover { background: #335; }
.dev-panel .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.dev-panel .hint { color: #889; margin-top: 6px; line-height: 1.4; }
`;

/**
 * @param {object} opts
 * @param {() => object} opts.getState
 * @param {string} opts.myId
 * @param {(input: object) => void} opts.onInput
 * @returns {{ update: (devMode: boolean) => void }}
 */
export function createStatPanel({ getState, myId, onInput }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'dev-panel';
  root.style.display = 'none';
  document.body.appendChild(root);

  let targetId = myId;
  const send = (input) => onInput({ type: 'debug', targetId, ...input });

  // 대상 탭
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  const tabButtons = {};
  for (const [id, label] of [[myId, '나'], ['dummy', '허수아비']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => {
      targetId = id;
      refreshTabs();
      refreshValues(true);
    };
    tabButtons[id] = b;
    tabs.appendChild(b);
  }
  function refreshTabs() {
    for (const id in tabButtons) tabButtons[id].classList.toggle('on', id === targetId);
  }

  // 스탯 입력칸
  const statsTitle = document.createElement('h3');
  statsTitle.textContent = '스탯 (Enter 또는 칸 밖 클릭으로 적용)';
  const inputs = {};
  const statsBox = document.createElement('div');
  for (const [stat, label, step] of FIELDS) {
    const row = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    const apply = () => {
      const value = Number(input.value);
      if (input.value.trim() !== '' && Number.isFinite(value)) send({ action: 'setStat', stat, value });
    };
    input.addEventListener('change', apply);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        apply();
        input.blur();
      }
    });
    row.append(name, input);
    statsBox.appendChild(row);
    inputs[stat] = input;
  }

  // 효과·회복 버튼
  const effectTitle = document.createElement('h3');
  effectTitle.textContent = '효과';
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const [label, effect] of EFFECT_BUTTONS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => send({ action: 'addEffect', effect });
    grid.appendChild(b);
  }
  const clear = document.createElement('button');
  clear.textContent = '효과 모두 제거';
  clear.onclick = () => send({ action: 'clearEffects' });
  const restore = document.createElement('button');
  restore.textContent = '체력·마나 회복';
  restore.onclick = () => send({ action: 'restore' });
  grid.append(clear, restore);

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = '칸에 입력하는 동안에는 게임 키(A, S, 숫자)가 동작하지 않습니다.';

  root.append(tabs, statsTitle, statsBox, effectTitle, grid, hint);
  refreshTabs();

  // 입력 중이 아닌 칸은 현재 값으로 계속 갱신
  function refreshValues(force = false) {
    const p = getState().players[targetId];
    if (!p) return;
    for (const [stat, , , digits] of FIELDS) {
      const input = inputs[stat];
      if (!force && document.activeElement === input) continue;
      let text = Number(p[stat]).toFixed(digits);
      if (text.includes('.')) text = text.replace(/\.?0+$/, ''); // 소수점 뒤 불필요한 0만 제거
      if (input.value !== text) input.value = text;
    }
  }

  let lastRefresh = 0;
  return {
    update(devMode) {
      root.style.display = devMode ? 'block' : 'none';
      if (!devMode) return;
      const now = performance.now();
      if (now - lastRefresh > 100) {
        refreshValues();
        lastRefresh = now;
      }
    },
  };
}
