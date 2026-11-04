// 개발자 모드 상태 (F2로 켜고 끔). 켜짐 여부는 브라우저에 저장해서 새로고침해도 유지한다.
// 개발자 모드는 화면·입력 편의 기능만 담당하고, 게임 판정은 하지 않는다.

const STORAGE_KEY = 'lol1v1.devMode';

function load() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function save(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // 저장이 막힌 환경(시크릿 창 등)에서는 저장하지 않는다
  }
}

export function createDevMode() {
  let enabled = load();

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F2') return;
    e.preventDefault();
    enabled = !enabled;
    save(enabled);
  });

  return {
    isEnabled: () => enabled,
  };
}
