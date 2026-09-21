import { cycle, omit } from '@/src/utils';
import { pipe } from '@/src/utils/functional';
import { emptyExtent } from '@/src/segmentation/geometry';
import { cssColorToRGBA, tryCssColorToRGBA } from '@/src/segmentation/color';
import { makeDefaultSegmentName } from '@/src/segmentation/model';
import { TOOL_COLORS } from '@/src/config';

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

// Descriptor values in `order`, then any byValue entry `order` forgot.
const descriptorValues = (descriptors: any) => {
  const byValue = descriptors?.byValue ?? {};
  const ordered: number[] = (
    Array.isArray(descriptors?.order) ? descriptors.order : []
  ).filter((value: number) => String(value) in byValue);
  const listed = new Set(ordered);
  const rest = Object.keys(byValue)
    .map(Number)
    .filter((value) => !listed.has(value))
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

type LegacyDisplay = ReturnType<typeof legacyViewGroupDisplay>;

// A 6.4.0 group rendered at the layer opacity default unless a view saved one.
const LEGACY_GROUP_FILL_OPACITY_DEFAULT = 0.3;

const legacyFillOpacity = (display: LegacyDisplay) =>
  display.fillOpacity ?? LEGACY_GROUP_FILL_OPACITY_DEFAULT;

// A zero on the segmentation leaves nothing for a segment to be a share of, and
// every group under it was hidden anyway.
const fillShareOf = (display: LegacyDisplay, parentFill: number) =>
  parentFill === 0 ? 1 : legacyFillOpacity(display) / parentFill;

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
      {} as LegacyDisplay
    );
};

const legacyDisplays = (manifest: any, groups: any[]) => {
  const byGroup = new Map<string, LegacyDisplay>(
    groups.map((group) => [group.id, legacyGroupDisplay(manifest, group.id)])
  );
  const outlineThicknessByParent = new Map<string, number>();
  const fillByParent = new Map<string, number>();
  groups.forEach((group) => {
    const parentImage = group.metadata?.parentImage;
    const display = byGroup.get(group.id)!;
    if (
      !outlineThicknessByParent.has(parentImage) &&
      display.outlineThickness !== undefined
    ) {
      // Groups sharing a segmentation share its thickness; the first to set one wins.
      outlineThicknessByParent.set(parentImage, display.outlineThickness);
    }
    // Fill is segmentation times segment opacity; the largest group's goes on
    // the segmentation so every group's share fits the per-segment slider.
    fillByParent.set(
      parentImage,
      Math.max(fillByParent.get(parentImage) ?? 0, legacyFillOpacity(display))
    );
  });
  return { byGroup, outlineThicknessByParent, fillByParent };
};

// A legacy group described what it showed, so its opacity and its visibility
// both land on the segment the group became.
const segmentDisplay = (
  display: LegacyDisplay,
  fillShare: number,
  maskVisible: boolean | undefined
) => ({
  visible: (maskVisible ?? true) && (display.visible ?? true),
  fillOpacity: fillShare,
  ...(display.outlineOpacity === undefined
    ? {}
    : { outlineOpacity: display.outlineOpacity }),
});

// Segments restore decodes from a group do not exist yet to put its display
// on: all of a group that named none, or the values its descriptors missed.
const pendingDisplay = (display: LegacyDisplay, fillShare: number) => ({
  pendingFillOpacity: fillShare,
  ...(display.outlineOpacity === undefined
    ? {}
    : { pendingOutlineOpacity: display.outlineOpacity }),
  ...(display.visible === undefined
    ? {}
    : { pendingVisibility: display.visible }),
});

// These consumed view configs would otherwise restore under an unmapped data
// id after the group is split.
const dropLegacyViewDisplay = (manifest: any, groupIds: string[]) => {
  Object.values(manifest.viewByID ?? {}).forEach((view: any) => {
    if (!view?.config) return;
    groupIds.forEach((groupId) => {
      const config = view.config[groupId];
      if (!config) return;
      delete config.layers;
      delete config.segmentGroup;
      if (Object.keys(config).length === 0) delete view.config[groupId];
    });
  });
};

