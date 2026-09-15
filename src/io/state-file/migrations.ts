import { pipe } from '@/src/utils/functional';
import { emptyExtent } from '@/src/segmentation/geometry';
import { cssColorToRGBA } from '@/src/segmentation/color';
import {
  dataSourcesById,
  summarizeDataSource,
} from '@/src/io/state-file/dataSourceDisplayName';
import type { DataSourceType } from '@/src/io/state-file/schema';

const migrateOrPass =
  (versions: Array<string>, migrationFunc: (manifest: any) => any) =>
  (inputManifest: any) => {
    if (versions.includes(inputManifest.version)) {
      return migrationFunc(inputManifest);
    }
    return inputManifest;
  };

const migrate501To600 = (inputManifest: any) => {
  const manifest = JSON.parse(JSON.stringify(inputManifest));

  if (manifest.views && Array.isArray(manifest.views)) {
    manifest.viewByID = {};
    manifest.views.forEach((view: any) => {
      const migratedView = { ...view };

      if (!migratedView.name) {
        migratedView.name = migratedView.id;
      }

      if (migratedView.props) {
        migratedView.options = {};
        Object.entries(migratedView.props).forEach(([key, value]) => {
          if (typeof value === 'string') {
            migratedView.options[key] = value;
          } else {
            migratedView.options[key] = JSON.stringify(value);
          }
        });
        delete migratedView.props;
      }

      if (migratedView.type === '2D' && !migratedView.options) {
        migratedView.options = {};
      }
      if (migratedView.type === '2D') {
        if (['Coronal', 'Sagittal', 'Axial'].includes(migratedView.id)) {
          migratedView.options.orientation = migratedView.id;
        }
      }

      if (migratedView.type === 'Oblique3D') {
        migratedView.type = 'Oblique';
      }

      const configKeys = Object.keys(migratedView.config || {});
      const primarySelection = manifest.primarySelection;

      migratedView.dataID = null;
      if (configKeys.length > 0) {
        migratedView.dataID =
          primarySelection && configKeys.includes(primarySelection)
            ? primarySelection
            : configKeys[0];
      }

      manifest.viewByID[migratedView.id] = migratedView;
    });
    delete manifest.views;
  }

  if (manifest.isActiveViewMaximized === undefined) {
    manifest.isActiveViewMaximized = false;
  }

  if (manifest.activeView === undefined) {
    manifest.activeView = null;
  }

  if (manifest.layout && !manifest.layoutSlots) {
    const slots: string[] = [];

    const convertLayoutItem = (item: any): any => {
      if (typeof item === 'string') {
        const slotIndex = slots.length;
        slots.push(item);
        return {
          type: 'slot',
          slotIndex,
        };
      }
      if (item.direction && item.items) {
        return {
          type: 'layout',
          direction: item.direction,
          items: item.items.map(convertLayoutItem),
        };
      }
      return item;
    };

    if (manifest.layout.direction && manifest.layout.items) {
      manifest.layout = {
        direction: manifest.layout.direction,
        items: manifest.layout.items.map(convertLayoutItem),
      };
    }

    manifest.layoutSlots = slots;
  }

  if (!manifest.parentToLayers) {
    manifest.parentToLayers = [];
  }

  manifest.version = '6.0.0';
  return manifest;
};

const migrate600To610 = (inputManifest: any) => {
  const manifest = JSON.parse(JSON.stringify(inputManifest));

  const migrateDirection = (dir: 'H' | 'V'): 'row' | 'column' => {
    return dir === 'H' ? 'column' : 'row';
  };

  const migrateLayout = (layout: any): any => {
    if (!layout || typeof layout !== 'object') return layout;

    const migratedLayout = { ...layout };

    if (layout.direction) {
      migratedLayout.direction = migrateDirection(layout.direction);
    }

    if (layout.items && Array.isArray(layout.items)) {
      migratedLayout.items = layout.items.map((item: any) => {
        if (item.type === 'layout') {
          return migrateLayout(item);
        }
        return item;
      });
    }

    return migratedLayout;
  };

  if (manifest.layout) {
    manifest.layout = migrateLayout(manifest.layout);
  }

  manifest.version = '6.1.0';
  return manifest;
};

const migrate610To620 = (inputManifest: any) => {
  const manifest = JSON.parse(JSON.stringify(inputManifest));
  manifest.segmentGroups = inputManifest.labelMaps;
  delete manifest.labelMaps;
  manifest.version = '6.2.0';
  return manifest;
};

// 6.3.0 -> 6.4.0 adds the optional `source` provenance tag to segment-group
// metadata and to annotation tools (rulers, rectangles, polygons). The field is
// additive-optional, so an older manifest that lacks it still validates — the
// bump only stamps the version (no data transform). No 6.2.0 -> 6.3.0 step
// exists: a 6.2 manifest validates unmodified.
const migrate630To640 = (inputManifest: any) => ({
  ...inputManifest,
  version: '6.4.0',
});

