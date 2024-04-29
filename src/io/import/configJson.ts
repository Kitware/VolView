import { z } from 'zod';
import { zodEnumFromObjKeys } from '@/src/utils';
import { ACTIONS } from '@/src/constants';
import { Layouts } from '@/src/config';

// for applyConfig
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useDataBrowserStore } from '@/src/store/data-browser';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useViewStore } from '@/src/store/views';
import { actionToKey } from '@/src/composables/useKeyboardShortcuts';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import useLoadDataStore from '@/src/store/load-data';

// --------------------------------------------------------------------------
// Interface

const layout = z
  .object({
    activeLayout: zodEnumFromObjKeys(Layouts).optional(),
  })
  .optional();

const dataBrowser = z
  .object({
    hideSampleData: z.boolean().optional(),
  })
  .optional();

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

export const config = z.object({
  layout,
  dataBrowser,
  labels,
  shortcuts,
  io,
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

const applySampleData = (manifest: Config) => {
  useDataBrowserStore().hideSampleData = !!manifest.dataBrowser?.hideSampleData;
};

const applyLayout = (manifest: Config) => {
  if (manifest.layout?.activeLayout) {
    const startingLayout = Layouts[manifest.layout.activeLayout];
    useViewStore().setLayout(startingLayout);
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

export const applyConfig = (manifest: Config) => {
  applyLayout(manifest);
  applyLabels(manifest);
  applySampleData(manifest);
  applyShortcuts(manifest);
  applyIo(manifest);
};
