import type {
  Layout,
  LayoutDirection,
  LayoutItem,
  LayoutNode,
  LayoutTree,
  ViewLeaf,
} from '@/src/types/layout';
import { clampValue, omit } from '@/src/utils';

type Leaf = { type: 'view' };

export function layoutLeaves<L extends Leaf>(tree: LayoutTree<L>): L[] {
  return tree.items.flatMap((item) =>
    item.type === 'layout' ? layoutLeaves<L>(item) : [item as L]
  );
}

export function mapLayoutLeaves<A extends Leaf, B extends Leaf>(
  tree: LayoutTree<A>,
  map: (leaf: A) => B
): LayoutTree<B> {
  return {
    direction: tree.direction,
    items: tree.items.map(
      (item): LayoutNode<B> =>
        item.type === 'layout'
          ? { type: 'layout', ...mapLayoutLeaves<A, B>(item, map) }
          : map(item as A)
    ),
    ...(tree.sizes && { sizes: tree.sizes }),
  };
}

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

/** Each item's share of its group; sizes that do not fit the items mean equal. */
function groupShares(tree: LayoutTree<Leaf>) {
  const count = tree.items.length;
  const { sizes } = tree;
  if (
    sizes?.length !== count ||
    !sizes.every((size) => Number.isFinite(size) && size > 0)
  )
    return tree.items.map(() => 1 / count);
  const total = sum(sizes);
  return sizes.map((size) => size / total);
}

const EQUAL_SHARE_TOLERANCE = 1e-9;

// Equal shares are stored as absent sizes, so untouched layouts stay plain.
function withShares(tree: Layout, shares: readonly number[]): Layout {
  const rest = omit(tree, 'sizes');
  const total = sum(shares);
  const sizes = shares.map((share) => share / total);
  const equal = sizes.every(
    (size) => Math.abs(size - 1 / sizes.length) < EQUAL_SHARE_TOLERANCE
  );
  return equal ? rest : { ...rest, sizes };
}

type Shared = [item: LayoutItem, share: number];

const sharedGroup = (direction: LayoutDirection, entries: Shared[]): Layout =>
  withShares(
    { direction, items: entries.map(([item]) => item) },
    entries.map(([, share]) => share)
  );

export const layoutViewIds = (layout: Layout) =>
  layoutLeaves(layout).map((leaf) => leaf.viewId);

export const viewLeaf = (viewId: string): ViewLeaf => ({
  type: 'view',
  viewId,
});

// A root holding one group draws exactly like that group.
const collapseRoot = (layout: Layout): Layout => {
  const [only] = layout.items;
  if (layout.items.length !== 1 || only.type !== 'layout') return layout;
  return collapseRoot(omit(only, 'type'));
};

function insertBeside(
  layout: Layout,
  targetId: string,
  added: ViewLeaf,
  edge: DropEdge
): Layout {
  const direction = edge === 'left' || edge === 'right' ? 'row' : 'column';
  const before = edge === 'left' || edge === 'top';
  const insertIn = (tree: Layout): Layout => {
    const shares = groupShares(tree);
    return sharedGroup(
      tree.direction,
      tree.items.flatMap((item, index): Shared[] => {
        const share = shares[index];
        if (item.type === 'layout')
          return [[{ type: 'layout', ...insertIn(item) }, share]];
        if (item.viewId !== targetId) return [[item, share]];
        const pair = before ? [added, item] : [item, added];
        // A sibling keeps each divider between exactly two neighbors.
        if (tree.direction === direction)
          return pair.map((leaf): Shared => [leaf, share / 2]);
        return [[{ type: 'layout', direction, items: pair }, share]];
      })
    );
  };
  return collapseRoot(insertIn(layout));
}

export const splitLayoutView = (
  layout: Layout,
  viewId: string,
  newViewId: string,
  direction: LayoutDirection
) =>
  insertBeside(
    layout,
    viewId,
    viewLeaf(newViewId),
    direction === 'row' ? 'right' : 'bottom'
  );

// A group left with one item is replaced by it, merging into a parent of the
// same direction with its shares scaled to the group's share.
function collapsedGroup(
  child: Layout,
  share: number,
  parentDirection: LayoutDirection
): Shared[] {
  if (child.items.length === 0) return [];
  if (child.items.length > 1) return [[{ type: 'layout', ...child }, share]];
  const [only] = child.items;
  if (only.type !== 'layout' || only.direction !== parentDirection)
    return [[only, share]];
  const inner = groupShares(only);
  return only.items.map((item, index) => [item, share * inner[index]]);
}

