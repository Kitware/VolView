import { describe, expect, it } from 'vitest';
import type { Layout, LayoutItem } from '@/src/types/layout';
import { omit } from '@/src/utils';
import {
  alignedDividers,
  getLayoutDividers,
  getLayoutPanes,
  moveLayoutDividers,
  moveLayoutView,
  removeLayoutView,
  replaceLayoutView,
  resetLayoutDividers,
  sameLayoutShape,
  splitLayoutView,
} from '@/src/utils/layoutEditing';

const v = (viewId: string): LayoutItem => ({ type: 'view', viewId });
const row = (...items: LayoutItem[]): LayoutItem => ({
  type: 'layout',
  direction: 'row',
  items,
});
const column = (...items: LayoutItem[]): LayoutItem => ({
  type: 'layout',
  direction: 'column',
  items,
});
const root = (item: LayoutItem): Layout => {
  if (item.type !== 'layout') return { direction: 'column', items: [item] };
  return omit(item, 'type');
};
const sized = (item: LayoutItem, sizes: number[]): LayoutItem =>
  item.type === 'layout' ? { ...item, sizes } : item;
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const widths = (layout: Layout) =>
  getLayoutPanes(layout).map(({ width }) => round(width));
const heights = (layout: Layout) =>
  getLayoutPanes(layout).map(({ height }) => round(height));

describe('layout editing', () => {
  it('inserts a sibling when splitting along the parent direction', () => {
    expect(splitLayoutView(root(row(v('a'), v('b'))), 'a', 'c', 'row')).toEqual(
      root(sized(row(v('a'), v('c'), v('b')), [0.25, 0.25, 0.5]))
    );
  });

  it('nests a group when splitting across the parent direction', () => {
    expect(
      splitLayoutView(root(row(v('a'), v('b'))), 'b', 'c', 'column')
    ).toEqual(root(row(v('a'), column(v('b'), v('c')))));
  });

  it('grows a single-view root in the split direction', () => {
    expect(splitLayoutView(root(column(row(v('a')))), 'a', 'b', 'row')).toEqual(
      root(row(v('a'), v('b')))
    );
    expect(splitLayoutView(root(v('a')), 'a', 'b', 'row')).toEqual(
      root(row(v('a'), v('b')))
    );
  });

  it('merges a collapsed group into a parent of the same direction', () => {
    const layout = root(row(v('a'), column(v('b'), row(v('c'), v('d')))));
    expect(removeLayoutView(layout, 'b')).toEqual(
      root(sized(row(v('a'), v('c'), v('d')), [0.5, 0.25, 0.25]))
    );
  });

  it('replaces a one-view group with its view', () => {
    const layout = root(column(row(v('a'), v('b')), row(v('c'), v('d'))));
    expect(removeLayoutView(layout, 'a')).toEqual(
      root(column(v('b'), row(v('c'), v('d'))))
    );
  });

  it('leaves untouched groups nested as configured', () => {
    const layout = root(row(row(v('a'), v('b')), v('c'), v('d')));
    const removed = removeLayoutView(layout, 'd');
    expect(removed.items).toEqual([row(v('a'), v('b')), v('c')]);
    expect(widths(removed)).toEqual([
      round(100 / 6),
      round(100 / 6),
      66.666667,
    ]);
  });

  it('matches shapes regardless of one-item groups', () => {
    const same = (a: { viewId: string }, b: { viewId: string }) =>
      a.viewId === b.viewId;
    expect(
      sameLayoutShape(root(column(row(v('a')))), root(row(v('a'))), same)
    ).toBe(true);
    expect(
      sameLayoutShape(
        root(column(row(v('a'), v('b')))),
        root(row(v('a'), v('b'))),
        same
      )
    ).toBe(true);
    expect(
      sameLayoutShape(
        root(row(v('a'), v('b'))),
        root(column(v('a'), v('b'))),
        same
      )
    ).toBe(false);
    expect(
      sameLayoutShape(
        root(row(v('a'), v('b'))),
        root(row(v('b'), v('a'))),
        same
      )
    ).toBe(false);
  });

  it('matches shapes regardless of sizes', () => {
    const same = (a: { viewId: string }, b: { viewId: string }) =>
      a.viewId === b.viewId;
    expect(
      sameLayoutShape(
        root(sized(row(v('a'), v('b')), [0.2, 0.8])),
        root(row(v('a'), v('b'))),
        same
      )
    ).toBe(true);
  });
});

