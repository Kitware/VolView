export type SlabAxis = 0 | 1 | 2;
export type SlabMethod = 'mean' | 'max' | 'sum';
export type SlabSpecification = {
  axis: SlabAxis;
  first: number;
  last: number;
  method: SlabMethod;
};
