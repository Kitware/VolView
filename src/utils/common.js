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
