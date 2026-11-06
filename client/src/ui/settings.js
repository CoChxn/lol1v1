// 플레이어 설정 (브라우저에 저장). 화면·입력 편의 기능이며 게임 판정과 무관하다.
// - castModes: 스킬 키별 입력 방식 (docs/SKILL_DESIGN.md 4번)
//   'normal'         일반 시전: 키를 누르면 범위 표시, 좌클릭으로 시전
//   'quick'          빠른 시전(스마트키): 키를 누르는 순간 커서 방향으로 시전
//   'quickIndicator' 표시기와 함께 빠른 시전: 누르는 동안 범위 표시, 떼면 시전
// - camera: 카메라 (client/src/ui/cameraControl.js)
//   mode        'locked' 고정(내 캐릭터 따라가기) / 'free' 자유(화면 끝으로 이동). Y로 바꾸면 저장된다
//   offsetMode  'perSide' 진영별 오프셋 / 'fixed' 고정 오프셋
//   panSpeed    자유 카메라 이동 속도 (월드 단위/초, 1000~4000)
//   zoom        확대 배율 (1.0~1.5)

const STORAGE_KEY = 'lol1v1.settings';

export const CAST_MODES = {
  normal: '일반 시전',
  quick: '빠른 시전 (스마트키)',
  quickIndicator: '표시기와 함께 빠른 시전',
};

export const CAMERA_MODES = { locked: '고정', free: '자유' };
export const CAMERA_OFFSET_MODES = { perSide: '진영별 오프셋', fixed: '고정 오프셋' };
export const PAN_SPEED_RANGE = { min: 1000, max: 4000 };
export const ZOOM_RANGE = { min: 1, max: 1.5 };

const DEFAULTS = {
  castModes: { Q: 'normal', W: 'normal', E: 'normal', R: 'normal' },
  camera: { mode: 'locked', offsetMode: 'perSide', panSpeed: 2500, zoom: 1 },
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const castModes = { ...DEFAULTS.castModes };
    for (const key in castModes) {
      if (saved.castModes?.[key] in CAST_MODES) castModes[key] = saved.castModes[key];
    }
    const c = saved.camera ?? {};
    const camera = {
      mode: c.mode in CAMERA_MODES ? c.mode : DEFAULTS.camera.mode,
      offsetMode: c.offsetMode in CAMERA_OFFSET_MODES ? c.offsetMode : DEFAULTS.camera.offsetMode,
      panSpeed: Number.isFinite(c.panSpeed) ? clamp(c.panSpeed, PAN_SPEED_RANGE.min, PAN_SPEED_RANGE.max) : DEFAULTS.camera.panSpeed,
      zoom: Number.isFinite(c.zoom) ? clamp(c.zoom, ZOOM_RANGE.min, ZOOM_RANGE.max) : DEFAULTS.camera.zoom,
    };
    return { castModes, camera };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function createSettings() {
  const settings = load();
  const listeners = [];

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장이 막힌 환경에서는 이번 접속 동안만 유지
    }
    for (const fn of listeners) fn();
  }

  return {
    /** 설정이 바뀔 때마다 호출 (설정 창 갱신용) */
    onChange: (fn) => listeners.push(fn),
    getCamera: () => ({ ...settings.camera }),
    setCamera(patch) {
      const c = settings.camera;
      if (patch.mode in CAMERA_MODES) c.mode = patch.mode;
      if (patch.offsetMode in CAMERA_OFFSET_MODES) c.offsetMode = patch.offsetMode;
      if (Number.isFinite(patch.panSpeed)) c.panSpeed = clamp(patch.panSpeed, PAN_SPEED_RANGE.min, PAN_SPEED_RANGE.max);
      if (Number.isFinite(patch.zoom)) c.zoom = clamp(patch.zoom, ZOOM_RANGE.min, ZOOM_RANGE.max);
      save();
    },
    getCastMode: (key) => settings.castModes[key] ?? 'normal',
    setCastMode(key, mode) {
      if (!(mode in CAST_MODES) || !(key in settings.castModes)) return;
      settings.castModes[key] = mode;
      save();
    },
  };
}
