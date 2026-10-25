type MergingSlice = { sop: string; z: number; orientation: string };

export const tilt = (radians: number) => {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, 0, -sin, cos, 0].join('\\');
};

/**
 * Orientation agreement is a tolerance, so it is not transitive: the between
 * instance sorts first, the greedy walk takes its cosines as the bucket
 * reference, and both others agree with it. Planned apart, the pair merges
 * into one collection once the between instance arrives.
 */
export const mergingChunks = <T>(chunkFor: (slice: MergingSlice) => T) => ({
  between: chunkFor({ sop: 'sop-1', z: 2, orientation: tilt(0.01) }),
  straight: chunkFor({ sop: 'sop-2', z: 0, orientation: tilt(0) }),
  tilted: chunkFor({ sop: 'sop-3', z: 1, orientation: tilt(0.02) }),
});
