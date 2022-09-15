export enum LayoutDirection {
  V = 'V',
  H = 'H',
}

export type Layout = {
  direction: LayoutDirection;
  items: Array<Layout | string>;
  name?: string;
};
