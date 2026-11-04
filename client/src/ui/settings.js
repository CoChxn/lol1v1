// 플레이어 설정 (브라우저에 저장). 화면·입력 편의 기능이며 게임 판정과 무관하다.
// - castModes: 스킬 키별 입력 방식 (docs/SKILL_DESIGN.md 4번)
//   'normal'         일반 시전: 키를 누르면 범위 표시, 좌클릭으로 시전
//   'quick'          빠른 시전(스마트키): 키를 누르는 순간 커서 방향으로 시전
//   'quickIndicator' 표시기와 함께 빠른 시전: 누르는 동안 범위 표시, 떼면 시전

const STORAGE_KEY = 'lol1v1.settings';

export const CAST_MODES = {
  normal: '일반 시전',
  quick: '빠른 시전 (스마트키)',
  quickIndicator: '표시기와 함께 빠른 시전',
};

const DEFAULTS = {
  castModes: { Q: 'normal', W: 'normal', E: 'normal', R: 'normal' },
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const castModes = { ...DEFAULTS.castModes };
    for (const key in castModes) {
      if (saved.castModes?.[key] in CAST_MODES) castModes[key] = saved.castModes[key];
    }
    return { castModes };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function createSettings() {
  const settings = load();

  return {
    getCastMode: (key) => settings.castModes[key] ?? 'normal',
    setCastMode(key, mode) {
      if (!(mode in CAST_MODES) || !(key in settings.castModes)) return;
      settings.castModes[key] = mode;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        // 저장이 막힌 환경에서는 이번 접속 동안만 유지
      }
    },
  };
}