// A manifest saved before `datasets` existed lets every uri source stand in for
// one, keyed by its stringified source id, matching `manifestDatasets`.
const datasetDisplayName = (manifest: any, datasetId: string) => {
  const sources: DataSourceType[] = Array.isArray(manifest.dataSources)
    ? manifest.dataSources
    : [];
  const datasets: any[] = Array.isArray(manifest.datasets)
    ? manifest.datasets
    : sources
        .filter((source) => source.type === 'uri')
        .map((source) => ({ id: String(source.id), dataSourceId: source.id }));
  const dataset = datasets.find((entry) => entry.id === datasetId);
  if (!dataset) return datasetId;
  return summarizeDataSource(
    dataset.dataSourceId,
    dataSourcesById(sources),
    manifest.datasetFilePath,
    datasetId
  );
};

// Descriptor values in `order`, then any byValue entry `order` forgot.
const descriptorValues = (descriptors: any) => {
  const byValue = descriptors?.byValue ?? {};
  const ordered: number[] = (
    Array.isArray(descriptors?.order) ? descriptors.order : []
  ).filter((value: number) => String(value) in byValue);
  const rest = Object.keys(byValue)
    .map(Number)
    .filter((value) => !ordered.includes(value))
    .sort((a, b) => a - b);
  return [...ordered, ...rest];
};

const numberOrUndefined = (value: unknown) =>
  typeof value === 'number' ? value : undefined;

const booleanOrUndefined = (value: unknown) =>
  typeof value === 'boolean' ? value : undefined;

const legacyViewGroupDisplay = (view: any, groupId: string) => {
  const config = view?.config?.[groupId];
  const blend = config?.layers?.blendConfig;
  const outline = config?.segmentGroup;
  return {
    fillOpacity: numberOrUndefined(blend?.opacity),
    visible: booleanOrUndefined(blend?.visibility),
    outlineOpacity: numberOrUndefined(outline?.outlineOpacity),
    outlineThickness: numberOrUndefined(outline?.outlineThickness),
  };
};

// A 6.4.0 group rendered at the layer opacity default unless a view saved one.
const LEGACY_GROUP_FILL_OPACITY_DEFAULT = 0.3;

const legacyFillOpacity = (
  display: ReturnType<typeof legacyViewGroupDisplay>
) => display.fillOpacity ?? LEGACY_GROUP_FILL_OPACITY_DEFAULT;

// A zero on the segmentation leaves nothing for a segment to be a share of, and
// every group under it was hidden anyway.
const fillShareOf = (
  display: ReturnType<typeof legacyViewGroupDisplay>,
  parentFill: number
) => (parentFill === 0 ? 1 : legacyFillOpacity(display) / parentFill);

const legacyGroupDisplay = (manifest: any, groupId: string) => {
  // These controls were synchronized across 2D views. Read the first value
  // each view supplies so a partially populated view does not hide another.
  return Object.values(manifest.viewByID ?? {})
    .map((view) => legacyViewGroupDisplay(view, groupId))
    .reduce(
      (display, next) => ({
        fillOpacity: display.fillOpacity ?? next.fillOpacity,
        visible: display.visible ?? next.visible,
        outlineOpacity: display.outlineOpacity ?? next.outlineOpacity,
        outlineThickness: display.outlineThickness ?? next.outlineThickness,
      }),
      {} as ReturnType<typeof legacyViewGroupDisplay>
    );
};

