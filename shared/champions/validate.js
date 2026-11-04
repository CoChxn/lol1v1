// 챔피언 데이터 검사. (개발 세션 담당: 챔피언에 새 항목을 추가하면 SCHEMA에도 추가한다)
// 각 규칙: { type: 'number' | 'string' | 'object', min, max, minExclusive, fields, optional, oneOf }
// optional: true면 적지 않아도 된다 (코드에서 기본값 사용)

const SCHEMA = {
  name: { type: 'string' },
  gameplayRadius: { type: 'number', minExclusive: 0 },
  pathingRadius: { type: 'number', minExclusive: 0 },
  selectionRadius: { type: 'number', minExclusive: 0 },
  maxHp: { type: 'number', minExclusive: 0 },
  maxMana: { type: 'number', min: 0 },
  moveSpeed: { type: 'number', minExclusive: 0 },
  attack: {
    type: 'object',
    fields: {
      type: { type: 'string', optional: true, oneOf: ['ranged', 'melee'] }, // 기본 'ranged'
      range: { type: 'number', minExclusive: 0 },
      damage: { type: 'number', min: 0 },
      attackSpeed: { type: 'number', minExclusive: 0 }, // 기본 공격속도 b
      attackSpeedRatio: { type: 'number', min: 0, optional: true }, // 공격속도 계수 m, 기본 = b
      windupRatio: { type: 'number', minExclusive: 0, max: 1 }, // 선딜레이 비율 p
      windupModifier: { type: 'number', min: 0, optional: true }, // 선딜레이 보정값 k, 기본 1
      projectileSpeed: { type: 'number', minExclusive: 0, optional: true }, // 원거리면 필수
      projectileRadius: { type: 'number', minExclusive: 0, optional: true }, // 원거리면 필수
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
      if (!rule.optional) errors.push(`${where}: 항목이 없습니다`);
      continue;
    }
    if (rule.type === 'object') {
      checkFields(value, rule.fields, where, errors);
      continue;
    }
    if (rule.type === 'string') {
      if (typeof value !== 'string' || value.length === 0) errors.push(`${where}: 비어 있지 않은 문자열이어야 합니다`);
      else if (rule.oneOf && !rule.oneOf.includes(value)) errors.push(`${where}: ${rule.oneOf.join(' / ')} 중 하나여야 합니다 (지금: ${value})`);
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
  // 원거리 평타는 투사체 정보가 필요하다
  const atk = data.attack;
  if (atk && typeof atk === 'object' && (atk.type ?? 'ranged') === 'ranged') {
    for (const key of ['projectileSpeed', 'projectileRadius']) {
      if (atk[key] === undefined) errors.push(`attack.${key}: 원거리 평타(type: 'ranged')에는 필요합니다`);
    }
  }
  return errors;
}