// An emptied item's share goes to its previous sibling, or the next one when
// it was first, so closing a split view restores the pane it came from.
function giveToNeighbor(groups: Shared[][], shares: readonly number[]) {
  return groups.map((entries, index) => {
    const freed = (neighbor: number) =>
      groups[neighbor]?.length === 0 ? shares[neighbor] : 0;
    const fromNext = freed(index + 1);
    const fromPrevious = index === 1 ? freed(0) : 0;
    return entries.map(([item, share], position): Shared => {
      const last = position === entries.length - 1;
      return [
        item,
        share + (last ? fromNext : 0) + (position === 0 ? fromPrevious : 0),
      ];
    });
  });
}

export function removeLayoutView(layout: Layout, viewId: string): Layout {
  const removeIn = (tree: Layout): Layout => {
    const shares = groupShares(tree);
    const groups = tree.items.map((item, index): Shared[] => {
      if (item.type === 'layout')
        return collapsedGroup(removeIn(item), shares[index], tree.direction);
      return item.viewId === viewId ? [] : [[item, shares[index]]];
    });
    return sharedGroup(tree.direction, giveToNeighbor(groups, shares).flat());
  };
  return collapseRoot(removeIn(layout));
}

export function replaceLayoutView(
  layout: Layout,
  viewId: string,
  nextViewId: string
): Layout {
  return mapLayoutLeaves(layout, (leaf) =>
    leaf.viewId === viewId ? viewLeaf(nextViewId) : leaf
  );
}

const swapLayoutViews = (layout: Layout, a: string, b: string) =>
  mapLayoutLeaves(layout, (leaf) => {
    if (leaf.viewId === a) return viewLeaf(b);
    if (leaf.viewId === b) return viewLeaf(a);
    return leaf;
  });

type DropEdge = 'left' | 'right' | 'top' | 'bottom';
/** Where a dragged view lands on a target pane: beside an edge, or swapped. */
export type DropZone = DropEdge | 'center';

export function moveLayoutView(
  layout: Layout,
  viewId: string,
  targetId: string,
  zone: DropZone
): Layout {
  if (viewId === targetId) return layout;
  if (zone === 'center') return swapLayoutViews(layout, viewId, targetId);
  return insertBeside(
    removeLayoutView(layout, viewId),
    targetId,
    viewLeaf(viewId),
    zone
  );
}

// A one-item group draws exactly like its item.
const unwrap = <L extends Leaf>(node: LayoutNode<L>): LayoutNode<L> =>
  node.type === 'layout' && node.items.length === 1
    ? unwrap(node.items[0])
    : node;

/** Whether two layouts draw the same panes, with leaves matched in order. */
export function sameLayoutShape<A extends Leaf, B extends Leaf>(
  a: LayoutTree<A>,
  b: LayoutTree<B>,
  sameLeaf: (a: A, b: B) => boolean
): boolean {
  const match = (x: LayoutNode<A>, y: LayoutNode<B>): boolean => {
    const left = unwrap(x);
    const right = unwrap(y);
    if (left.type !== 'layout' || right.type !== 'layout')
      return (
        left.type !== 'layout' &&
        right.type !== 'layout' &&
        sameLeaf(left as A, right as B)
      );
    return (
      left.direction === right.direction &&
      left.items.length === right.items.length &&
      left.items.every((item, index) => match(item, right.items[index]))
    );
  };
  return match({ type: 'layout', ...a }, { type: 'layout', ...b });
}

export type Bounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};
type Size = { width: number; height: number };

const FULL_BOUNDS: Bounds = { left: 0, top: 0, width: 100, height: 100 };

export const axisOf = (direction: LayoutDirection) =>
  direction === 'row'
    ? ({ start: 'left', size: 'width' } as const)
    : ({ start: 'top', size: 'height' } as const);

function itemBounds(tree: LayoutTree<Leaf>, bounds: Bounds): Bounds[] {
  const { start, size } = axisOf(tree.direction);
  const shares = groupShares(tree);
  return shares.map((share, index) => ({
    ...bounds,
    [start]: bounds[start] + sum(shares.slice(0, index)) * bounds[size],
    [size]: share * bounds[size],
  }));
}

