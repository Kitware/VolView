export const SLAB_METHODS = ['mean', 'max', 'sum'] as const;
export type SlabAxis = 0 | 1 | 2;
export type SlabMethod = (typeof SLAB_METHODS)[number];
export type SlabSpecification = {
  axis: SlabAxis;
  first: number;
  last: number;
  method: SlabMethod;
};