describe('moving views', () => {
  const fourUp = root(column(row(v('a'), v('b')), row(v('c'), v('d'))));

  it('swaps two views on a center drop, keeping pane sizes in place', () => {
    const layout = root(sized(row(v('a'), v('b')), [0.7, 0.3]));
    expect(moveLayoutView(layout, 'a', 'b', 'center')).toEqual(
      root(sized(row(v('b'), v('a')), [0.7, 0.3]))
    );
  });

  it('docks a view beside the target edge, halving the target', () => {
    expect(moveLayoutView(fourUp, 'a', 'd', 'left')).toEqual(
      root(
        column(v('b'), sized(row(v('c'), v('a'), v('d')), [0.5, 0.25, 0.25]))
      )
    );
    expect(moveLayoutView(fourUp, 'a', 'd', 'bottom')).toEqual(
      root(column(v('b'), row(v('c'), column(v('d'), v('a')))))
    );
  });

  it('moves a view across its only sibling', () => {
    const pair = root(row(v('a'), v('b')));
    expect(moveLayoutView(pair, 'a', 'b', 'right')).toEqual(
      root(row(v('b'), v('a')))
    );
    expect(moveLayoutView(pair, 'a', 'b', 'top')).toEqual(
      root(column(v('a'), v('b')))
    );
  });

  it('leaves the layout alone when dropped on itself', () => {
    expect(moveLayoutView(fourUp, 'a', 'a', 'left')).toBe(fourUp);
  });
});

