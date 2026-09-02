import { pipe } from '@/src/utils/functional';
import { cssColorToRGBA, emptyExtent } from '@/src/types/segmentation';

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

// Vector-tool label records become segments; rulers keep owning their labels.
const SEGMENT_TOOL_KEYS = ['rectangles', 'polygons'] as const;

// A manifest saved before `datasets` existed lets every uri source stand in for
// one, keyed by its stringified source id — mirrors `manifestDatasets`.
const datasetDisplayName = (manifest: any, datasetId: string) => {
  const sources: any[] = Array.isArray(manifest.dataSources)
    ? manifest.dataSources
    : [];
  const datasets: any[] = Array.isArray(manifest.datasets)
    ? manifest.datasets
    : sources
        .filter((source) => source.type === 'uri')
        .map((source) => ({ id: String(source.id), dataSourceId: source.id }));
  const dataset = datasets.find((entry) => entry.id === datasetId);
  const source = sources.find((entry) => entry.id === dataset?.dataSourceId);
  return typeof source?.name === 'string' ? source.name : datasetId;
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

// 6.4.0 -> 7.0.0 moves identity off segment groups and off the vector tools'
// label records and onto segments owned by one segmentation per parent image.
// JSON only: no voxels are read here, so a group is marked for the loaded
// restore stage to divide into one bounded mask per segment, enumerating its
// voxel values first when it carried no descriptors. Every binding's extent is
// a placeholder that stage replaces.
const migrate640To700 = (inputManifest: any) => {
  const manifest = JSON.parse(JSON.stringify(inputManifest));

  // Insertion order is the migrated order: groups in manifest order, then the
  // vector-tool labels in the order their tools reference them.
  const segmentsByParent = new Map<string, any[]>();

  // Segment ids are built by joining legacy identifiers with '-', which those
  // identifiers may themselves contain, so distinct sources can produce the
  // same string. Restore keys a global map on this id, so a collision silently
  // misroutes one segment onto another. Disambiguate deterministically.
  const usedSegmentIds = new Set<string>();
  const uniqueSegmentId = (candidate: string) => {
    let id = candidate;
    for (let n = 2; usedSegmentIds.has(id); n += 1) id = `${candidate}-${n}`;
    usedSegmentIds.add(id);
    return id;
  };

  const addSegment = (parentImage: string, segment: any) => {
    const segments = segmentsByParent.get(parentImage) ?? [];
    segments.push(segment);
    segmentsByParent.set(parentImage, segments);
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
  // Captured as the segment is emitted, because uniqueSegmentId may have
  // suffixed the id that the legacy pair would have interpolated to.
  let activeSegmentId: string | undefined;

  const artifacts = groups.map((group) => {
    const metadata = group.metadata ?? {};
    const descriptors = metadata.segments;

    descriptorValues(descriptors).forEach((value) => {
      const mask = descriptors.byValue[String(value)];
      const segmentId = uniqueSegmentId(`${group.id}-${value}`);
      if (group.id === activeGroupId && value === activeValue) {
        activeSegmentId = segmentId;
      }
      addSegment(metadata.parentImage, {
        // Every {group, value} is its own segment, equal names included.
        id: segmentId,
        name: mask.name,
        color: mask.color,
        visible: mask.visible ?? true,
        locked: mask.locked ?? false,
        representations: {
          labelmap: {
            artifactId: group.id,
            labelValue: value,
            extent: emptyExtent(),
          },
        },
      });
    });

    return {
      id: group.id,
      parentImage: metadata.parentImage,
      name: metadata.name,
      ...(group.path === undefined ? {} : { path: group.path }),
      ...(group.dataSourceId === undefined
        ? {}
        : { dataSourceId: group.dataSourceId }),
      ...(metadata.source ? { source: metadata.source } : {}),
      ...(descriptors ? { pendingSplit: true } : { pendingDecode: true }),
      // Its segments are decoded during restore, after activeSegment would have
      // been applied, so the value to reactivate travels with the artifact.
      ...(!descriptors &&
      group.id === activeGroupId &&
      activeValue !== undefined
        ? { pendingActiveValue: activeValue }
        : {}),
    };
  });

  SEGMENT_TOOL_KEYS.forEach((key) => {
    const entry = manifest.tools?.[key];
    if (!entry) return;

    const labels = entry.labels ?? {};
    const segmentProps: Record<string, any> = {};
    // One segment per {label, image} pair: a label used on two images is two
    // segments, and identity is never bridged across them.
    const segmentIdByPair = new Map<string, string>();

    entry.tools = (Array.isArray(entry.tools) ? entry.tools : []).map(
      (tool: any) => {
        const label = labels[tool.label];
        if (!label) return tool;

        const pair = `${tool.imageID}\u0000${tool.label}`;
        let segmentId = segmentIdByPair.get(pair);
        if (segmentId === undefined) {
          segmentId = uniqueSegmentId(`${key}-${tool.label}-${tool.imageID}`);
          segmentIdByPair.set(pair, segmentId);
          const { labelName, color, ...props } = label;
          addSegment(tool.imageID, {
            id: segmentId,
            name: labelName ?? '',
            color: cssColorToRGBA(color ?? tool.color ?? ''),
            visible: true,
            locked: false,
            // A vector-tool label has no voxels.
            representations: {},
          });
          segmentProps[segmentId] = props;
        }
        return { ...tool, label: segmentId };
      }
    );

    delete entry.labels;
    entry.segmentProps = segmentProps;
  });

  const segmentations = [...segmentsByParent.entries()].map(
    ([parentImage, segments]) => ({
      id: `segmentation-${parentImage}`,
      name: datasetDisplayName(manifest, parentImage),
      parentImage,
      segments,
      order: segments.map((segment) => segment.id),
      ...(segments.some((segment) => segment.id === activeSegmentId)
        ? { activeSegment: activeSegmentId }
        : {}),
    })
  );

  if (artifacts.length > 0) manifest.segmentationArtifacts = artifacts;
  if (segmentations.length > 0) manifest.segmentations = segmentations;
  delete manifest.segmentGroups;

  manifest.version = '7.0.0';
  return manifest;
};

// 7.0.0 -> 7.1.0 adds display state (fill/outline opacity, outline thickness)
// to segments and segmentations. Fields are optional with zod defaults, so
// this step only stamps the version.
const migrate700To710 = (inputManifest: any) => {
  const manifest = JSON.parse(JSON.stringify(inputManifest));
  manifest.version = '7.1.0';
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
    migrateOrPass(['6.2.0', '6.4.0'], migrate640To700),
    migrateOrPass(['7.0.0'], migrate700To710)
  );
};
