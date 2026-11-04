// 챔피언 데이터 검사. (개발 세션 담당: 챔피언에 새 항목을 추가하면 SCHEMA에도 추가한다)
// 각 규칙: { type: 'number' | 'string' | 'object' | 'levels' | 'list' | 'skills', min, max, minExclusive, fields, optional, oneOf, of }
// levels: 레벨별 숫자 배열 (길이 SKILL_MAX_LEVEL)
// list: 종류(type)별 규칙이 다른 객체 배열 (of: 'effect' | 'onHit')
// skills: { Q, W, E, R } 각각 SKILL_SCHEMA로 검사
// optional: true면 적지 않아도 된다 (코드에서 기본값 사용)

export const SKILL_MAX_LEVEL = 5;
export const SKILL_KEYS = ['Q', 'W', 'E', 'R'];

// 스킬 규칙: 조준(targeting) / 발동(activation) / 효과(effects) 세 축 (docs/SKILL_DESIGN.md)
// 구현된 값만 허용한다. 새 방식을 구현하면 oneOf와 아래 규칙에 추가한다.
const SKILL_SCHEMA = {
  name: { type: 'string' },
  manaCost: { type: 'levels', min: 0 },
  cooldown: { type: 'levels', min: 0 },
  targeting: {
    type: 'object',
    fields: {
      type: { type: 'string', oneOf: ['direction'] },
      range: { type: 'number', minExclusive: 0 },
      outOfRange: { type: 'string', oneOf: ['maxRange'] },
    },
  },
  activation: {
    type: 'object',
    fields: {
      type: { type: 'string', oneOf: ['normal'] },
      castTime: { type: 'number', min: 0 },
    },
  },
  effects: { type: 'list', of: 'effect' },
};

// 효과 종류별 규칙 (effects 배열의 원소)
const EFFECT_SCHEMAS = {
  projectile: {
    type: { type: 'string' },
    speed: { type: 'number', minExclusive: 0 },
    radius: { type: 'number', minExclusive: 0 },
    collision: { type: 'string', oneOf: ['first', 'pierce'] }, // first: 처음 맞은 적만, pierce: 관통
    targets: { type: 'string', oneOf: ['all', 'champions'], optional: true }, // 맞을 수 있는 대상 (기본 all)
    shape: { type: 'string', oneOf: ['bolt', 'orb'], optional: true }, // 화면에 그리는 모양 (기본 bolt)
    onHit: { type: 'list', of: 'onHit' },
  },
};

// 피해 효과 (적중 시·표식이 터질 때 공통)
const DAMAGE_SCHEMA = {
  type: { type: 'string' },
  damageType: { type: 'string', oneOf: ['physical', 'magic', 'true'] },
  base: { type: 'levels', min: 0 },
  adRatio: { type: 'number', min: 0, optional: true }, // 총 공격력 계수
  bonusAdRatio: { type: 'number', min: 0, optional: true }, // 추가 공격력 계수
  apRatio: { type: 'number', min: 0, optional: true }, // 주문력 계수
};

// 적중 시 효과 종류별 규칙 (onHit 배열의 원소)
const ON_HIT_SCHEMAS = {
  damage: DAMAGE_SCHEMA,
  reduceCooldowns: {
    type: { type: 'string' },
    amount: { type: 'number', min: 0 },
  },
  // 표식 부착: 시전자의 평타나 다른 스킬이 맞히면 터진다. 같은 스킬로 다시 맞히면 시간만 갱신
  applyMark: {
    type: { type: 'string' },
    duration: { type: 'number', minExclusive: 0 },
    onDetonate: { type: 'list', of: 'onDetonate' },
  },
};

// 표식이 터질 때 효과 종류별 규칙 (onDetonate 배열의 원소)
const ON_DETONATE_SCHEMAS = {
  damage: DAMAGE_SCHEMA,
  // 시전자 마나 회복: base + (plusTriggerCost면 터뜨린 스킬의 마나 소모량, 평타면 0)
  restoreMana: {
    type: { type: 'string' },
    base: { type: 'number', min: 0 },
    plusTriggerCost: { type: 'boolean', optional: true },
  },
};

