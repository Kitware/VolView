import { manifestDatasets, type Manifest } from '@/src/io/state-file/schema';
import { leafStateId } from '@/src/io/import/dataSource';
import type { ProcessingResultSource } from '@/src/types';
import type { Extent3D } from '@/src/segmentation/geometry';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

/** A saved mask, with its own archive entry or awaiting an import's split. */
export type PlannedMask = {
  segmentId: string;
  // Reports name a mask by its segment.
  name: string;
  labelmap?: {
    path: string;
    extent: Extent3D;
    source?: ProcessingResultSource;
  };
};

export type PlannedSegmentation = {
  parentImage: string;
  masks: PlannedMask[];
};

/** A whole labelmap to split, with optional assignments to saved masks. */
export type LabelmapImport = {
  id: string;
  parentImage: string;
  name: string;
  path?: string;
  source?: ProcessingResultSource;
  masks: Array<{ mask: PlannedMask; value: number }>;
  decode: boolean;
  activeValue?: number;
  display: {
    fillOpacity?: number;
    outlineOpacity?: number;
    visible?: boolean;
  };
};

/**
 * Translate the incoming wire contract once; masks never retain import
 * references.
 */
export function planLabelmapImports(manifest: Manifest) {
  const artifactMasks: Array<{
    artifactId: string;
    mask: PlannedMask;
    value: number;
  }> = [];
  const segmentations: PlannedSegmentation[] = (
    manifest.imageSegments ?? []
  ).map((entry) => ({
    parentImage: entry.imageId,
    masks: entry.segments.flatMap(({ id: segmentId, name, labelmap }) => {
      if (!labelmap) return [];
      if (labelmap.path !== undefined)
        return [
          {
            segmentId,
            name,
            labelmap: {
              path: labelmap.path,
              extent: labelmap.extent,
              source: labelmap.source,
            },
          },
        ];
      const mask = { segmentId, name };
      if (labelmap.artifactId !== undefined)
        artifactMasks.push({
          artifactId: labelmap.artifactId,
          mask,
          value: labelmap.sourceValue ?? SEGMENT_VALUE,
        });
      return [mask];
    }),
  }));
  const imports: LabelmapImport[] = (manifest.segmentationArtifacts ?? []).map(
    (entry) => {
      const masks = artifactMasks
        .filter(({ artifactId }) => artifactId === entry.id)
        .map(({ mask, value }) => ({ mask, value }));
      return {
        id: entry.id,
        parentImage: entry.parentImage,
        name: entry.name,
        path: entry.path,
        source: entry.source,
        masks,
        decode: masks.length === 0,
        activeValue: entry.pendingActiveValue,
        display: {
          fillOpacity: entry.pendingFillOpacity,
          outlineOpacity: entry.pendingOutlineOpacity,
          visible: entry.pendingVisibility,
        },
      };
    }
  );
  return { segmentations, imports };
}

export type LabelmapRestoreSource = { stateId: string; temporary: boolean };

/**
 * Sources already loaded as datasets are borrowed; other inputs are owned by
 * restore. A manifest without `datasets` treats every uri as one, so a covered
 * artifact source there is still restore-owned.
 */
export function planLabelmapSources(manifest: Manifest) {
  const datasetBySource = new Map(
    manifestDatasets(manifest).map((ds) => [ds.dataSourceId, ds.id])
  );
  const leaves = new Map<number, string>();
  const sources: Record<string, LabelmapRestoreSource> = {};
  (manifest.segmentationArtifacts ?? []).forEach((entry) => {
    const { path, dataSourceId } = entry;
    if (path !== undefined || dataSourceId === undefined) return;
    const datasetId = datasetBySource.get(dataSourceId);
    const stateId = datasetId ?? leafStateId(dataSourceId);
    if (datasetId === undefined) leaves.set(dataSourceId, stateId);
    sources[entry.id] = {
      stateId,
      temporary: datasetId === undefined || manifest.datasets === undefined,
    };
  });
  return {
    leaves: [...leaves].map(([dataSourceId, id]) => ({ id, dataSourceId })),
    sources,
  };
}
