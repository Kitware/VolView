// Adjacent floating-point values keep even very narrow windows from collapsing.
export const adjacentNumber = (value: number, direction: number) => {
  if (value === 0) return direction * Number.MIN_VALUE;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  view.setBigUint64(0, bits + BigInt((value > 0 ? 1 : -1) * direction));
  return view.getFloat64(0);
};
