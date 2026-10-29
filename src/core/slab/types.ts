export type SlabAxis = 0 | 1 | 2;
export type SlabMethod = 'mean' | 'max' | 'sum';
export type SlabSpecification = {
  axis: SlabAxis;
  first: number;
  last: number;
  method: SlabMethod;
};

/** Inclusive padding bounds in decoded source values and original Z frames. */
export type SlabPaddingRange = {
  firstFrame: number;
  lastFrame: number;
  min: number;
  max: number;
};
