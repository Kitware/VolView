import type { Manifest } from '@/src/io/state-file/schema';
import {
  inMemoryArtifactIO,
  manifestForImages,
  serializeToStateFiles,
  serializeAnnotations,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

export const serializeScene = async (imageIds: string[]) => {
  const codec = inMemoryArtifactIO();
  const snapshots = new Map<
    string,
    { dimensions: number[]; values: number[] }
  >();
  const io = {
    ...codec,
    write: async (...args: Parameters<typeof codec.write>) => {
      const image = args[1];
      const snapshot = {
        dimensions: [...image.getDimensions()],
        values: Array.from(image.getPointData().getScalars().getData()),
      };
      const token = await codec.write(...args);
      snapshots.set(token, snapshot);
      return token;
    },
  };
  const { parsed, stateFiles, zip } = await serializeToStateFiles(
    serializeAnnotations(manifestForImages(imageIds, { tools: {} })),
    io
  );
  const artifacts = new Map(
    await Promise.all(
      stateFiles.map(async ({ archivePath }) => {
        const token = await zip.file(archivePath)!.async('string');
        return [archivePath, snapshots.get(token)!] as const;
      })
    )
  );
  return { manifest: parsed as Manifest, artifacts, stateFiles, io };
};

export const savedMasks = (
  scene: Awaited<ReturnType<typeof serializeScene>>,
  imageId: string
) => {
  const { manifest, artifacts } = scene;
  return (manifest.imageSegments ?? [])
    .filter((entry) => entry.imageId === imageId)
    .flatMap((entry) =>
      entry.segments.flatMap(({ labelmap, ...segment }) =>
        labelmap
          ? [
              {
                segmentId: segment.id,
                segment,
                extent: labelmap.extent,
                source: labelmap.source,
                artifact: labelmap.path
                  ? artifacts.get(labelmap.path)
                  : undefined,
              },
            ]
          : []
      )
    );
};
