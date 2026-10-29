import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  maskOn,
  boundMasks,
  seatSpecImage,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';

import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useSegmentStore } from '@/src/segmentation/segments';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';
import { applyPostStateConfig, config } from '@/src/io/import/configJson';
import { cssColorToRGBA } from '@/src/segmentation/color';
import { resolveSegmentAppearance } from '@/src/segmentation/segment';

const segments = () => useSegmentStore().segments;

const viewImage = async (id: string) => {
  useViewStore().setDataForAllViews(id);
  await nextTick();
};

const seatAndView = async (id: string) => {
  await seatSpecImage(id);
  await viewImage(id);
};

const applyConfig = (raw: unknown) => {
  const { currentImageID } = useCurrentImage('global');
  applyPostStateConfig(
    config.parse(raw),
    undefined,
    currentImageID.value ? [currentImageID.value] : []
  );
};

const typeNames = () =>
  segments()
    .segmentList('img-1')
    .map((type) => type.name);

const segmentIdNamed = (name: string) => {
  const type = segments().findSegmentByName('img-1', name);
  if (!type) throw new Error(`No type named "${name}"`);
  return type.id;
};

const recordsOf = (imageId: string) =>
  store().getSegmentationForImage(imageId)?.order ?? [];

const TWO_TYPES = {
  segments: {
    Tumor: { color: '#00ff00' },
    Node: { color: 'red' },
  },
};

describe('a configured segment creates nothing', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatAndView('img-1');
  });

  it('touches no image when the config is applied', async () => {
    await seatAndView('img-1');

    applyConfig(TWO_TYPES);

    expect(typeNames()).toEqual(['Tumor', 'Node']);
    expect(store().getSegmentationForImage('img-1')).toBeFalsy();
    expect(boundMasks()).toEqual([]);
  });

  it('copies configured definitions into independent image sets', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    await seatAndView('img-2');

    expect(typeNames()).toEqual(['Tumor', 'Node']);
    expect(
      segments()
        .segmentList('img-2')
        .map(({ name }) => name)
    ).toEqual(['Tumor', 'Node']);
    expect(recordsOf('img-1')).toEqual([]);
    expect(recordsOf('img-2')).toEqual([]);
    const copied = segments().findSegmentByName('img-2', 'Tumor');
    expect(copied).toBeDefined();
    expect(copied!.id).not.toBe(segmentIdNamed('Tumor'));
  });

  it('takes the configured color and appearance', () => {
    applyConfig({
      segments: {
        Tumor: { color: '#00ff00', fillOpacity: 0.4, strokeWidth: 3 },
      },
    });

    const appearance = segments().appearanceOf(segmentIdNamed('Tumor'));
    expect(appearance.color).toEqual(cssColorToRGBA('#00ff00'));
    expect(appearance.fillOpacity).toBe(0.4);
    expect(appearance.strokeWidth).toBe(3);
    // Unstated fields resolve to the app default rather than being stored.
    expect(
      segments().getSegment(segmentIdNamed('Tumor'))?.outlineOpacity
    ).toBeUndefined();
  });

  it('offers a selection without allocating for it', () => {
    applyConfig(TWO_TYPES);

    expect(segments().selectedSegmentId('img-1')).toBe(segmentIdNamed('Tumor'));
    expect(store().segmentations).toEqual({});
  });

  it('lands the first edit in the selected configured segment', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    segments().selectSegment(segmentIdNamed('Node'));

    const target = store().resolveEditTarget('img-1');

    expect(store().getMask(target).segmentId).toBe(segmentIdNamed('Node'));
    expect(typeNames()).toEqual(['Tumor', 'Node']);
  });

  it('reaches every annotation tool, rulers included', () => {
    applyConfig(TWO_TYPES);

    const rulers = useRulerStore();
    const ruler = rulers.addTool({ imageID: 'img-1' });

    expect(rulers.appearanceOfTool(ruler)).toMatchObject({
      name: 'Tumor',
      cssColor: '#00ff00',
    });
  });
});

