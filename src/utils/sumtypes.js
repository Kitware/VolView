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

function createConstructor(typeName, name, params) {
  return (...args) => {
    if (args.length !== params.length) {
      throw new Error(`Constructor ${typeName}.${name} takes ${params.length} args`);
    }
    // validate parameters
    params.forEach((p, i) => {
      if (Array.isArray(p)) {
        const validator = p[1] || TRUE;
        if (!validator(args[i])) {
          throw new Error(`Arg ${name} does not validate for ${typeName}.${name}`);
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
    /* eslint-disable no-underscore-dangle */
    if (!obj || obj._type !== typeName) {
      throw new Error(`Cannot case on ${typeName} with object ${JSON.stringify(obj)}`);
    }
    const caseKeys = new Set(Object.keys(cases));
    if (!setsEqual(nameSet, caseKeys)) {
      throw new Error('Cases are not exhaustive');
    }
    // in the event _values is somehow not set, use empty list.
    return cases[obj._tag](...(obj._values || []));
    /* eslint-enable no-underscore-dangle */
  };
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

  type.case = createCaseFunc(typeName, ctors.map((ctor) => ctor.name));

  return type;
}
