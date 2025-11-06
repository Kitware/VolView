import { z } from 'zod';
import type { Layout, LayoutItem } from '@/src/types/layout';
import type { ViewInfoInit } from '@/src/types/views';

const viewString = z.enum([
  'axial',
  'coronal',
  'sagittal',
  'volume',
  'oblique',
]);

const view2D = z.object({
  type: z.literal('2D'),
  name: z.string().optional(),
  orientation: z.enum(['Axial', 'Coronal', 'Sagittal']),
});

const view3D = z.object({
  type: z.literal('3D'),
  name: z.string().optional(),
  viewDirection: z
    .enum(['Left', 'Right', 'Posterior', 'Anterior', 'Superior', 'Inferior'])
    .optional(),
  viewUp: z
    .enum(['Left', 'Right', 'Posterior', 'Anterior', 'Superior', 'Inferior'])
    .optional(),
});

const viewOblique = z.object({
  type: z.literal('Oblique'),
  name: z.string().optional(),
});

const viewSpec = z.union([viewString, view2D, view3D, viewOblique]);

type LayoutConfigItemType =
  | z.infer<typeof viewSpec>
  | {
      direction: 'row' | 'column';
      items: LayoutConfigItemType[];
    };

const layoutConfigItem: z.ZodType<LayoutConfigItemType> = z.lazy(() =>
  z.union([
    viewSpec,
    z.object({
      direction: z.enum(['row', 'column']),
      items: z.array(layoutConfigItem),
    }),
  ])
);

export const layoutConfig = z.union([
  z.array(z.array(viewString)),
  z.object({
    direction: z.enum(['row', 'column']),
    items: z.array(layoutConfigItem),
  }),
  z.object({
    gridSize: z.tuple([z.number(), z.number()]),
  }),
]);

export type ViewString = z.infer<typeof viewString>;
export type ViewSpec = z.infer<typeof viewSpec>;
export type LayoutConfigItem = LayoutConfigItemType;
export type LayoutConfig = z.infer<typeof layoutConfig>;

const stringToViewInfoInit = (str: ViewString): ViewInfoInit => {
  switch (str) {
    case 'axial':
      return {
        name: 'Axial',
        type: '2D',
        dataID: null,
        options: { orientation: 'Axial' },
      };
    case 'coronal':
      return {
        name: 'Coronal',
        type: '2D',
        dataID: null,
        options: { orientation: 'Coronal' },
      };
    case 'sagittal':
      return {
        name: 'Sagittal',
        type: '2D',
        dataID: null,
        options: { orientation: 'Sagittal' },
      };
    case 'volume':
      return {
        name: 'Volume',
        type: '3D',
        dataID: null,
        options: { viewDirection: 'Posterior', viewUp: 'Superior' },
      };
    case 'oblique':
      return { name: 'Oblique', type: 'Oblique', dataID: null, options: {} };
    default:
      throw new Error(`Unknown view string: ${str}`);
  }
};

const viewSpecToViewInfoInit = (spec: ViewSpec): ViewInfoInit => {
  if (typeof spec === 'string') {
    return stringToViewInfoInit(spec);
  }

  if (spec.type === '2D') {
    return {
      name: spec.name ?? spec.orientation,
      type: '2D',
      dataID: null,
      options: { orientation: spec.orientation },
    };
  }

  if (spec.type === '3D') {
    return {
      name: spec.name ?? 'Volume',
      type: '3D',
      dataID: null,
      options: {
        viewDirection: spec.viewDirection ?? 'Posterior',
        viewUp: spec.viewUp ?? 'Superior',
      },
    };
  }

  if (spec.type === 'Oblique') {
    return {
      name: spec.name ?? 'Oblique',
      type: 'Oblique',
      dataID: null,
      options: {},
    };
  }

  throw new Error(`Unknown view spec type`);
};

const parseGridLayout = (grid: ViewString[][]) => {
  let slotIndex = 0;

  const items = grid.map((row) => {
    const rowItems = row.map(() => {
      const currentSlot = slotIndex;
      slotIndex += 1;
      return { type: 'slot' as const, slotIndex: currentSlot };
    });

    return {
      type: 'layout' as const,
      direction: 'row' as const,
      items: rowItems,
    };
  });

  const views = grid.flat().map((viewStr) => stringToViewInfoInit(viewStr));

  return {
    layout: {
      direction: 'column' as const,
      items,
    },
    views,
  };
};

const parseGridSizeLayout = (gridSize: [number, number]) => {
  const cols = gridSize[0];
  const rows = gridSize[1];
  const grid: ViewString[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => 'axial' as const)
  );
  return parseGridLayout(grid);
};

const parseNestedLayout = (layoutItem: LayoutConfigItem) => {
  const views: ViewInfoInit[] = [];
  let slotIndex = 0;

  const isViewSpec = (item: LayoutConfigItem): item is ViewSpec =>
    typeof item === 'string' || 'type' in item;

  const processItem = (item: LayoutConfigItem): LayoutItem => {
    if (isViewSpec(item)) {
      const viewInfo = viewSpecToViewInfoInit(item);
      views.push(viewInfo);
      const currentSlot = slotIndex;
      slotIndex += 1;
      return { type: 'slot' as const, slotIndex: currentSlot };
    }

    return {
      type: 'layout' as const,
      direction: item.direction,
      items: item.items.map(processItem),
    };
  };

  const rootLayout = isViewSpec(layoutItem)
    ? { direction: 'column' as const, items: [layoutItem] }
    : layoutItem;

  return {
    layout: {
      direction: rootLayout.direction,
      items: rootLayout.items.map(processItem),
    },
    views,
  };
};

export const parseLayoutConfig = (
  layoutDef: LayoutConfig
): { layout: Layout; views: ViewInfoInit[] } => {
  if (Array.isArray(layoutDef)) {
    return parseGridLayout(layoutDef);
  }
  if ('gridSize' in layoutDef) {
    return parseGridSizeLayout(layoutDef.gridSize);
  }
  return parseNestedLayout(layoutDef);
};
