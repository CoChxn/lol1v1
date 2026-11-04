// 챔피언 데이터 검사. (개발 세션 담당: 챔피언에 새 항목을 추가하면 SCHEMA에도 추가한다)
// 각 규칙: { type: 'number' | 'string' | 'object', min, max, minExclusive, fields }

const SCHEMA = {
  name: { type: 'string' },
  gameplayRadius: { type: 'number', minExclusive: 0 },
  pathingRadius: { type: 'number', minExclusive: 0 },
  maxHp: { type: 'number', minExclusive: 0 },
  maxMana: { type: 'number', min: 0 },
  moveSpeed: { type: 'number', minExclusive: 0 },
  attack: {
    type: 'object',
    fields: {
      range: { type: 'number', minExclusive: 0 },
      damage: { type: 'number', min: 0 },
      attackSpeed: { type: 'number', minExclusive: 0 },
      windupRatio: { type: 'number', minExclusive: 0, max: 1 },
      projectileSpeed: { type: 'number', minExclusive: 0 },
      projectileRadius: { type: 'number', minExclusive: 0 },
    },
  },
};

function checkFields(data, schema, path, errors) {
  if (typeof data !== 'object' || data === null) {
    errors.push(`${path}: 객체여야 합니다`);
    return;
  }
  for (const key in schema) {
    const rule = schema[key];
    const value = data[key];
    const where = path ? `${path}.${key}` : key;
    if (value === undefined) {
      errors.push(`${where}: 항목이 없습니다`);
      continue;
    }
    if (rule.type === 'object') {
      checkFields(value, rule.fields, where, errors);
      continue;
    }
    if (rule.type === 'string') {
      if (typeof value !== 'string' || value.length === 0) errors.push(`${where}: 비어 있지 않은 문자열이어야 합니다`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${where}: 숫자여야 합니다 (지금: ${JSON.stringify(value)})`);
      continue;
    }
    if (rule.min !== undefined && value < rule.min) errors.push(`${where}: ${rule.min} 이상이어야 합니다 (지금: ${value})`);
    if (rule.minExclusive !== undefined && value <= rule.minExclusive) errors.push(`${where}: ${rule.minExclusive}보다 커야 합니다 (지금: ${value})`);
    if (rule.max !== undefined && value > rule.max) errors.push(`${where}: ${rule.max} 이하여야 합니다 (지금: ${value})`);
  }
  // 오타로 생긴 모르는 항목 찾기
  for (const key in data) {
    if (!(key in schema)) errors.push(`${path ? `${path}.` : ''}${key}: 모르는 항목입니다 (오타인지 확인)`);
  }
}

/** @returns {string[]} 오류 목록 (비어 있으면 통과) */
export function validateChampion(data) {
  const errors = [];
  checkFields(data, SCHEMA, '', errors);
  if (typeof data.pathingRadius === 'number' && typeof data.gameplayRadius === 'number' && data.pathingRadius > data.gameplayRadius) {
    errors.push(`pathingRadius(${data.pathingRadius})는 gameplayRadius(${data.gameplayRadius})보다 클 수 없습니다`);
  }
  return errors;
}
