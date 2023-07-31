import { z } from 'zod';

import { ImportHandler } from '@/src/io/import/common';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useDataBrowserStore } from '@/src/store/data-browser';

const color = z.string();

const label = z.object({
  color,
});

const rulerLabel = label;

const rectangleLabel = z.intersection(
  label,
  z.object({
    fillColor: color,
  })
);

const dataBrowser = z
  .object({
    hideSampleData: z.boolean().optional(),
  })
  .optional();

const config = z.object({
  labels: z.record(label).or(z.null()).optional(),
  rulerLabels: z.record(rulerLabel).or(z.null()).optional(),
  rectangleLabels: z.record(rectangleLabel).or(z.null()).optional(),
  dataBrowser,
});

type Config = z.infer<typeof config>;

const readConfigFile = async (configFile: File) => {
  const decoder = new TextDecoder();
  const ab = await configFile.arrayBuffer();
  const text = decoder.decode(new Uint8Array(ab));
  return config.parse(JSON.parse(text));
};

const applyLabels = (manifest: Config) => {
  // pass through null labels, use fallback labels if undefined
  const labelsIfUndefined = (toolLabels: typeof manifest.labels) => {
    if (toolLabels === undefined) return manifest.labels;
    return toolLabels;
  };
  useRulerStore().mergeLabels(labelsIfUndefined(manifest.rulerLabels));
  useRectangleStore().mergeLabels(labelsIfUndefined(manifest.rectangleLabels));
};

const applySampleData = (manifest: Config) => {
  useDataBrowserStore().hideSampleData = !!manifest.dataBrowser?.hideSampleData;
};

const applyConfig = (manifest: Config) => {
  applyLabels(manifest);
  applySampleData(manifest);
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
      return dataSource;
    }
    return done();
  }
  return dataSource;
};

export default handleConfig;
