import JSZip from 'jszip';
import { useDatasetStore } from '@/src/store/datasets';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useLayersStore } from '@/src/store/datasets-layers';
import { useToolStore } from '@/src/store/tools';
import { Tools } from '@/src/store/tools/types';
import { useViewStore } from '@/src/store/views';
import {
  Manifest,
  ManifestSchema,
  ParentToLayers,
  SegmentGroup,
} from '@/src/io/state-file/schema';

import { retypeFile } from '@/src/io';
import { ARCHIVE_FILE_TYPES } from '@/src/io/mimeTypes';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { useViewConfigStore } from '@/src/store/view-configs';
import { useMessageStore } from '@/src/store/messages';
import { debug } from '@/src/utils/loggers';
import { isRecord } from '@/src/utils';

export const MANIFEST = 'manifest.json';
export const MANIFEST_VERSION = '6.4.0';

type ManifestCandidate = Record<string, unknown>;

const coreManifestSchema = ManifestSchema.pick({
  version: true,
  datasets: true,
  dataSources: true,
  datasetFilePath: true,
});

function validateCoreGraph(core: Manifest, zip: JSZip) {
  if (core.version !== MANIFEST_VERSION) {
    throw new Error(
      `Cannot save unsupported manifest version: ${core.version}`
    );
  }
  const sourceIds = new Set<number>();
  core.dataSources.forEach((source) => {
    if (sourceIds.has(source.id)) {
      throw new Error(`Cannot save duplicate data source id: ${source.id}`);
    }
    sourceIds.add(source.id);
  });

  const dependencies = new Map<number, number[]>();
  core.dataSources.forEach((source) => {
    const refs = [
      ...(source.parent == null ? [] : [source.parent]),
      ...(source.type === 'collection' ? source.sources : []),
    ];
    refs.forEach((ref) => {
      if (!sourceIds.has(ref)) {
        throw new Error(
          `Cannot save data source ${source.id}: referenced source ${ref} is missing`
        );
      }
    });
    dependencies.set(source.id, refs);
    if (source.type === 'file') {
      const path = core.datasetFilePath?.[String(source.fileId)];
      if (!path || zip.file(path) === null) {
        throw new Error(
          `Cannot save data source ${source.id}: required local file is missing`
        );
      }
    }
  });

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const visit = (id: number) => {
    if (visiting.has(id)) {
      throw new Error(`Cannot save cyclic data source graph at ${id}`);
    }
    if (visited.has(id)) return;
    visiting.add(id);
    dependencies.get(id)?.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  sourceIds.forEach(visit);

  const datasetIds = new Set<string>();
  (core.datasets ?? []).forEach((dataset) => {
    if (datasetIds.has(dataset.id)) {
      throw new Error(`Cannot save duplicate dataset id: ${dataset.id}`);
    }
    if (!sourceIds.has(dataset.dataSourceId)) {
      throw new Error(
        `Cannot save dataset ${dataset.id}: data source ${dataset.dataSourceId} is missing`
      );
    }
    datasetIds.add(dataset.id);
  });
  return { sourceIds, datasetIds };
}

// Last gate before a session archive is written. Three responsibilities:
//
//   1. Abort on an incoherent core graph (`validateCoreGraph`) — a bad version,
//      duplicate/dangling/cyclic data-source refs, missing local files, or a
//      dataset pointing at no source. Corruption here yields an UNrestorable
//      archive, so it throws rather than omits.
//   2. Prune segment groups (and their orphaned archive members from the zip)
//      and layer relationships that reference a missing dataset/source.
//   3. Drop any optional root whose SHAPE fails the schema, gracefully.
//
// Referential integrity of the OTHER optional state (view `dataID`s, annotation
// `imageID`s, crop keys, the active paint group, primary/active selections) is
// owned by the synchronous remove cascade — see `datasetStore.remove` and
// `datasetRemoveCascade.spec.ts`. Those ids are kept live-clean at the source,
// and a stale one is harmless on restore anyway (deserialize remaps every id
// through its id-map and ignores misses), so this function does not re-walk
// them. Segment groups stay here because an orphaned one leaves dead `.seg.nrrd`
// bytes in the archive, which is a real cost the cascade does not address.
export function normalizeManifest(manifest: Manifest, zip: JSZip) {
  const candidate = manifest as unknown as ManifestCandidate;
  const core = coreManifestSchema.parse(candidate) as Manifest;
  const { sourceIds, datasetIds } = validateCoreGraph(core, zip);
  const omitted: string[] = [];

  const rawGroups = Array.isArray(candidate.segmentGroups)
    ? candidate.segmentGroups
    : [];
  const validGroups = rawGroups.flatMap((raw, index) => {
    const parsed = SegmentGroup.safeParse(raw);
    const name =
      isRecord(raw) &&
      isRecord(raw.metadata) &&
      typeof raw.metadata.name === 'string'
        ? raw.metadata.name
        : `segmentGroups[${index}]`;
    let reason: string | null = null;
    if (!parsed.success) reason = 'invalid segment-group record';
    else if (!datasetIds.has(parsed.data.metadata.parentImage)) {
      reason = `parent dataset ${parsed.data.metadata.parentImage} is missing`;
    } else if (
      parsed.data.dataSourceId !== undefined &&
      !sourceIds.has(parsed.data.dataSourceId)
    ) {
      reason = `artifact data source ${parsed.data.dataSourceId} is missing`;
    } else if (parsed.data.path && zip.file(parsed.data.path) === null) {
      reason = `archive member ${parsed.data.path} is missing`;
    }
    if (!parsed.success || reason) {
      omitted.push(`${name}: ${reason}`);
      if (isRecord(raw) && typeof raw.path === 'string') zip.remove(raw.path);
      return [];
    }
    return [parsed.data];
  });

  let validLayers: ParentToLayers | undefined;
  if (Array.isArray(candidate.parentToLayers)) {
    validLayers = candidate.parentToLayers.flatMap((raw, index) => {
      const parsed = ParentToLayers.element.safeParse(raw);
      if (
        !parsed.success ||
        !datasetIds.has(parsed.data.selectionKey) ||
        parsed.data.sourceSelectionKeys.some((id) => !datasetIds.has(id))
      ) {
        omitted.push(`layer relationship ${index}: missing or invalid dataset`);
        return [];
      }
      return [parsed.data];
    });
  } else if (candidate.parentToLayers !== undefined) {
    omitted.push('parentToLayers: invalid optional state');
  }

  // Dev-only cascade-gap backstop (DCE'd in prod by the NODE_ENV guard).
  // Referential integrity of these dataset/view/group-keyed sections is owned by
  // the synchronous remove cascade — a load-bearing but UNENFORCED invariant. A
  // store that keys manifest state off a dataset id and forgets an onImageDeleted
  // registration would silently ship an orphan here; detect and REPORT that in
  // dev/test without mutating output. (A cascade registry that tracks new stores
  // automatically is the eventual fix; this hand-walked list is today's stopgap.)
  if (process.env.NODE_ENV !== 'production') {
    const groupIds = new Set(validGroups.map((group) => group.id));
    const dangling: string[] = [];
    const flagDataset = (ref: unknown, where: string) => {
      if (typeof ref === 'string' && !datasetIds.has(ref))
        dangling.push(`${where} -> dataset ${ref}`);
    };
    const views = isRecord(candidate.viewByID) ? candidate.viewByID : {};
    Object.entries(views).forEach(([id, raw]) => {
      if (isRecord(raw)) flagDataset(raw.dataID, `viewByID[${id}].dataID`);
    });
    if (isRecord(candidate.tools)) {
      const tools = candidate.tools;
      (['rulers', 'rectangles', 'polygons'] as const).forEach((key) => {
        const section = tools[key];
        if (!isRecord(section) || !Array.isArray(section.tools)) return;
        section.tools.forEach((entry, i) => {
          if (isRecord(entry))
            flagDataset(entry.imageID, `tools.${key}[${i}].imageID`);
        });
      });
      if (isRecord(tools.crop))
        Object.keys(tools.crop).forEach((id) =>
          flagDataset(id, `tools.crop[${id}]`)
        );
      const paint = tools.paint;
      if (
        isRecord(paint) &&
        typeof paint.activeSegmentGroupID === 'string' &&
        !groupIds.has(paint.activeSegmentGroupID)
      )
        dangling.push(
          `tools.paint.activeSegmentGroupID -> segment group ${paint.activeSegmentGroupID}`
        );
    }
    flagDataset(candidate.primarySelection, 'primarySelection');
    if (
      typeof candidate.activeView === 'string' &&
      !(candidate.activeView in views)
    )
      dangling.push(`activeView -> view ${candidate.activeView}`);
    if (Array.isArray(candidate.layoutSlots))
      candidate.layoutSlots.forEach((id) => {
        if (typeof id === 'string' && !(id in views))
          dangling.push(`layoutSlots -> view ${id}`);
      });
    if (dangling.length > 0)
      debug.warn(
        'normalizeManifest: dangling reference(s) reached save without being ' +
          'stripped — a store is likely missing an onImageDeleted remove-cascade ' +
          `registration: ${dangling.join('; ')}`
      );
  }

  // Each optional root is validated against ITS OWN field schema. ManifestSchema
  // is a plain object with no cross-field refinement, so a field valid in
  // isolation is valid in the full manifest — and the output is assembled from
  // the parsed pieces, so nothing is validated (or deep-copied) twice.
  const optionalRoots = [
    'tools',
    'activeView',
    'isActiveViewMaximized',
    'viewByID',
    'primarySelection',
    'layout',
    'layoutSlots',
  ] as const;
  const optionalEntries = optionalRoots.flatMap((key) => {
    if (candidate[key] === undefined) return [];
    const parsed = ManifestSchema.shape[key].safeParse(candidate[key]);
    if (!parsed.success) {
      omitted.push(`${key}: invalid optional state`);
      return [];
    }
    return [[key, parsed.data] as const];
  });

  const normalized = {
    ...core,
    segmentGroups: validGroups,
    ...(validLayers ? { parentToLayers: validLayers } : {}),
    ...Object.fromEntries(optionalEntries),
  } as Manifest;
  return { manifest: normalized, omitted };
}

export async function serialize() {
  const datasetStore = useDatasetStore();
  const viewStore = useViewStore();
  const labelStore = useSegmentGroupStore();
  const toolStore = useToolStore();
  const layersStore = useLayersStore();

  const zip = new JSZip();
  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    datasets: [],
    dataSources: [],
    datasetFilePath: {},
    segmentGroups: [],
    tools: {
      crosshairs: {
        position: [0, 0, 0],
      },
      paint: {
        activeSegmentGroupID: null,
        activeSegment: null,
        brushSize: 8,
        crossPlaneSync: false,
      },
      crop: {},
      current: Tools.WindowLevel,
    },
    layout: {
      direction: 'column',
      items: [],
    },
    layoutSlots: [],
    viewByID: {},
    isActiveViewMaximized: false,
    parentToLayers: [],
  };

  const stateFile = {
    zip,
    manifest,
  };

  await datasetStore.serialize(stateFile);
  viewStore.serialize(stateFile);
  await useViewConfigStore().serialize(stateFile);
  await labelStore.serialize(stateFile);
  toolStore.serialize(stateFile);
  await layersStore.serialize(stateFile);
  const repaired = normalizeManifest(manifest, zip);
  if (repaired.omitted.length > 0) {
    useMessageStore().addWarning('Some session content could not be saved', {
      details: `Invalid entries were omitted: ${repaired.omitted.join(', ')}`,
      persist: true,
    });
  }
  zip.file(MANIFEST, JSON.stringify(repaired.manifest));

  return zip.generateAsync({ type: 'blob' });
}

export async function isStateFile(file: File) {
  const typedFile = await retypeFile(file);

  if (ARCHIVE_FILE_TYPES.has(typedFile.type)) {
    const zip = await JSZip.loadAsync(typedFile);
    return zip.file(MANIFEST) !== null;
  }

  if (typedFile.type === 'application/json') {
    try {
      const text = await file.text();
      const migrated = migrateManifest(text);
      ManifestSchema.parse(migrated);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