describe('a second config replaces the first', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatAndView('img-1');
  });

  it('keeps the id of a key both configs state', () => {
    applyConfig(TWO_TYPES);
    const before = segmentIdNamed('Tumor');

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(segmentIdNamed('Tumor')).toBe(before);
    expect(segments().appearanceOf(before).color).toEqual(
      cssColorToRGBA('blue')
    );
  });

  it('removes omitted appearance overrides without changing mask or shape references', async () => {
    applyConfig({
      segments: {
        Tumor: {
          color: 'red',
          fillOpacity: 0,
          outlineOpacity: 0,
          strokeWidth: 9,
        },
      },
    });
    await seatAndView('img-1');
    const id = segmentIdNamed('Tumor');
    const mask = maskOn('img-1', id);
    const toolId = usePolygonStore().addTool({
      imageID: 'img-1',
      segmentId: id,
    });
    segments().updateSegment(id, { visible: false, locked: true });

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(segments().appearanceOf(id)).toMatchObject({
      color: cssColorToRGBA('blue'),
      fillOpacity: 1,
      outlineOpacity: 1,
      strokeWidth: resolveSegmentAppearance(undefined).strokeWidth,
      visible: false,
      locked: true,
    });
    expect(store().getMask(mask.id).segmentId).toBe(id);
    expect(usePolygonStore().toolByID[toolId].segmentId).toBe(id);
    expect(segmentIdNamed('Tumor')).toBe(id);
  });

  it('returns to its automatic color when a retained config omits color', () => {
    applyConfig({ segments: { First: {}, Second: {} } });
    const id = segmentIdNamed('Second');
    const automaticColor = segments().appearanceOf(id).color;
    applyConfig({ segments: { First: {}, Second: { color: 'blue' } } });

    applyConfig({ segments: { First: {}, Second: {} } });

    expect(segments().appearanceOf(id).color).toEqual(automaticColor);
    expect(segmentIdNamed('Second')).toBe(id);
  });

  it('keeps the last configured appearance when a referenced key is dropped', async () => {
    applyConfig({
      segments: {
        Tumor: {
          color: 'red',
          fillOpacity: 0.3,
          outlineOpacity: 0.4,
          strokeWidth: 9,
        },
      },
    });
    await seatAndView('img-1');
    const id = segmentIdNamed('Tumor');
    const mask = maskOn('img-1', id);
    const before = segments().appearanceOf(id);

    applyConfig({ segments: {} });

    expect(segments().appearanceOf(id)).toEqual(before);
    expect(store().getMask(mask.id).segmentId).toBe(id);
  });

  it('drops an unreferenced segment the second config leaves out', () => {
    applyConfig(TWO_TYPES);

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(typeNames()).toEqual(['Tumor']);
  });

  it.each([
    { replacement: {}, expected: [] },
    { replacement: null, expected: [] },
    {
      replacement: { replacement: { color: 'white' } },
      expected: ['replacement'],
    },
  ])(
    'drops inherited-property names omitted by $replacement',
    ({ replacement, expected }) => {
      applyConfig({
        segments: {
          constructor: { color: 'red' },
          toString: { color: 'blue' },
          ordinary: { color: 'green' },
        },
      });
      expect(typeNames()).toEqual(['constructor', 'toString', 'ordinary']);

      applyConfig({ segments: replacement });

      expect(typeNames()).toEqual(expected);
    }
  );

  it('keeps a dropped segment that a mask still references', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    const node = segmentIdNamed('Node');
    const record = maskOn('img-1', node);

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(segments().getSegment(node)?.name).toBe('Node');
    expect(recordsOf('img-1')).toEqual([record.id]);
  });

  it('keeps a dropped segment that a shape still references', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    const node = segmentIdNamed('Node');
    const toolId = usePolygonStore().addTool({
      imageID: 'img-1',
      segmentId: node,
    });

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(segments().getSegment(node)?.name).toBe('Node');
    expect(usePolygonStore().toolByID[toolId].segmentId).toBe(node);
  });

  it('leaves the registry alone when the section is omitted', () => {
    applyConfig(TWO_TYPES);

    applyConfig({ layouts: {} });

    expect(typeNames()).toEqual(['Tumor', 'Node']);
  });

  it('leaves a segment the user made alone', () => {
    applyConfig(TWO_TYPES);
    const own = segments().addSegment('img-1', { name: 'Mine' });

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(segments().getSegment(own)?.name).toBe('Mine');
    expect(typeNames()).toEqual(['Tumor', 'Mine']);
  });
});

