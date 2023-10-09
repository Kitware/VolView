import { z } from 'zod';

import { ImportHandler } from '@/src/io/import/common';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useDataBrowserStore } from '@/src/store/data-browser';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useViewStore } from '@/src/store/views';
import { Layouts } from '@/src/config';
import { ensureError, zodEnumFromObjKeys } from '@/src/utils';
import { ACTIONS } from '@/src/constants';
import { actionToKey } from '@/src/composables/useKeyboardShortcuts';

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

const config = z.object({
  layout,
  dataBrowser,
  labels,
  shortcuts,
});

type Config = z.infer<typeof config>;

const readConfigFile = async (configFile: File) => {
  const decoder = new TextDecoder();
  const ab = await configFile.arrayBuffer();
  const text = decoder.decode(new Uint8Array(ab));
  return config.parse(JSON.parse(text));
};

const applyLabels = (manifest: Config) => {
  if (!manifest.labels) return;

  // pass through null labels, use fallback labels if undefined
  const labelsIfUndefined = (
    toolLabels: (typeof manifest.labels)[keyof typeof manifest.labels]
  ) => {
    if (toolLabels === undefined) return manifest.labels?.defaultLabels;
    return toolLabels;
  };

  const { rulerLabels, rectangleLabels, polygonLabels } = manifest.labels;
  useRulerStore().mergeLabels(labelsIfUndefined(rulerLabels));
  useRectangleStore().mergeLabels(labelsIfUndefined(rectangleLabels));
  usePolygonStore().mergeLabels(labelsIfUndefined(polygonLabels));
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

const applyConfig = (manifest: Config) => {
  applyLayout(manifest);
  applyLabels(manifest);
  applySampleData(manifest);
  applyShortcuts(manifest);
};

/**
 * Reads a JSON file with label config and updates stores.
 * @param dataSource
 * @returns
 */
const handleConfig: ImportHandler = async (dataSource, { done }) => {
  const { fileSrc } = dataSource;
  if (fileSrc?.fileType === 'application/json') {
    try {
      const manifest = await readConfigFile(fileSrc.file);
      applyConfig(manifest);
    } catch (err) {
      console.error(err);
      throw new Error('Failed to parse config file', {
        cause: ensureError(err),
      });
    }
    return done();
  }
  return dataSource;
};

export default handleConfig;
