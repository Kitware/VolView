import { z } from 'zod';
import { zodEnumFromObjKeys } from '@/src/utils';
import { ACTIONS } from '@/src/constants';

import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useViewStore } from '@/src/store/views';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { actionToKey } from '@/src/composables/useKeyboardShortcuts';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import useLoadDataStore from '@/src/store/load-data';
import type { LayoutItem, LayoutDirection } from '@/src/types/layout';
import type { ViewInfoInit } from '@/src/types/views';

// --------------------------------------------------------------------------
// View Specifications

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

// --------------------------------------------------------------------------
// Layout Specifications

type LayoutConfigItem =
  | z.infer<typeof viewSpec>
  | {
      direction: LayoutDirection;
      items: LayoutConfigItem[];
    };

const layoutConfigItem: z.ZodType<LayoutConfigItem> = z.lazy(() =>
  z.union([
    viewSpec,
    z.object({
      direction: z.enum(['row', 'column']),
      items: z.array(layoutConfigItem),
    }),
  ])
);

const layoutConfig = z.union([
  z.array(z.array(viewString)),
  z.object({
    direction: z.enum(['row', 'column']),
    items: z.array(layoutConfigItem),
  }),
  z.object({
    gridSize: z.tuple([z.number(), z.number()]),
  }),
]);

const layout = layoutConfig.optional();

const shortcuts = z.record(zodEnumFromObjKeys(ACTIONS), z.string()).optional();

// --------------------------------------------------------------------------
// Labels

const color = z.string();

const label = z.object({
  color,
  strokeWidth: z.number().optional(),
});

const rulerLabel = label;
const polygonLabel = label;

const rectangleLabel = z.intersection(
  label,
  z.object({
    fillColor: color,
  })
);

const labels = z
  .object({
    defaultLabels: z.record(label).or(z.null()).optional(),
    rulerLabels: z.record(rulerLabel).or(z.null()).optional(),
    rectangleLabels: z.record(rectangleLabel).or(z.null()).optional(),
    polygonLabels: z.record(polygonLabel).or(z.null()).optional(),
  })
  .optional();

// --------------------------------------------------------------------------
// IO

const io = z
  .object({
    segmentGroupSaveFormat: z.string().optional(),
    segmentGroupExtension: z.string().default(''),
  })
  .optional();

// --------------------------------------------------------------------------
// Window Level

const windowing = z
  .object({
    level: z.number(),
    width: z.number(),
  })
  .optional();

export const config = z.object({
  layout,
  labels,
  shortcuts,
  io,
  windowing,
});

export type Config = z.infer<typeof config>;

export const readConfigFile = async (configFile: File) => {
  const decoder = new TextDecoder();
  const ab = await configFile.arrayBuffer();
  const text = decoder.decode(new Uint8Array(ab));
  return config.parse(JSON.parse(text));
};

// --------------------------------------------------------------------------
// Layout Parsing

const stringToViewInfoInit = (
  str: z.infer<typeof viewString>
): ViewInfoInit => {
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

const viewSpecToViewInfoInit = (
  spec: z.infer<typeof viewSpec>
): ViewInfoInit => {
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

const parseGridLayout = (grid: z.infer<typeof viewString>[][]) => {
  const views: ViewInfoInit[] = [];
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

  grid.flat().forEach((viewStr) => {
    views.push(stringToViewInfoInit(viewStr));
  });

  return {
    layout: {
      direction: 'column' as const,
      items,
    },
    views,
  };
};

const parseNestedLayout = (layoutItem: LayoutConfigItem) => {
  const views: ViewInfoInit[] = [];
  let slotIndex = 0;

  const isViewSpec = (
    item: LayoutConfigItem
  ): item is z.infer<typeof viewSpec> =>
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

const applyLabels = (manifest: Config) => {
  if (!manifest.labels) return;

  // pass through null labels, use fallback labels if undefined
  const defaultLabelsIfUndefined = <T>(toolLabels: T) => {
    if (toolLabels === undefined) return manifest.labels?.defaultLabels;
    return toolLabels;
  };

  const applyLabelsToStore = (
    store: AnnotationToolStore,
    maybeLabels: (typeof manifest.labels)[keyof typeof manifest.labels]
  ) => {
    const labelsOrFallback = defaultLabelsIfUndefined(maybeLabels);
    if (!labelsOrFallback) return;
    store.clearDefaultLabels();
    store.mergeLabels(labelsOrFallback);
  };

  const { rulerLabels, rectangleLabels, polygonLabels } = manifest.labels;
  applyLabelsToStore(useRulerStore(), rulerLabels);
  applyLabelsToStore(useRectangleStore(), rectangleLabels);
  applyLabelsToStore(usePolygonStore(), polygonLabels);
};

const applyLayout = (manifest: Config) => {
  if (!manifest.layout) return;

  if (Array.isArray(manifest.layout)) {
    const parsedLayout = parseGridLayout(manifest.layout);
    useViewStore().setLayoutWithViews(parsedLayout.layout, parsedLayout.views);
  } else if ('gridSize' in manifest.layout) {
    useViewStore().setLayoutFromGrid(manifest.layout.gridSize);
  } else {
    const parsedLayout = parseNestedLayout(manifest.layout);
    useViewStore().setLayoutWithViews(parsedLayout.layout, parsedLayout.views);
  }
};

const applyShortcuts = (manifest: Config) => {
  if (!manifest.shortcuts) return;

  actionToKey.value = {
    ...actionToKey.value,
    ...manifest.shortcuts,
  };
};

const applyIo = (manifest: Config) => {
  if (!manifest.io) return;

  if (manifest.io.segmentGroupSaveFormat)
    useSegmentGroupStore().saveFormat = manifest.io.segmentGroupSaveFormat;
  useLoadDataStore().segmentGroupExtension = manifest.io.segmentGroupExtension;
};

const applyWindowing = (manifest: Config) => {
  if (!manifest.windowing) return;

  useWindowingStore().runtimeConfigWindowLevel = manifest.windowing;
};

export const applyPreStateConfig = (manifest: Config) => {
  applyLayout(manifest);
  applyShortcuts(manifest);
  applyIo(manifest);
  applyWindowing(manifest);
};

export const applyPostStateConfig = (manifest: Config) => {
  applyLabels(manifest);
};
