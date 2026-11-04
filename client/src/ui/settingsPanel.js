// 설정 창: 왼쪽 아래 ⚙ 버튼으로 열고 닫는다. 스킬 키별 입력 방식을 고른다.
import { CAST_MODES } from './settings.js';

const CSS = `
.settings-btn { position: fixed; left: 10px; bottom: 10px; background: rgba(10, 14, 18, 0.8); color: #dde;
  border: 1px solid #455; border-radius: 6px; padding: 6px 10px; font: 13px sans-serif; cursor: pointer; }
.settings-btn:hover { background: rgba(40, 50, 70, 0.9); }
.settings-panel { position: fixed; left: 10px; bottom: 48px; width: 330px; background: rgba(10, 14, 18, 0.94);
  color: #dde; font: 13px sans-serif; border: 1px solid #455; border-radius: 6px; padding: 10px 12px; box-sizing: border-box; }
.settings-panel h3 { margin: 0 0 8px; font-size: 14px; color: #fd8; }
.settings-panel label { display: flex; justify-content: space-between; align-items: center; margin: 6px 0; }
.settings-panel select { background: #111; color: #fff; border: 1px solid #556; border-radius: 3px; padding: 3px 4px; font: 13px sans-serif; }
.settings-panel .hint { color: #99a; font-size: 12px; line-height: 1.5; margin-top: 8px; }
`;

export function createSettingsPanel(settings) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.className = 'settings-btn';
  button.textContent = '⚙ 설정';
  document.body.appendChild(button);

  const panel = document.createElement('div');
  panel.className = 'settings-panel';
  panel.style.display = 'none';
  document.body.appendChild(panel);

  const title = document.createElement('h3');
  title.textContent = '스킬 입력 방식';
  panel.appendChild(title);

  for (const key of ['Q', 'W', 'E', 'R']) {
    const row = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = key;
    const select = document.createElement('select');
    for (const mode in CAST_MODES) {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = CAST_MODES[mode];
      select.appendChild(option);
    }
    select.value = settings.getCastMode(key);
    select.addEventListener('change', () => {
      settings.setCastMode(key, select.value);
      select.blur();
    });
    row.append(name, select);
    panel.appendChild(row);
  }

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.innerHTML =
    '일반: 키를 누르면 범위 표시 → 좌클릭으로 시전<br>' +
    '빠른(스마트키): 키를 누르는 순간 커서 방향으로 시전<br>' +
    '표시기와 함께 빠른: 누르는 동안 범위 표시 → 떼면 시전<br>' +
    '취소: 우클릭, Esc, A, S (빠른 시전은 취소 불가)';
  panel.appendChild(hint);

  button.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    button.blur();
  });
}
