import type { Layout, LayoutDirection, LayoutItem } from '@/src/types/layout';
import type { ViewInfoInit } from '@/src/types/views';

type ViewString = 'axial' | 'coronal' | 'sagittal' | 'volume' | 'oblique';

type View2DSpec = {
  type: '2D';
  name?: string;
  orientation: 'Axial' | 'Coronal' | 'Sagittal';
};

type View3DSpec = {
  type: '3D';
  name?: string;
  viewDirection?:
    | 'Left'
    | 'Right'
    | 'Posterior'
    | 'Anterior'
    | 'Superior'
    | 'Inferior';
  viewUp?:
    | 'Left'
    | 'Right'
    | 'Posterior'
    | 'Anterior'
    | 'Superior'
    | 'Inferior';
};

type ViewObliqueSpec = {
  type: 'Oblique';
  name?: string;
};

type ViewSpec = ViewString | View2DSpec | View3DSpec | ViewObliqueSpec;

export type LayoutConfigItem =
  | ViewSpec
  | {
      direction: LayoutDirection;
      items: LayoutConfigItem[];
    };

export type LayoutConfig =
  | ViewString[][]
  | {
      direction: LayoutDirection;
      items: LayoutConfigItem[];
    }
  | {
      gridSize: [number, number];
    };

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
