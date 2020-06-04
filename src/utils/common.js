export function defer() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Turns an action into a mutation wrapper
 * @param {string} mutation
 */
export function asMutation(mutation) {
  return ({ commit }, args) => commit(mutation, args);
}

/**
 * Picks out a subset of an object
 * @param {Object} obj
 * @param {String[]} keys
 */
export function pick(obj, keys) {
  return keys.reduce((o, k) => ({ ...o, [k]: obj[k] }), {});
}

/**
 * Zips a list of keys and a list of values into an object.
 * @param {String[]} keys
 * @param {any[]} values
 */
export function zipObj(keys, values) {
  const obj = {};
  const length = Math.min(keys.length, values.length);
  for (let i = 0; i < length; i += 1) {
    obj[keys[i]] = values[i];
  }
  return obj;
}
