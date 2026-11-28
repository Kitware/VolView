import type { ViewInfoInit } from '@/src/types/views';

export type LayoutDirection = 'row' | 'column';

export type LayoutTree<Leaf> = {
  direction: LayoutDirection;
  items: ReadonlyArray<LayoutNode<Leaf>>;
  /** Each item's share of the group, summing to 1. Absent means equal. */
  sizes?: ReadonlyArray<number>;
};

export type LayoutNode<Leaf> = Leaf | ({ type: 'layout' } & LayoutTree<Leaf>);

export type ViewLeaf = { type: 'view'; viewId: string };

export type Layout = LayoutTree<ViewLeaf>;
export type LayoutItem = LayoutNode<ViewLeaf>;

/** A named layout's shape, describing the views a pick should provide. */
export type LayoutTemplate = LayoutTree<{ type: 'view'; view: ViewInfoInit }>;