// Flat panes let Vue retain viewer instances when their nesting changes.
export function getLayoutPanes(
  layout: Layout,
  bounds: Bounds = FULL_BOUNDS
): (Bounds & { viewId: string })[] {
  const children = itemBounds(layout, bounds);
  return layout.items.flatMap((item, index) =>
    item.type === 'view'
      ? [{ ...children[index], viewId: item.viewId }]
      : getLayoutPanes(item, children[index])
  );
}

/**
 * The gap before `items[index]` of the group at `path` (item indices from the
 * root). Values are percentages of the layout; `position` and the group span
 * run along the group's direction, `start` and `length` across it.
 */
export type LayoutDivider = {
  path: readonly number[];
  index: number;
  direction: LayoutDirection;
  position: number;
  start: number;
  length: number;
  groupStart: number;
  groupSize: number;
};

export function getLayoutDividers(layout: Layout): LayoutDivider[] {
  const inGroup = (
    tree: Layout,
    bounds: Bounds,
    path: readonly number[]
  ): LayoutDivider[] => {
    const along = axisOf(tree.direction);
    const across = axisOf(tree.direction === 'row' ? 'column' : 'row');
    const children = itemBounds(tree, bounds);
    const own = children.slice(1).map((child, offset) => ({
      path,
      index: offset + 1,
      direction: tree.direction,
      position: child[along.start],
      start: bounds[across.start],
      length: bounds[across.size],
      groupStart: bounds[along.start],
      groupSize: bounds[along.size],
    }));
    const nested = tree.items.flatMap((item, index) =>
      item.type === 'layout'
        ? inGroup(item, children[index], [...path, index])
        : []
    );
    return [...own, ...nested];
  };
  return inGroup(layout, FULL_BOUNDS, []);
}

const ALIGNED_TOLERANCE = 1e-6;

const sameParent = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.slice(0, -1).every((step, i) => step === b[i]);

const lastStep = (divider: LayoutDivider) => divider.path.at(-1) ?? -1;

/**
 * Dividers continuing `divider` across the run of adjacent sibling groups
 * that share its position, itself included.
 */
export function alignedDividers(
  dividers: readonly LayoutDivider[],
  divider: LayoutDivider
) {
  const aligned = dividers.filter(
    (other) =>
      other.direction === divider.direction &&
      sameParent(other.path, divider.path) &&
      Math.abs(other.position - divider.position) < ALIGNED_TOLERANCE
  );
  const at = new Set(aligned.map(lastStep));
  const reach = (step: number) => {
    let index = lastStep(divider);
    while (at.has(index + step)) index += step;
    return index;
  };
  const [first, last] = [reach(-1), reach(1)];
  return aligned.filter(
    (other) => lastStep(other) >= first && lastStep(other) <= last
  );
}

/** The smallest pane, in pixels, whose view controls stay usable. */
const MIN_PANE_SIZE: Size = { width: 160, height: 120 };

/** Whether a pane of this pixel size can split in each direction. */
export const canSplit = ({ width, height }: Size) => ({
  row: width >= 2 * MIN_PANE_SIZE.width,
  column: height >= 2 * MIN_PANE_SIZE.height,
});

const groupAt = (tree: Layout, path: readonly number[]): Layout => {
  if (path.length === 0) return tree;
  const item = tree.items[path[0]];
  if (item.type !== 'layout') throw new Error('Divider path ends at a view');
  return groupAt(item, path.slice(1));
};

const updateGroup = (
  tree: Layout,
  path: readonly number[],
  update: (group: Layout) => Layout
): Layout => {
  if (path.length === 0) return update(tree);
  const [head, ...rest] = path;
  return {
    ...tree,
    items: tree.items.map((item, index) =>
      index === head && item.type === 'layout'
        ? { type: 'layout', ...updateGroup(item, rest, update) }
        : item
    ),
  };
};

// Pixels an item needs along a direction so every pane in it keeps `minimum`.
const minimumExtent = (
  item: LayoutItem,
  direction: LayoutDirection,
  minimum: number
): number => {
  if (item.type === 'view') return minimum;
  const shares = groupShares(item);
  return Math.max(
    ...item.items.map(
      (child, index) =>
        minimumExtent(child, direction, minimum) /
        (item.direction === direction ? shares[index] : 1)
    )
  );
};

