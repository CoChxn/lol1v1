// 챔피언 목록과 불러오기. (개발 세션 담당)
// 챔피언 숫자 데이터는 각 챔피언 파일(예: ranger.js)에 있다.
import ranger from './ranger.js';

export const CHAMPIONS = {
  ranger,
};

export const DEFAULT_CHAMPION = 'ranger';

export function getChampion(id) {
  const champ = CHAMPIONS[id];
  if (!champ) throw new Error(`Unknown champion: ${id}`);
  return champ;
}