const migrateLegacyDisplay = (manifest: any) => {
  const displayByArtifact = new Map<
    string,
    ReturnType<typeof legacyGroupDisplay>
  >();
  const outlineThicknessByParent = new Map<string, number>();
  const fillByParent = new Map<string, number>();
  const artifacts: any[] = Array.isArray(manifest.segmentationArtifacts)
    ? manifest.segmentationArtifacts
    : [];

  artifacts.forEach((artifact) => {
    const display = legacyGroupDisplay(manifest, artifact.id);
    displayByArtifact.set(artifact.id, display);
    if (
      !outlineThicknessByParent.has(artifact.parentImage) &&
      display.outlineThickness !== undefined
    ) {
      // Several legacy groups can collapse into one segmentation. The new
      // model has one thickness for it, so the first configured group in
      // artifact order deterministically supplies that shared value.
      outlineThicknessByParent.set(
        artifact.parentImage,
        display.outlineThickness
      );
    }
    // Fill is a product of the segmentation's opacity and the segment's, and a
    // legacy group's opacity has to survive as that product. The largest of the
    // parent's groups goes on the segmentation, so every group's share of it
    // stays a fraction the per-segment slider can hold.
    fillByParent.set(
      artifact.parentImage,
      Math.max(
        fillByParent.get(artifact.parentImage) ?? 0,
        legacyFillOpacity(display)
      )
    );
  });

  const parentFillOf = (parentImage: string) =>
    fillByParent.get(parentImage) ?? LEGACY_GROUP_FILL_OPACITY_DEFAULT;

  const segmentById = new Map<string, any>(
    (Array.isArray(manifest.segments) ? manifest.segments : []).map(
      (type: any) => [type.id, type]
    )
  );

  const segmentations: any[] = Array.isArray(manifest.segmentations)
    ? manifest.segmentations
    : [];
  segmentations.forEach((segmentation) => {
    if (
      segmentation.outlineThickness === undefined &&
      outlineThicknessByParent.has(segmentation.parentImage)
    ) {
      segmentation.outlineThickness = outlineThicknessByParent.get(
        segmentation.parentImage
      );
    }

    const parentFill = parentFillOf(segmentation.parentImage);
    segmentation.fillOpacity = parentFill;

    // A legacy group described what it showed, so its opacity and its
    // visibility both land on the type the group became.
    (Array.isArray(segmentation.masks) ? segmentation.masks : []).forEach(
      (segment: any) => {
        const artifactId = segment.representations?.labelmap?.artifactId;
        const display = displayByArtifact.get(artifactId);
        const type = segmentById.get(segment.segmentId);
        if (!display || !type) return;
        type.fillOpacity = fillShareOf(display, parentFill);
        if (display.outlineOpacity !== undefined) {
          type.outlineOpacity = display.outlineOpacity;
        }
        if (display.visible !== undefined) {
          type.visible = (type.visible ?? true) && display.visible;
        }
      }
    );
  });

  // Only a group awaiting its decode needs these: it names no segments, so
  // there is no type for the loop above to have put its display on.
  artifacts.forEach((artifact) => {
    if (!artifact.pendingDecode) return;
    const display = displayByArtifact.get(artifact.id)!;
    artifact.pendingFillOpacity = fillShareOf(
      display,
      parentFillOf(artifact.parentImage)
    );
    if (display.outlineOpacity !== undefined) {
      artifact.pendingOutlineOpacity = display.outlineOpacity;
    }
    if (display.visible !== undefined) {
      artifact.pendingVisibility = display.visible;
    }
  });

  // These consumed view configs would otherwise restore under an unmapped
  // data id after the group is split.
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
  Object.values(manifest.viewByID ?? {}).forEach((view: any) => {
    if (!view?.config) return;
    artifactIds.forEach((artifactId) => {
      const config = view.config[artifactId];
      if (!config) return;
      delete config.layers;
      delete config.segmentGroup;
      if (Object.keys(config).length === 0) delete view.config[artifactId];
    });
  });
};

