/**
 * The same as Promise.race(), but returns richer promise information.
 *
 * Return object structure:
 * - promise: the settled promise
 * - index: the index of the settled promise
 * - rest: the rest of the unselected promises
 * @param promises
 * @returns
 */
export function asyncSelect<T = any>(promises: Promise<T>[]) {
  return Promise.race(
    promises.map((p, i) => {
      const info = { promise: p, index: i };
      return p.catch(() => {}).then(() => info);
    })
  ).then(({ promise, index }) => {
    const rest = [...promises];
    rest.splice(index, 1);

    return { promise, index, rest };
  });
}
