import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import JSZip from 'jszip';
import {
  defaultEnFaceViewConfig,
  useEnFaceViewStore,
} from '@/src/enface/store';
import { ManifestSchema, type StateFile } from '@/src/io/state-file/schema';
import { parseNamedLayouts } from '@/src/utils/layoutParsing';
import { layoutLeaves } from '@/src/utils/layoutEditing';
import { computeEffectiveView } from '@/src/core/views/effectiveView';
import { useViewConfigStore } from '@/src/store/view-configs';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { useSegmentStore } from '@/src/segmentation/segments';
import { manifestForImages } from '@/src/segmentation/__tests__/segmentMaskFixtures';

beforeEach(() => setActivePinia(createPinia()));

describe('En face view settings', () => {
  it('isolates settings by view and dataset and removes them on deletion', () => {
    const store = useEnFaceViewStore();
    store.configFor('a', 'oct1').method = 'max';
    store.configFor('a', 'oct2').axis = 2;
    expect(store.configFor('b', 'oct1').method).toBe('mean');
    expect(store.configFor('a', 'oct2').method).toBe('mean');
    store.removeData('oct1');
    expect(store.configFor('a', 'oct1').method).toBe('mean');
    expect(store.configFor('a', 'oct2').axis).toBe(2);
    store.removeView('a');
    expect(store.configFor('a', 'oct2').axis).toBe(1);
  });

  it('drops the settings of a deleted segment', () => {
    const store = useEnFaceViewStore();
    const { segments } = useSegmentStore();
    const kept = segments.mintSegment('oct');
    const deleted = segments.mintSegment('oct');
    const shown = { visible: true, thresholdMicrons: null };
    Object.assign(store.configFor('view', 'oct').segmentProjections, {
      [kept]: shown,
      [deleted]: shown,
    });
    segments.deleteSegment(deleted);
    expect(
      Object.keys(store.configFor('view', 'oct').segmentProjections)
    ).toEqual([kept]);
  });

  it('saves supported settings in an EnFace view and restores with remapped dataset IDs', () => {
    const store = useEnFaceViewStore();
    Object.assign(store.configFor('view', 'oct'), {
      method: 'sum',
      axis: 1,
      depthStart: 20,
      depthEnd: 40,
      segmentProjections: {
        layer: { visible: true, thresholdMicrons: null },
      },
    });
    const state: StateFile = {
      zip: new JSZip(),
      manifest: {
        version: '7.0.0',
        datasets: [{ id: 'oct', dataSourceId: 0 }],
        dataSources: [{ id: 0, type: 'uri', uri: 'oct.dcm' }],
        viewByID: {
          view: {
            id: 'view',
            type: 'EnFace',
            name: 'En face',
            dataID: 'oct',
            options: {},
          },
        },
      },
    };
    useWindowingStore().updateConfig(
      'view',
      'oct',
      { width: 120, level: 60 },
      true
    );
    useViewConfigStore().serialize(state);
    const parsed = ManifestSchema.parse(state.manifest);
    expect(parsed.viewByID?.view.type).toBe('EnFace');
    const settings = parsed.viewByID!.view.config!;
    expect(settings.oct.enFace?.method).toBe('sum');
    expect(settings.oct.enFace).not.toHaveProperty('windowWidth');
    expect(settings.oct.window).toMatchObject({
      width: 120,
      level: 60,
      userTriggered: true,
    });
    store.removeView('view');
    useViewConfigStore().deserialize(
      'restored',
      settings,
      { oct: 'new-oct' },
      () => undefined
    );
    expect(store.configFor('restored', 'new-oct')).toMatchObject({
      method: 'sum',
      depthStart: 20,
      depthEnd: 40,
      segmentProjections: {},
    });
    expect(useWindowingStore().getConfig('restored', 'new-oct')).toMatchObject({
      width: 120,
      level: 60,
      userTriggered: true,
    });
  });

  it('restores a slab scene saved before per-segment settings with every segment hidden', () => {
    const parsed = ManifestSchema.parse({
      version: '7.0.0',
      datasets: [],
      dataSources: [],
      viewByID: {
        saved: {
          id: 'saved',
          type: 'EnFace',
          name: 'En face',
          config: {
            source: {
              enFace: {
                axis: 2,
                method: 'max',
                depthStart: 1,
                depthEnd: 4,
                highlightThin: true,
                thresholdMicrons: 30,
                segmentId: 'layer',
              },
            },
          },
        },
      },
    });
    useViewConfigStore().deserialize(
      'restored',
      parsed.viewByID!.saved.config!,
      { source: 'loaded' },
      () => undefined
    );
    expect(useEnFaceViewStore().configFor('restored', 'loaded')).toMatchObject({
      axis: 2,
      method: 'max',
      depthStart: 1,
      depthEnd: 4,
      segmentProjections: {},
    });
  });

  it('remaps saved segment ids and drops unknown ones on restore', () => {
    const store = useEnFaceViewStore();
    const chosen = useSegmentStore().segments.addSegment('kept', {
      name: 'Layer',
    });
    const projection = { visible: true, thresholdMicrons: 35 };
    const saved = {
      enFace: {
        ...defaultEnFaceViewConfig(),
        segmentProjections: {
          'saved-layer': projection,
          'missing-layer': projection,
        },
      },
    };
    store.deserialize(
      'view',
      { kept: saved, dropped: saved },
      (imageId, savedId) =>
        imageId === 'kept' && savedId === 'saved-layer' ? chosen : undefined
    );
    const state: StateFile = {
      zip: new JSZip(),
      manifest: manifestForImages(['kept', 'dropped'], {
        viewByID: { view: { id: 'view', type: 'EnFace', name: 'En face' } },
      }),
    };
    store.serialize(state);
    const config = state.manifest.viewByID!.view.config!;
    expect(config.kept.enFace?.segmentProjections).toEqual({
      [chosen]: projection,
    });
    expect(config.dropped.enFace?.segmentProjections).toEqual({});
  });

  it('resolves custom enface layouts without treating the projection as a slice', () => {
    const parsed = parseNamedLayouts({ OCT: [['enface', 'coronal']] });
    const [enface] = layoutLeaves(parsed.OCT).map((leaf) => leaf.view);
    expect(enface).toMatchObject({
      type: 'EnFace',
      name: 'En face',
    });
    const view = { ...enface, id: 'enface' };
    expect(computeEffectiveView(view, 'oct').kind).toBe('enface');
    expect(computeEffectiveView(view, null).kind).toBe('empty');
  });
});
