export type LayoutDirection = 'row' | 'column';

export type LayoutItem =
  | {
      type: 'slot';
      slotIndex: number;
    }
  | ({
      type: 'layout';
    } & Layout);

export type Layout = {
  direction: LayoutDirection;
  items: ReadonlyArray<LayoutItem>;
};