// 6.4.0 -> 7.0.0 moves identity off segment groups and off the vector tools'
// label records and onto segment types, with one per-image mask per
// type. JSON only: no voxels are read here, so a group is marked for the loaded
// restore stage to divide into one bounded mask per segment, enumerating its
// voxel values first when it carried no descriptors. Every binding's extent is
// a placeholder that stage replaces.
const migrate640To700 = (inputManifest: any) => {
  const manifest = JSON.parse(JSON.stringify(inputManifest));

  // Insertion order is the migrated order: groups in manifest order, then the
  // vector-tool labels in the order their tools reference them.
  const recordsByParent = new Map<string, any[]>();
  const segments: any[] = [];

  // Ids are built by joining legacy identifiers with '-', which those
  // identifiers may themselves contain, so distinct sources can produce the
  // same string. Restore keys a map on them, so a collision silently misroutes
  // one record onto another. Disambiguate deterministically.
  const usedIds = new Set<string>();
  const uniqueId = (candidate: string) => {
    let id = candidate;
    for (let n = 2; usedIds.has(id); n += 1) id = `${candidate}-${n}`;
    usedIds.add(id);
    return id;
  };

  const addSegment = (into: any[], id: string, type: any) => {
    into.push({ id, ...type });
    return id;
  };

  // One registry backs paint and the vector tools, so a name a segment group
  // already carries is that same segment when a tool label repeats it, and the
  // first to declare it sets the appearance. Groups themselves never merge:
  // two of them on one image would put two masks on one segment, and the app
  // keeps only one.
  const segmentIdByName: Record<string, string> = {};

  const addRecord = (parentImage: string, record: any) => {
    const records = recordsByParent.get(parentImage) ?? [];
    records.push(record);
    recordsByParent.set(parentImage, records);
  };

  const groups: any[] = Array.isArray(manifest.segmentGroups)
    ? manifest.segmentGroups
    : [];

  const paint = manifest.tools?.paint;
  const activeGroupId = paint?.activeSegmentGroupID;
  const activeValue = paint?.activeSegment;
  if (paint) {
    delete paint.activeSegmentGroupID;
    delete paint.activeSegment;
  }
  // Captured as the type is emitted, because uniqueId may have suffixed the id
  // that the legacy pair would have interpolated to.
  let selectedSegmentId: string | undefined;

  const artifacts = groups.map((group) => {
    const metadata = group.metadata ?? {};
    const descriptors = metadata.segments;
    const parentImage = metadata.parentImage;

    if (!recordsByParent.has(parentImage)) {
      recordsByParent.set(parentImage, []);
    }

    descriptorValues(descriptors).forEach((value) => {
      const mask = descriptors.byValue[String(value)];
      const segmentId = uniqueId(`${group.id}-${value}`);
      addSegment(segments, segmentId, {
        name: mask.name,
        color: mask.color,
        visible: mask.visible ?? true,
        locked: mask.locked ?? false,
      });
      segmentIdByName[mask.name] ??= segmentId;
      if (group.id === activeGroupId && value === activeValue) {
        selectedSegmentId = segmentId;
      }
      addRecord(parentImage, {
        id: uniqueId(`record-${segmentId}`),
        segmentId,
        representations: {
          labelmap: {
            // The group still holds these voxels; restore splits them out.
            artifactId: group.id,
            sourceValue: value,
            extent: emptyExtent(),
          },
        },
      });
    });

    return {
      id: group.id,
      parentImage,
      name: metadata.name,
      ...(group.path === undefined ? {} : { path: group.path }),
      ...(group.dataSourceId === undefined
        ? {}
        : { dataSourceId: group.dataSourceId }),
      ...(metadata.source ? { source: metadata.source } : {}),
      ...(descriptors ? {} : { pendingDecode: true }),
      // Its segments are decoded during restore, after the selection would have
      // been applied, so the value to reselect travels with the artifact.
      ...(!descriptors &&
      group.id === activeGroupId &&
      typeof activeValue === 'number'
        ? { pendingActiveValue: activeValue }
        : {}),
    };
  });

  // Every label becomes a segment, referenced or not: the picker offered it
  // before and goes on offering it.
  const toolSegmentIds = (key: string, into: any[]) => {
    const entry = manifest.tools?.[key];
    if (!entry) return {} as Record<string, string>;

    const labels = entry.labels ?? {};
    const segmentIdByLabel: Record<string, string> = {};
    Object.entries(labels).forEach(([labelId, label]: [string, any]) => {
      const { labelName, color, strokeWidth } = label;
      const name = labelName || labelId;
      segmentIdByLabel[labelId] =
        segmentIdByName[name] ??
        addSegment(into, uniqueId(`${key}-${labelId}`), {
          name,
          color: cssColorToRGBA(color ?? ''),
          ...(strokeWidth === undefined ? {} : { strokeWidth }),
        });
      segmentIdByName[name] = segmentIdByLabel[labelId];
    });

    entry.tools = (Array.isArray(entry.tools) ? entry.tools : []).map(
      (tool: any) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { label, labelName, color, strokeWidth, ...rest } = tool;
        const segmentId = segmentIdByLabel[label];
        return segmentId === undefined ? rest : { ...rest, segmentId };
      }
    );

    delete entry.labels;
    return segmentIdByLabel;
  };

  ['rulers', 'rectangles', 'polygons'].forEach((key) =>
    toolSegmentIds(key, segments)
  );

  const segmentations = [...recordsByParent.entries()].map(
    ([parentImage, records]) => ({
      id: `segmentation-${parentImage}`,
      name: datasetDisplayName(manifest, parentImage),
      parentImage,
      masks: records,
      order: records.map((record) => record.id),
    })
  );

  if (artifacts.length > 0) manifest.segmentationArtifacts = artifacts;
  if (segmentations.length > 0) manifest.segmentations = segmentations;
  if (segments.length > 0) manifest.segments = segments;
  if (selectedSegmentId) manifest.selectedSegment = selectedSegmentId;
  delete manifest.segmentGroups;

  migrateLegacyDisplay(manifest);
  manifest.version = '7.0.0';
  return manifest;
};

export const migrateManifest = (manifestString: string) => {
  const inputManifest = JSON.parse(manifestString);
  return pipe(
    inputManifest,
    migrateOrPass(['5.0.1'], migrate501To600),
    migrateOrPass(['6.0.0'], migrate600To610),
    migrateOrPass(['6.1.0', '6.1.1'], migrate610To620),
    migrateOrPass(['6.3.0'], migrate630To640),
    // No 6.2.0 -> 6.3.0 step exists, so a 6.2 manifest arrives here directly.
    migrateOrPass(['6.2.0', '6.4.0'], migrate640To700)
  );
};