// 6.4.0 -> 7.0.0 moves identity off segment groups and tool labels onto
// segments. JSON only: no voxels are read here, so each group becomes an
// artifact the loaded restore stage splits into bounded masks, and every
// binding's extent is a placeholder that stage replaces.
const migrate640To700 = (inputManifest: any) => {
  const manifest = JSON.parse(JSON.stringify(inputManifest));

  // Insertion order is the migrated order: groups in manifest order, then per
  // tool kind its labels in record order and one segment per bare appearance.
  const recordsByParent = new Map<string, any[]>();
  const segments: any[] = [];

  // Joined legacy ids can collide, and restore keys a map on them.
  const usedIds = new Set<string>();
  const uniqueId = (candidate: string) => {
    let id = candidate;
    for (let n = 2; usedIds.has(id); n += 1) id = `${candidate}-${n}`;
    usedIds.add(id);
    return id;
  };

  const addSegment = (id: string, segment: any) => {
    segments.push({ id, ...segment });
    return id;
  };

  // A tool label repeating a group's name is that segment; groups never merge,
  // since an image keeps one mask per segment.
  const segmentIdByName = new Map<string, string>();

  const groups: any[] = Array.isArray(manifest.segmentGroups)
    ? manifest.segmentGroups
    : [];
  const displays = legacyDisplays(manifest, groups);

  const paint = manifest.tools?.paint;
  const activeGroupId = paint?.activeSegmentGroupID;
  const activeValue = paint?.activeSegment;
  if (paint) {
    delete paint.activeSegmentGroupID;
    delete paint.activeSegment;
  }
  // Captured as the segment is emitted, because uniqueId may have suffixed the
  // id that the legacy pair would have interpolated to.
  let selectedSegmentId: string | undefined;

  const artifacts = groups.map((group) => {
    const metadata = group.metadata ?? {};
    const descriptors = metadata.segments;
    const parentImage = metadata.parentImage;
    const display = displays.byGroup.get(group.id)!;
    const fillShare = fillShareOf(
      display,
      displays.fillByParent.get(parentImage)!
    );

    const records = recordsByParent.get(parentImage) ?? [];
    recordsByParent.set(parentImage, records);

    descriptorValues(descriptors).forEach((value) => {
      const mask = descriptors.byValue[String(value)];
      const segmentId = uniqueId(`${group.id}-${value}`);
      addSegment(segmentId, {
        name: mask.name,
        color: mask.color,
        locked: mask.locked ?? false,
        ...segmentDisplay(display, fillShare, mask.visible),
      });
      if (!segmentIdByName.has(mask.name)) {
        segmentIdByName.set(mask.name, segmentId);
      }
      if (group.id === activeGroupId && value === activeValue) {
        selectedSegmentId = segmentId;
      }
      records.push({
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
      // Its segments are decoded during restore, after the selection would have
      // been applied, so the value to reselect travels with the artifact.
      ...(!descriptors &&
      group.id === activeGroupId &&
      typeof activeValue === 'number'
        ? { pendingActiveValue: activeValue }
        : {}),
      ...pendingDisplay(display, fillShare),
    };
  });

  const toolKeys = ['rulers', 'rectangles', 'polygons'];

  const nextToolColor = cycle(TOOL_COLORS);
  const nextPaletteColor = () => cssColorToRGBA(nextToolColor());

  // Legacy colors were any CSS string, and one this parser does not know would
  // resolve to opaque black, which reads as a deliberate choice. Take the
  // palette color a freshly minted segment would have instead.
  const segmentColor = (css: string | undefined) =>
    tryCssColorToRGBA(css ?? '') ?? nextPaletteColor();

  const labelNames = new Set(
    toolKeys.flatMap((key) =>
      Object.entries(manifest.tools?.[key]?.labels ?? {}).map(
        ([labelId, label]: [string, any]) => label.labelName || labelId
      )
    )
  );

  // Mirrors the name a shape placed against an empty registry mints.
  let segmentNumber = 0;
  const defaultSegmentName = () => {
    let name: string;
    do {
      segmentNumber += 1;
      name = makeDefaultSegmentName(segmentNumber);
    } while (labelNames.has(name) || segmentIdByName.has(name));
    return name;
  };

  // A tool whose label the session no longer holds kept drawing in its inline
  // appearance, so one segment per distinct appearance carries it onward.
  const segmentIdByAppearance = new Map<string, string>();
  const appearanceSegmentId = (
    color: string | undefined,
    strokeWidth: number | undefined
  ) => {
    const key = `${color ?? ''}|${strokeWidth ?? ''}`;
    const existing = segmentIdByAppearance.get(key);
    if (existing !== undefined) return existing;
    const name = defaultSegmentName();
    const segmentId = addSegment(
      uniqueId(`tool-${segmentIdByAppearance.size + 1}`),
      {
        name,
        color: segmentColor(color),
        ...(strokeWidth === undefined ? {} : { strokeWidth }),
      }
    );
    segmentIdByAppearance.set(key, segmentId);
    segmentIdByName.set(name, segmentId);
    return segmentId;
  };

  // Every label becomes a segment, referenced or not: the picker offered it
  // before and goes on offering it.
  const migrateToolLabels = (key: string) => {
    const entry = manifest.tools?.[key];
    if (!entry) return;

    const labels = entry.labels ?? {};
    const segmentIdByLabel = new Map<string, string>();
    Object.entries(labels).forEach(([labelId, label]: [string, any]) => {
      const { labelName, color, strokeWidth } = label;
      const name = labelName || labelId;
      const segmentId =
        segmentIdByName.get(name) ??
        addSegment(uniqueId(`${key}-${labelId}`), {
          name,
          color: segmentColor(color),
          ...(strokeWidth === undefined ? {} : { strokeWidth }),
        });
      segmentIdByLabel.set(labelId, segmentId);
      segmentIdByName.set(name, segmentId);
    });

    entry.tools = (Array.isArray(entry.tools) ? entry.tools : []).map(
      (tool: any) => ({
        ...omit(tool, ['label', 'labelName', 'color', 'strokeWidth']),
        segmentId:
          segmentIdByLabel.get(tool.label) ??
          appearanceSegmentId(tool.color, tool.strokeWidth),
      })
    );

    delete entry.labels;
  };

  toolKeys.forEach(migrateToolLabels);

  const segmentations = [...recordsByParent.entries()].map(
    ([parentImage, records]) => {
      const outlineThickness =
        displays.outlineThicknessByParent.get(parentImage);
      return {
        id: `segmentation-${parentImage}`,
        // Unnamed: restore names it after the loaded image, as a live one is.
        name: '',
        parentImage,
        masks: records,
        order: records.map((record) => record.id),
        fillOpacity: displays.fillByParent.get(parentImage),
        ...(outlineThickness === undefined ? {} : { outlineThickness }),
      };
    }
  );

  if (artifacts.length > 0) manifest.segmentationArtifacts = artifacts;
  if (segmentations.length > 0) manifest.segmentations = segmentations;
  if (segments.length > 0) manifest.segments = segments;
  if (selectedSegmentId) manifest.selectedSegment = selectedSegmentId;
  delete manifest.segmentGroups;

  dropLegacyViewDisplay(
    manifest,
    groups.map((group) => group.id)
  );
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
