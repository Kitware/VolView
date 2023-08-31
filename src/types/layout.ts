export enum LayoutDirection {
  V = 'V',
  H = 'H',
}

export type Layout = {
  direction: LayoutDirection;
  items: ReadonlyArray<Layout | string>;
  name?: string;
};
