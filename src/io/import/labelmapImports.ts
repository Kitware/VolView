import {
  manifestDatasets,
  type Manifest,
  type Segmentation,
} from '@/src/io/state-file/schema';
import { leafStateId } from '@/src/io/import/dataSource';
import type { ProcessingResultSource } from '@/src/types';
import { SEGMENT_VALUE } from '@/src/segmentation/masks/labelValue';

/** A whole labelmap to split, with optional assignments to existing masks. */
export type LabelmapImport = {
  id: string;
  parentImage: string;
  name: string;
  input: { path: string } | { dataSourceId: number };
  source?: ProcessingResultSource;
  masks: Array<{ maskId: string; value: number }>;
  decode: boolean;
  activeValue?: number;
  display: {
    fillOpacity?: number;
    outlineOpacity?: number;
    visible?: boolean;
  };
};

/** Translate the incoming wire contract once; masks never retain import references. */
export function planLabelmapImports(manifest: Manifest) {
  const assignments = new Map<string, LabelmapImport['masks']>();
  const segmentations: Segmentation[] = (manifest.segmentations ?? []).map(
    (wire) => ({
      ...wire,
      masks: wire.masks.map((mask) => {
        const binding = mask.representations.labelmap;
        if (binding?.artifactId !== undefined) {
          const masks = assignments.get(binding.artifactId) ?? [];
          masks.push({
            maskId: mask.id,
            value: binding.sourceValue ?? SEGMENT_VALUE,
          });
          assignments.set(binding.artifactId, masks);
        }
        return {
          ...mask,
          representations:
            binding?.path === undefined
              ? {}
              : {
                  labelmap: {
                    path: binding.path,
                    extent: binding.extent,
                    name: binding.name,
                    source: binding.source,
                  },
                },
        };
      }),
    })
  );
  const imports: LabelmapImport[] = (manifest.segmentationArtifacts ?? []).map(
    (entry) => {
      const masks = assignments.get(entry.id) ?? [];
      return {
        id: entry.id,
        parentImage: entry.parentImage,
        name: entry.name,
        input:
          entry.path !== undefined
            ? { path: entry.path }
            : { dataSourceId: entry.dataSourceId! },
        source: entry.source,
        masks,
        decode: entry.pendingDecode === true || masks.length === 0,
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

/** Sources already loaded as datasets are borrowed; other inputs are owned by restore. */
export function planLabelmapSources(manifest: Manifest) {
  const datasetBySource = new Map(
    manifestDatasets(manifest).map((ds) => [ds.dataSourceId, ds.id])
  );
  const sourceIds = new Set(manifest.dataSources.map((source) => source.id));
  const leaves = new Map<number, string>();
  const sources: Record<string, LabelmapRestoreSource> = {};
  planLabelmapImports(manifest).imports.forEach((item) => {
    if (!('dataSourceId' in item.input)) return;
    const { dataSourceId } = item.input;
    if (!sourceIds.has(dataSourceId)) return;
    const datasetId = datasetBySource.get(dataSourceId);
    const stateId = datasetId ?? leafStateId(dataSourceId);
    if (datasetId === undefined) leaves.set(dataSourceId, stateId);
    sources[item.id] = {
      stateId,
      temporary: datasetId === undefined || manifest.datasets === undefined,
    };
  });
  return { leaves, sources };
}

export const resolveLabelmapSources = (manifest: Manifest) =>
  planLabelmapSources(manifest).sources;