describe('layout sizes', () => {
  const container = { width: 1000, height: 800 };

  it('places panes by their group shares', () => {
    const layout = root(
      sized(column(sized(row(v('a'), v('b')), [0.3, 0.7]), v('c')), [0.6, 0.4])
    );
    expect(getLayoutPanes(layout)).toEqual([
      { viewId: 'a', left: 0, top: 0, width: 30, height: 60 },
      { viewId: 'b', left: 30, top: 0, width: 70, height: 60 },
      { viewId: 'c', left: 0, top: 60, width: 100, height: 40 },
    ]);
  });

  it('treats sizes that do not fit their items as equal', () => {
    const invalid = [
      [0.5],
      [0.5, 0.5, 0],
      [-1, 2, 1],
      [Infinity, 1, 1],
      [NaN, 1, 1],
    ];
    invalid.forEach((sizes) =>
      expect(widths(root(sized(row(v('a'), v('b'), v('c')), sizes)))).toEqual(
        widths(root(row(v('a'), v('b'), v('c'))))
      )
    );
    expect(widths(root(sized(row(v('a'), v('b')), [1, 3])))).toEqual([25, 75]);
  });

  it('lists the gap between each pair of siblings', () => {
    const layout = root(sized(row(v('a'), column(v('b'), v('c'))), [0.4, 0.6]));
    expect(getLayoutDividers(layout)).toEqual([
      {
        path: [],
        index: 1,
        direction: 'row',
        position: 40,
        start: 0,
        length: 100,
        groupStart: 0,
        groupSize: 100,
      },
      {
        path: [1],
        index: 1,
        direction: 'column',
        position: 50,
        start: 40,
        length: 60,
        groupStart: 0,
        groupSize: 100,
      },
    ]);
  });

  it('moves only the two neighbors of a divider', () => {
    const layout = root(row(v('a'), v('b'), v('c'), v('d')));
    const [, middle] = getLayoutDividers(layout);
    expect(widths(moveLayoutDividers(layout, [middle], 55, container))).toEqual(
      [25, 30, 20, 25]
    );
  });

  it('stops a divider where a neighbor reaches the minimum pane size', () => {
    const layout = root(row(v('a'), v('b')));
    const [divider] = getLayoutDividers(layout);
    expect(widths(moveLayoutDividers(layout, [divider], 2, container))).toEqual(
      [16, 84]
    );
    expect(
      widths(moveLayoutDividers(layout, [divider], 99, container))
    ).toEqual([84, 16]);
  });

  it('keeps every pane inside a nested neighbor above the minimum', () => {
    const layout = root(row(v('a'), column(v('b'), row(v('c'), v('d')))));
    const [divider] = getLayoutDividers(layout);
    const moved = moveLayoutDividers(layout, [divider], 90, container);
    expect(widths(moved)).toEqual([68, 32, 16, 16]);
  });

  it('lets an undersized pane grow but never shrink further', () => {
    const layout = root(sized(row(v('a'), v('b')), [0.1, 0.9]));
    const [divider] = getLayoutDividers(layout);
    const move = (position: number) =>
      widths(moveLayoutDividers(layout, [divider], position, container));
    expect(move(5)).toEqual([10, 90]);
    expect(move(30)).toEqual([30, 70]);
    expect(move(99)).toEqual([84, 16]);

    const cramped = root(row(v('a'), v('b')));
    const [middle] = getLayoutDividers(cramped);
    expect(
      widths(
        moveLayoutDividers(cramped, [middle], 40, { width: 200, height: 200 })
      )
    ).toEqual([50, 50]);
  });

  it('couples only the adjacent run of aligned sibling groups', () => {
    const layout = root(
      column(
        row(v('a'), v('b')),
        row(v('c'), v('d')),
        v('e'),
        row(v('f'), v('g'))
      )
    );
    const dividers = getLayoutDividers(layout);
    const [top, , bottom] = dividers.filter(({ path }) => path.length === 1);
    expect(alignedDividers(dividers, top).map(({ path }) => path)).toEqual([
      [0],
      [1],
    ]);
    expect(alignedDividers(dividers, bottom).map(({ path }) => path)).toEqual([
      [3],
    ]);
    expect(
      widths(
        moveLayoutDividers(
          layout,
          alignedDividers(dividers, top),
          30,
          container
        )
      )
    ).toEqual([30, 70, 30, 70, 100, 50, 50]);
  });

  it('moves aligned dividers in sibling groups together', () => {
    const fourUp = root(column(row(v('a'), v('b')), row(v('c'), v('d'))));
    const dividers = getLayoutDividers(fourUp);
    const vertical = dividers.find((divider) => divider.path.length === 1)!;
    const aligned = alignedDividers(dividers, vertical);
    expect(aligned.map(({ path }) => path)).toEqual([[0], [1]]);
    const moved = moveLayoutDividers(fourUp, aligned, 70, container);
    expect(widths(moved)).toEqual([70, 30, 70, 30]);
    expect(
      alignedDividers(getLayoutDividers(moved), getLayoutDividers(moved)[1])
    ).toHaveLength(2);

    const offset = moveLayoutDividers(
      moved,
      [getLayoutDividers(moved)[1]],
      40,
      container
    );
    const lowerRow = getLayoutDividers(offset).find(
      ({ path }) => path[0] === 1
    )!;
    expect(alignedDividers(getLayoutDividers(offset), lowerRow)).toEqual([
      lowerRow,
    ]);
  });

  it('limits aligned dividers by the tightest group', () => {
    const layout = root(
      column(
        sized(row(v('a'), v('b')), [0.5, 0.5]),
        row(v('c'), column(v('d'), v('e'), v('f')))
      )
    );
    const aligned = alignedDividers(
      getLayoutDividers(layout),
      getLayoutDividers(layout)[1]
    );
    expect(aligned).toHaveLength(2);
    expect(widths(moveLayoutDividers(layout, aligned, 95, container))).toEqual([
      84, 16, 84, 16, 16, 16,
    ]);
  });

  it('evens out only the two neighbors of a reset divider', () => {
    const layout = root(sized(row(v('a'), v('b'), v('c')), [0.2, 0.3, 0.5]));
    const [first] = getLayoutDividers(layout);
    expect(widths(resetLayoutDividers(layout, [first]))).toEqual([25, 25, 50]);
  });

  it('resets the groups of the given dividers to equal shares', () => {
    const layout = root(
      sized(
        column(
          sized(row(v('a'), v('b')), [0.2, 0.8]),
          sized(row(v('c'), v('d')), [0.2, 0.8])
        ),
        [0.3, 0.7]
      )
    );
    const dividers = getLayoutDividers(layout);
    const reset = resetLayoutDividers(
      layout,
      alignedDividers(dividers, dividers[1])
    );
    expect(widths(reset)).toEqual([50, 50, 50, 50]);
    expect(heights(reset)).toEqual([30, 30, 70, 70]);
  });

  it('halves the split pane and keeps every other pane in place', () => {
    const layout = root(sized(row(v('a'), v('b')), [0.4, 0.6]));
    const sibling = splitLayoutView(layout, 'b', 'c', 'row');
    expect(widths(sibling)).toEqual([40, 30, 30]);
    const nested = splitLayoutView(layout, 'b', 'c', 'column');
    expect(getLayoutPanes(nested)).toEqual([
      { viewId: 'a', left: 0, top: 0, width: 40, height: 100 },
      { viewId: 'b', left: 40, top: 0, width: 60, height: 50 },
      { viewId: 'c', left: 40, top: 50, width: 60, height: 50 },
    ]);
  });

  it('gives a closed pane share to its previous neighbor, or the next when first', () => {
    const layout = root(sized(row(v('a'), v('b'), v('c')), [0.2, 0.3, 0.5]));
    expect(widths(removeLayoutView(layout, 'c'))).toEqual([20, 80]);
    expect(widths(removeLayoutView(layout, 'b'))).toEqual([50, 50]);
    expect(widths(removeLayoutView(layout, 'a'))).toEqual([50, 50]);
  });

  it('gives a closed half of a split or dock to the other half', () => {
    const layout = root(row(v('a'), v('b')));
    const split = splitLayoutView(layout, 'b', 'n', 'row');
    expect(removeLayoutView(split, 'b')).toEqual(
      replaceLayoutView(layout, 'b', 'n')
    );
    const fourUp = root(column(row(v('a'), v('b')), row(v('c'), v('d'))));
    const docked = moveLayoutView(fourUp, 'a', 'd', 'left');
    expect(removeLayoutView(docked, 'a')).toEqual(
      root(column(v('b'), row(v('c'), v('d'))))
    );
  });

  it('restores the original sizes when a split view is closed', () => {
    const layout = root(
      sized(column(sized(row(v('a'), v('b')), [0.3, 0.7]), v('c')), [0.6, 0.4])
    );
    (['row', 'column'] as const).forEach((direction) => {
      const split = splitLayoutView(layout, 'b', 'n', direction);
      expect(removeLayoutView(split, 'n')).toEqual(layout);
    });
    expect(
      removeLayoutView(splitLayoutView(layout, 'a', 'n', 'row'), 'a')
    ).toEqual(replaceLayoutView(layout, 'a', 'n'));
  });

  it('scales a collapsed group into its parent by the group share', () => {
    const layout = root(
      sized(
        row(v('a'), column(v('b'), sized(row(v('c'), v('d')), [0.25, 0.75]))),
        [0.2, 0.8]
      )
    );
    expect(widths(removeLayoutView(layout, 'b'))).toEqual([20, 20, 60]);
  });

  it('keeps the shares of a group that becomes the root', () => {
    const layout = root(
      sized(column(sized(row(v('a'), v('b')), [0.3, 0.7]), v('c')), [0.5, 0.5])
    );
    expect(removeLayoutView(layout, 'c')).toEqual(
      root(sized(row(v('a'), v('b')), [0.3, 0.7]))
    );
  });
});