function dividerShares(group: Layout, divider: LayoutDivider) {
  const shares = groupShares(group);
  return {
    shares,
    before: sum(shares.slice(0, divider.index - 1)),
    pair: shares[divider.index - 1] + shares[divider.index],
  };
}

// Percent positions a divider may take with both neighbors above the minimum.
function dividerRange(layout: Layout, divider: LayoutDivider, container: Size) {
  const { size } = axisOf(divider.direction);
  const group = groupAt(layout, divider.path);
  const groupPixels = (divider.groupSize / 100) * container[size];
  const toPercent = (fraction: number) =>
    divider.groupStart + fraction * divider.groupSize;
  const need = (index: number) =>
    minimumExtent(group.items[index], divider.direction, MIN_PANE_SIZE[size]) /
    groupPixels;
  const { before, pair } = dividerShares(group, divider);
  // An undersized neighbor may grow but never shrink further.
  return {
    low: Math.min(
      toPercent(before + need(divider.index - 1)),
      divider.position
    ),
    high: Math.max(
      toPercent(before + pair - need(divider.index)),
      divider.position
    ),
  };
}

// The second neighbor takes what the first leaves of their pair.
function setDividerShare(
  layout: Layout,
  divider: LayoutDivider,
  first: (around: ReturnType<typeof dividerShares>) => number
) {
  return updateGroup(layout, divider.path, (group) => {
    const around = dividerShares(group, divider);
    const share = first(around);
    return withShares(
      group,
      around.shares.map((current, index) => {
        if (index === divider.index - 1) return share;
        if (index === divider.index) return around.pair - share;
        return current;
      })
    );
  });
}

/**
 * Moves aligned dividers to one percent position, limited so no pane in either
 * neighbor drops below MIN_PANE_SIZE pixels of `container`, or further below
 * it when already smaller.
 */
export function moveLayoutDividers(
  layout: Layout,
  dividers: readonly LayoutDivider[],
  position: number,
  container: Size
): Layout {
  const ranges = dividers.map((divider) =>
    dividerRange(layout, divider, container)
  );
  const clamped = clampValue(
    position,
    Math.max(...ranges.map((range) => range.low)),
    Math.min(...ranges.map((range) => range.high))
  );
  return dividers.reduce(
    (next, divider) =>
      setDividerShare(
        next,
        divider,
        ({ before }) =>
          (clamped - divider.groupStart) / divider.groupSize - before
      ),
    layout
  );
}

const DOCK_EDGE_FRACTION = 0.25;

/**
 * The drop zone under a point in a pane, both in layout percent. Edges dock
 * only where the target can split without going below MIN_PANE_SIZE.
 */
export function pickDropZone(
  pane: Bounds,
  point: { x: number; y: number },
  container: Size
): DropZone {
  const x = (point.x - pane.left) / pane.width;
  const y = (point.y - pane.top) / pane.height;
  const fits = canSplit({
    width: (pane.width / 100) * container.width,
    height: (pane.height / 100) * container.height,
  });
  const edges = [
    { zone: 'left', distance: x, direction: 'row' },
    { zone: 'right', distance: 1 - x, direction: 'row' },
    { zone: 'top', distance: y, direction: 'column' },
    { zone: 'bottom', distance: 1 - y, direction: 'column' },
  ] as const;
  const nearest = edges
    .filter(
      ({ distance, direction }) =>
        fits[direction] && distance < DOCK_EDGE_FRACTION
    )
    .sort((a, b) => a.distance - b.distance)[0];
  return nearest?.zone ?? 'center';
}

/** The part of the target pane a dropped view will take. */
export function dropZoneBounds(pane: Bounds, zone: DropZone): Bounds {
  const half = { width: pane.width / 2, height: pane.height / 2 };
  switch (zone) {
    case 'left':
      return { ...pane, width: half.width };
    case 'right':
      return { ...pane, left: pane.left + half.width, width: half.width };
    case 'top':
      return { ...pane, height: half.height };
    case 'bottom':
      return { ...pane, top: pane.top + half.height, height: half.height };
    default:
      return pane;
  }
}

/** Splits each divider's two neighbors evenly again. */
export const resetLayoutDividers = (
  layout: Layout,
  dividers: readonly LayoutDivider[]
) =>
  dividers.reduce(
    (next, divider) => setDividerShare(next, divider, ({ pair }) => pair / 2),
    layout
  );
