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
 * Determines if a given object is a VTK object
 * @param {Object} obj
 */
export function isVtkObject(obj) {
  return obj && typeof obj.isA === 'function' && obj.isA('vtkObject');
}
