const compactNumber = (value: number) => {
  const magnitude = Math.abs(value);
  return magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e6)
    ? value.toExponential()
    : String(value);
};

export function formatDisplayRange([min, max]: readonly [number, number]) {
  const span = max - min;
  if (Number.isFinite(span) && span > 0) {
    for (let precision = 4; precision <= 17; precision += 1) {
      const roundedMin = Number(min.toPrecision(precision));
      const roundedMax = Number(max.toPrecision(precision));
      // Divide by the span so subnormal intervals do not lose their tolerance.
      if (
        roundedMin < roundedMax &&
        Math.abs(roundedMin - min) / span <= 0.001 &&
        Math.abs(roundedMax - max) / span <= 0.001
      ) {
        return [compactNumber(roundedMin), compactNumber(roundedMax)] as const;
      }
    }
  }
  return [compactNumber(min), compactNumber(max)] as const;
}
