export const Otherwise = Symbol('TypeOtherwise');

function noop() {}

function TRUE() {
  return true;
}

function setsEqual(a, b) {
  if (a.size !== b.size) {
    return false;
  }
  const ait = a.values();
  let result = ait.next();
  while (!result.done) {
    if (!b.has(result.value)) {
      return false;
    }
    result = ait.next();
  }
  return true;
}

function normalizeNames(names) {
  return names.filter(Boolean).map((n) => `${n[0].toUpperCase()}${n.substr(1)}`);
}

function getTypeName(obj) {
  // eslint-disable-next-line no-underscore-dangle
  return (obj && obj._type) || undefined;
}

function getTagName(obj) {
  // eslint-disable-next-line no-underscore-dangle
  return (obj && obj._tag) || undefined;
}

function getValues(obj) {
  // eslint-disable-next-line no-underscore-dangle
  return (obj && obj._values) || [];
}

function createConstructor(typeName, name, params) {
  return (...args) => {
    if (args.length !== params.length) {
      throw new Error(`Constructor ${typeName}.${name} takes ${params.length} args`);
    }
    // validate parameters
    params.forEach((p, i) => {
      if (Array.isArray(p)) {
        const [paramName, validator = TRUE] = p;
        if (!validator(args[i])) {
          throw new Error(`Arg ${paramName} does not validate for ${typeName}.${name}`);
        }
      }
    });
    return {
      _type: typeName,
      _tag: name,
      _values: args,
    };
  };
}

function createCaseFunc(typeName, names) {
  const nameSet = new Set(names);
  return (obj, cases) => {
    if (!obj || getTypeName(obj) !== typeName) {
      throw new Error(`Cannot case on ${typeName} with object ${JSON.stringify(obj)}`);
    }
    const caseKeys = new Set(Object.keys(cases));
    if (!(Otherwise in cases) && !setsEqual(nameSet, caseKeys)) {
      throw new Error('Cases are not exhaustive');
    }
    const tagName = getTagName(obj);
    if (tagName in cases) {
      return cases[tagName](...getValues(obj));
    }
    return cases[Otherwise](...getValues(obj));
  };
}

function generateHelpers(typeName, ctorNames) {
  const helpers = {
    case: createCaseFunc(typeName, ctorNames),
  };

  ctorNames.forEach((name) => {
    /**
     * Determines if a given obj is of the correct tag
     */
    const is = (obj) => getTagName(obj) === name;

    /**
     * If obj matches type, then returns result of function
     * If obj does not match type, then returns undefined
     */
    const map = (obj, fn) => helpers.case(obj, {
      [name]: (...args) => fn(...args),
      [Otherwise]: noop,
    });

    /**
     * Filters only for the specific tag.
     */
    const only = (objs) => objs.filter((obj) => is(obj));

    /**
     * Filters all but this tag.
     */
    const not = (objs) => objs.filter((obj) => !is(obj));

    const nameSpecificHelpers = {
      [`is${name}`]: is,
      [`map${name}`]: map,
      [`only${name}`]: only,
      [`not${name}`]: not,
    };
    Object.assign(helpers, nameSpecificHelpers);
  });

  return helpers;
}

export function newArgValidator(validator) {
  return (name) => [name, validator];
}

export function newSumType(typeName, constructorSpec) {
  const type = {
    _name: typeName,
  };
  let ctors = [];
  if (Array.isArray(constructorSpec)) {
    ctors = normalizeNames(constructorSpec).map((name) => ({ name, params: [] }));
  } else {
    ctors = normalizeNames(Object.keys(constructorSpec)).map((name) => ({
      name,
      params: constructorSpec[name],
    }));
  }
  for (let i = 0; i < ctors.length; i += 1) {
    const { name, params } = ctors[i];
    type[name] = createConstructor(typeName, name, params);
  }

  const constructorNames = ctors.map((ctor) => ctor.name);
  const helpers = generateHelpers(typeName, constructorNames);
  Object.assign(type, helpers);

  return type;
}
