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
  const segments = new Map(
    manifest.segments?.map((segment) => [segment.id, segment])
  );
  return (manifest.segmentations ?? [])
    .filter((segmentation) => segmentation.parentImage === imageId)
    .flatMap((segmentation) =>
      segmentation.masks.map((mask) => {
        const binding = mask.representations.labelmap;
        return {
          id: mask.id,
          segmentId: mask.segmentId,
          segment: segments.get(mask.segmentId),
          extent: binding?.extent,
          source: binding?.source,
          artifact: binding?.path ? artifacts.get(binding.path) : undefined,
        };
      })
    );
};
