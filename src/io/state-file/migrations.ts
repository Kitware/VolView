import { pipe } from '@/src/utils/functional';
import { makeDefaultSegmentGroupName } from '@/src/store/segmentGroups';

const LABELMAP_PALETTE_2_1_0 = {
  '1': {
    value: 1,
    name: 'Segment 1',
    color: [153, 153, 0, 255],
  },
  '2': {
    value: 2,
    name: 'Segment 2',
    color: [76, 76, 0, 255],
  },
  '3': {
    value: 3,
    name: 'Segment 3',
    color: [255, 255, 0, 255],
  },
  '4': {
    value: 4,
    name: 'Segment 4',
    color: [0, 76, 0, 255],
  },
  '5': {
    value: 5,
    name: 'Segment 5',
    color: [0, 153, 0, 255],
  },
  '6': {
    value: 6,
    name: 'Segment 6',
    color: [0, 255, 0, 255],
  },
  '7': {
    value: 7,
    name: 'Segment 7',
    color: [76, 0, 0, 255],
  },
  '8': {
    value: 8,
    name: 'Segment 8',
    color: [153, 0, 0, 255],
  },
  '9': {
    value: 9,
    name: 'Segment 9',
    color: [255, 0, 0, 255],
  },
  '10': {
    value: 10,
    name: 'Segment 10',
    color: [0, 76, 76, 255],
  },
  '11': {
    value: 11,
    name: 'Segment 11',
    color: [0, 153, 153, 255],
  },
  '12': {
    value: 12,
    name: 'Segment 12',
    color: [0, 255, 255, 255],
  },
  '13': {
    value: 13,
    name: 'Segment 13',
    color: [0, 0, 76, 255],
  },
  '14': {
    value: 14,
    name: 'Segment 14',
    color: [0, 0, 153, 255],
  },
};

const migrateOrPass =
  (versions: Array<string>, migrationFunc: (manifest: any) => any) =>
  (inputManifest: any) => {
    if (versions.includes(inputManifest.version)) {
      return migrationFunc(inputManifest);
    }
    return inputManifest;
  };

const migrateBefore210 = (inputManifest: any) => {
  const manifest = JSON.parse(JSON.stringify(inputManifest));
  manifest.version = '2.1.0';
  return manifest;
};

const migrate210To300 = (inputManifest: any) => {
  const manifest = JSON.parse(JSON.stringify(inputManifest));
  manifest.tools.paint.activeSegmentGroupID =
    inputManifest.tools.paint.activeLabelmapID;
  delete manifest.tools.paint.activeLabelmapID;

  const order = Object.keys(LABELMAP_PALETTE_2_1_0).map((key) => Number(key));
  manifest.labelMaps = inputManifest.labelMaps.map(
    (labelMap: any, index: number) => ({
      id: labelMap.id,
      path: labelMap.path,
      metadata: {
        parentImage: labelMap.parent,
        name: makeDefaultSegmentGroupName('My Image', index),
        segments: {
          order,
          byValue: LABELMAP_PALETTE_2_1_0,
        },
      },
    })
  );

  manifest.version = '3.0.0';
  return manifest;
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

export const migrateManifest = (manifestString: string) => {
  const inputManifest = JSON.parse(manifestString);
  return pipe(
    inputManifest,
    migrateOrPass(['1.1.0', '1.0.0', '0.5.0'], migrateBefore210),
    migrateOrPass(['2.1.0'], migrate210To300),
    migrateOrPass(['5.0.1'], migrate501To600),
    migrateOrPass(['6.0.0'], migrate600To610)
  );
};
