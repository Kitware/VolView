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
import type { LayoutConfigItem } from '@/src/utils/layoutParsing';

// --------------------------------------------------------------------------
// Layout Specifications (Zod schema only, parsing is in views.ts)

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

const layouts = z.record(z.string(), layoutConfig).optional();

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

const disabledViewTypes = z.array(z.enum(['2D', '3D', 'Oblique'])).optional();

export const config = z.object({
  layouts,
  labels,
  shortcuts,
  io,
  windowing,
  disabledViewTypes,
});

export type Config = z.infer<typeof config>;

export const readConfigFile = async (configFile: File) => {
  const decoder = new TextDecoder();
  const ab = await configFile.arrayBuffer();
  const text = decoder.decode(new Uint8Array(ab));
  return config.parse(JSON.parse(text));
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
  if (!manifest.layouts) return;

  const viewStore = useViewStore();
  const layoutEntries = Object.entries(manifest.layouts);

  if (layoutEntries.length === 0) return;

  viewStore.setNamedLayoutsFromConfig(manifest.layouts);

  const firstLayoutName = layoutEntries[0][0];
  viewStore.switchToNamedLayout(firstLayoutName);
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

const applyDisabledViewTypes = (manifest: Config) => {
  if (!manifest.disabledViewTypes) return;

  useViewStore().disabledViewTypes = manifest.disabledViewTypes;
};

export const applyPreStateConfig = (manifest: Config) => {
  applyDisabledViewTypes(manifest);
  applyLayout(manifest);
  applyShortcuts(manifest);
  applyIo(manifest);
  applyWindowing(manifest);
};

export const applyPostStateConfig = (manifest: Config) => {
  applyLabels(manifest);
};
