export type LayoutItem =
  | {
      type: 'slot';
      slotIndex: number;
    }
  | ({
      type: 'layout';
      // eslint-disable-next-line no-use-before-define
    } & Layout);

export type Layout = {
  direction: 'V' | 'H';
  items: ReadonlyArray<LayoutItem>;
};
