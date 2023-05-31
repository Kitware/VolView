import { z } from 'zod';

import { ImportHandler } from '@/src/io/import/common';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';

const Color = z.string();

const Label = z.object({
  color: Color,
});

const RectangleLabel = z.intersection(
  Label,
  z.object({
    fillColor: Color,
  })
);

const Config = z.object({
  labels: z.record(Label).or(z.null()),
  rectangleLabels: z.record(RectangleLabel).or(z.null()).optional(),
});

const readConfigFile = async (configFile: File) => {
  const decoder = new TextDecoder();
  const ab = await configFile.arrayBuffer();
  const text = decoder.decode(new Uint8Array(ab));
  return Config.parse(JSON.parse(text));
};

const applyConfig = (manifest: z.infer<typeof Config>) => {
  useRulerStore().setLabels(manifest.labels);
  useRectangleStore().setLabels(manifest.rectangleLabels ?? manifest.labels);
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
