/** Groups preserve input order, both of the keys and of their members. */
export const groupBy = <T, K>(items: readonly T[], keyOf: (item: T) => K) => {
  const groups = new Map<K, T[]>();
  items.forEach((item) => {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  });
  return groups;
};