describe('config applies after a restore', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatAndView('img-1');
  });

  it('overlays a restored segment of the same name rather than adding one', () => {
    // Restore seats the segment first; the config then states its appearance.
    const restored = segments().mintSegment('img-1', {
      name: 'Tumor',
      color: [1, 2, 3, 255],
    });

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(typeNames()).toEqual(['Tumor']);
    expect(segments().appearanceOf(restored).color).toEqual(
      cssColorToRGBA('blue')
    );
  });

  it('restores session appearance when replacement removes a config override', () => {
    const id = segments().mintSegment('img-1', {
      name: 'Tumor',
      color: [1, 2, 3, 255],
      fillOpacity: 0.6,
      outlineOpacity: 0.7,
      strokeWidth: 4,
      visible: false,
      locked: true,
    });
    const original = segments().appearanceOf(id);
    applyConfig({
      segments: { Tumor: { color: 'blue', fillOpacity: 0, strokeWidth: 9 } },
    });
    expect(segments().appearanceOf(id).outlineOpacity).toBe(0.7);

    applyConfig({ segments: { Tumor: {} } });

    expect(segments().appearanceOf(id)).toEqual(original);
  });

  it('keeps a restored segment the config does not name', () => {
    const restored = segments().mintSegment('img-1', { name: 'Restored' });

    applyConfig(TWO_TYPES);

    expect(segments().getSegment(restored)?.name).toBe('Restored');
    expect(typeNames()).toEqual(['Restored', 'Tumor', 'Node']);
  });

  it('keeps a restored segment it overlaid once a later config drops the key', () => {
    const restored = segments().mintSegment('img-1', { name: 'Tumor' });
    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    applyConfig({ segments: {} });

    expect(segments().getSegment(restored)?.name).toBe('Tumor');
    expect(typeNames()).toEqual(['Tumor']);
  });

  it('keeps a shape pointing at the segment the config took over', () => {
    const restored = segments().mintSegment('img-1', { name: 'Tumor' });
    const toolId = useRectangleStore().addTool({
      imageID: 'img-1',
      segmentId: restored,
    });

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(useRectangleStore().toolByID[toolId].segmentId).toBe(restored);
    expect(useRectangleStore().appearanceOfTool(toolId).cssColor).toBe(
      '#0000ff'
    );
  });
});

describe('configured defaults without an active image', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('waits for an image before creating configured segment identities', async () => {
    applyConfig(TWO_TYPES);

    expect(segments().imageSets.value).toEqual({});
    expect(store().segmentations).toEqual({});

    await seatAndView('img-1');

    expect(typeNames()).toEqual(['Tumor', 'Node']);
    expect(segments().appearanceOf(segmentIdNamed('Tumor')).cssColor).toBe(
      '#00ff00'
    );
    expect(boundMasks()).toEqual([]);
  });

  it('does not apply an active image config to other initialized images', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    const first = segmentIdNamed('Tumor');
    await seatAndView('img-2');
    const second = segments().findSegmentByName('img-2', 'Tumor')!.id;

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(segments().appearanceOf(first).cssColor).toBe('#00ff00');
    expect(segments().appearanceOf(second).cssColor).toBe('#0000ff');
    expect(typeNames()).toEqual(['Tumor', 'Node']);
  });

  it('keeps configured identities when a copied image is renamed and reconfigured', async () => {
    await seatAndView('img-1');
    applyConfig(TWO_TYPES);
    const user = segments().mintSegment('img-1', { name: 'User' });
    await seatAndView('img-2');
    const copied = segments().findSegmentByName('img-2', 'Tumor')!.id;
    segments().updateSegment(copied, { name: 'Lesion' });

    applyConfig(TWO_TYPES);

    expect(segments().findSegmentByName('img-2', 'Tumor')!.id).toBe(copied);
    expect(
      segments()
        .segmentList('img-2')
        .map(({ name }) => name)
    ).toEqual(['Tumor', 'Node', 'User']);
    applyConfig({ segments: {} });
    expect(
      segments()
        .segmentList('img-2')
        .map(({ name }) => name)
    ).toEqual(['User']);
    expect(segments().getSegment(user)?.name).toBe('User');
    expect(typeNames()).toEqual(['Tumor', 'Node', 'User']);
  });

  it('can clear defaults that initialized an image before any source image existed', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');

    applyConfig({ segments: {} });

    expect(typeNames()).toEqual([]);
  });

  it('resets omitted appearance when configuration initialized an image from defaults', async () => {
    applyConfig({ segments: { Tumor: { color: 'red', fillOpacity: 0.3 } } });
    await seatAndView('img-1');
    const id = segmentIdNamed('Tumor');

    applyConfig({ segments: { Tumor: {} } });

    expect(segments().getSegment(id)?.fillOpacity).toBeUndefined();
    expect(segments().appearanceOf(id).fillOpacity).toBe(1);
    expect(segmentIdNamed('Tumor')).toBe(id);
  });

  it('uses the same automatic configured colors for fresh rows and future defaults', async () => {
    await seatAndView('img-1');
    segments().mintSegment('img-1', { name: 'User' });
    applyConfig({ segments: { First: {}, Second: {} } });
    const configuredColors = ['First', 'Second'].map(
      (name) => segments().findSegmentByName('img-1', name)!.color
    );

    setActivePinia(createPinia());
    applyConfig({ segments: { First: {}, Second: {} } });
    await seatAndView('img-2');
    expect(
      segments()
        .segmentList('img-2')
        .map(({ color }) => color)
    ).toEqual(configuredColors);
  });
});