const LIST_KINDS = {
  effect: EFFECT_SCHEMAS,
  onHit: ON_HIT_SCHEMAS,
  onDetonate: ON_DETONATE_SCHEMAS,
};

const SCHEMA = {
  name: { type: 'string' },
  gameplayRadius: { type: 'number', minExclusive: 0 },
  pathingRadius: { type: 'number', minExclusive: 0 },
  selectionRadius: { type: 'number', minExclusive: 0 },
  maxHp: { type: 'number', minExclusive: 0 },
  maxMana: { type: 'number', min: 0 },
  moveSpeed: { type: 'number', minExclusive: 0 },
  armor: { type: 'number', min: 0 },
  magicResist: { type: 'number', min: 0 },
  critChance: { type: 'number', min: 0, max: 1 },
  critDamage: { type: 'number', min: 1 },
  attack: {
    type: 'object',
    fields: {
      type: { type: 'string', optional: true, oneOf: ['ranged', 'melee'] }, // 기본 'ranged'
      range: { type: 'number', minExclusive: 0 },
      damage: { type: 'number', min: 0 }, // 공격력(AD)
      attackSpeed: { type: 'number', minExclusive: 0 }, // 기본 공격속도 b
      attackSpeedRatio: { type: 'number', min: 0, optional: true }, // 공격속도 계수 m, 기본 = b
      windupRatio: { type: 'number', minExclusive: 0, max: 1 }, // 선딜레이 비율 p
      windupModifier: { type: 'number', min: 0, optional: true }, // 선딜레이 보정값 k, 기본 1
      projectileSpeed: { type: 'number', minExclusive: 0, optional: true }, // 원거리면 필수
      projectileRadius: { type: 'number', minExclusive: 0, optional: true }, // 원거리면 필수
    },
  },
  skills: { type: 'skills', optional: true },
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
    if (rule.type === 'list') {
      checkList(value, LIST_KINDS[rule.of], where, errors);
      continue;
    }
    if (rule.type === 'skills') {
      checkSkills(value, where, errors);
      continue;
    }
    if (rule.type === 'levels') {
      const ok =
        Array.isArray(value) &&
        value.length === SKILL_MAX_LEVEL &&
        value.every((v) => typeof v === 'number' && Number.isFinite(v) && (rule.min === undefined || v >= rule.min));
      if (!ok) errors.push(`${where}: 숫자 ${SKILL_MAX_LEVEL}개짜리 배열이어야 합니다${rule.min !== undefined ? ` (각 ${rule.min} 이상)` : ''} (지금: ${JSON.stringify(value)})`);
      continue;
    }
    if (rule.type === 'boolean') {
      if (typeof value !== 'boolean') errors.push(`${where}: true 또는 false여야 합니다 (지금: ${JSON.stringify(value)})`);
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

/** 종류(type)별 규칙이 다른 객체 배열 검사 */
function checkList(list, schemas, path, errors) {
  if (!Array.isArray(list) || list.length === 0) {
    errors.push(`${path}: 비어 있지 않은 배열이어야 합니다`);
    return;
  }
  list.forEach((item, i) => {
    const where = `${path}[${i}]`;
    const schema = schemas[item?.type];
    if (!schema) {
      errors.push(`${where}.type: ${Object.keys(schemas).join(' / ')} 중 하나여야 합니다 (지금: ${item?.type})`);
      return;
    }
    checkFields(item, schema, where, errors);
  });
}

function checkSkills(skills, path, errors) {
  if (typeof skills !== 'object' || skills === null) {
    errors.push(`${path}: 객체여야 합니다`);
    return;
  }
  for (const key in skills) {
    const where = `${path}.${key}`;
    if (!SKILL_KEYS.includes(key)) {
      errors.push(`${where}: 스킬 키는 ${SKILL_KEYS.join(' / ')} 중 하나여야 합니다`);
      continue;
    }
    checkFields(skills[key], SKILL_SCHEMA, where, errors);
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
