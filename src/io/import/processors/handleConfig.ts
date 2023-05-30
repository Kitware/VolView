import { z } from 'zod';

import { ImportHandler } from '@/src/io/import/common';
// import { useRectangleStore } from '@/src/store/tools/rectangles';

const Color = z.union([z.string(), z.number()]);

const Label = z.object({
  lineColor: Color,
});

const RectangleLabel = z.intersection(
  Label,
  z.object({
    fillColor: Color,
  })
);

const ConfigJson = z.object({
  labels: z.record(Label),
  rectangleLabels: z.record(RectangleLabel),
});

const readConfigFile = async (manifestFile: File) => {
  const decoder = new TextDecoder();
  const ab = await manifestFile.arrayBuffer();
  const text = decoder.decode(new Uint8Array(ab));
  const manifest = ConfigJson.parse(JSON.parse(text));
  return manifest;
};

const applyConfig = (manifest: z.infer<typeof ConfigJson>) => {
  console.log(manifest);
  //   useRectangleStore().setLabels(manifest.rectangleLabels);
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
