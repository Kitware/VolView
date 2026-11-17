import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  boundMasks,
  seatSpecImage,
  store,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';
import { nextTick } from 'vue';

import { TOOL_COLORS } from '@/src/config';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';
import { applyPostStateConfig, config } from '@/src/io/import/configJson';
import { cssColorToRGBA } from '@/src/segmentation/color';

const segments = () => useSegmentStore().segments;

const viewImage = async (id: string) => {
  useViewStore().setDataForAllViews(id);
  await nextTick();
};

const seatAndView = async (id: string) => {
  await seatSpecImage(id);
  await viewImage(id);
};

const applyConfig = (raw: unknown) => applyPostStateConfig(config.parse(raw));

const typeNames = () =>
  segments()
    .segmentList('img-1')
    .map((type) => type.name);

const segmentIdNamed = (name: string) => {
  const type = segments().findSegmentByName('img-1', name);
  if (!type) throw new Error(`No type named "${name}"`);
  return type.id;
};

const maskedSegmentsOf = (imageId: string) =>
  store()
    .imageMasks(imageId)
    .map(({ segmentId }) => segmentId);

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
    expect(segments().imageSets.value['img-1']?.display).toBeUndefined();
    expect(boundMasks()).toEqual([]);
  });

  it('gives each image its own configured definitions', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    await seatAndView('img-2');

    expect(typeNames()).toEqual(['Tumor', 'Node']);
    expect(
      segments()
        .segmentList('img-2')
        .map(({ name }) => name)
    ).toEqual(['Tumor', 'Node']);
    expect(maskedSegmentsOf('img-1')).toEqual([]);
    expect(maskedSegmentsOf('img-2')).toEqual([]);
    const second = segments().findSegmentByName('img-2', 'Tumor');
    expect(second).toBeDefined();
    expect(second!.id).not.toBe(segmentIdNamed('Tumor'));
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
    expect(boundMasks()).toEqual([]);
  });

  it('lands the first edit in the selected configured segment', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-1');
    segments().selectSegment(segmentIdNamed('Node'));

    const target = store().resolveEditTarget('img-1');

    expect(target).toBe(segmentIdNamed('Node'));
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

describe('a config is a template', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatAndView('img-1');
  });

  it('writes stated fields onto the same-named segment and leaves the rest', async () => {
    applyConfig({
      segments: { Tumor: { color: 'red', fillOpacity: 0.3, strokeWidth: 9 } },
    });
    const id = segmentIdNamed('Tumor');
    store().materializeMask(id);
    segments().updateSegment(id, { visible: false, locked: true });

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(segmentIdNamed('Tumor')).toBe(id);
    expect(segments().appearanceOf(id)).toMatchObject({
      color: cssColorToRGBA('blue'),
      fillOpacity: 0.3,
      strokeWidth: 9,
      visible: false,
      locked: true,
    });
    expect(store().maskOf(id)).toBeDefined();
  });

  it.each([
    { replacement: { Tumor: { color: 'blue' } }, expected: ['Tumor', 'Node'] },
    { replacement: {}, expected: ['Tumor', 'Node'] },
    { replacement: null, expected: ['Tumor', 'Node'] },
    { replacement: { Other: {} }, expected: ['Tumor', 'Node', 'Other'] },
  ])(
    'removes nothing when $replacement follows',
    ({ replacement, expected }) => {
      applyConfig(TWO_TYPES);

      applyConfig({ segments: replacement });

      expect(typeNames()).toEqual(expected);
    }
  );

  it('starts an unviewed image empty after an empty config', async () => {
    applyConfig(TWO_TYPES);
    await seatSpecImage('img-2');

    applyConfig({ segments: {} });
    await viewImage('img-2');

    expect(
      segments()
        .segmentList('img-2')
        .map(({ name }) => name)
    ).toEqual([]);
  });

  it('leaves the registry alone when the section is omitted', () => {
    applyConfig(TWO_TYPES);

    applyConfig({ layouts: {} });

    expect(typeNames()).toEqual(['Tumor', 'Node']);
  });

  it('adds the configured name again beside a renamed segment', () => {
    applyConfig(TWO_TYPES);
    const tumor = segmentIdNamed('Tumor');
    segments().updateSegment(tumor, { name: 'Lesion' });

    applyConfig(TWO_TYPES);

    expect(segments().getSegment(tumor)?.name).toBe('Lesion');
    expect(typeNames()).toEqual(['Lesion', 'Node', 'Tumor']);
  });

  it('applies to every image that has segments', async () => {
    applyConfig(TWO_TYPES);
    await seatAndView('img-2');
    const first = segmentIdNamed('Tumor');
    const second = segments().findSegmentByName('img-2', 'Tumor')!.id;

    applyConfig({ segments: { Tumor: { color: 'blue' }, Extra: {} } });

    expect(segments().appearanceOf(first).cssColor).toBe('#0000ff');
    expect(segments().appearanceOf(second).cssColor).toBe('#0000ff');
    expect(typeNames()).toEqual(['Tumor', 'Node', 'Extra']);
  });
});

describe('config applies after a restore', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatAndView('img-1');
  });

  it('overlays a restored segment of the same name rather than adding one', () => {
    const restored = segments().mintSegment('img-1', {
      name: 'Tumor',
      color: [1, 2, 3, 255],
      fillOpacity: 0.6,
    });

    applyConfig({ segments: { Tumor: { color: 'blue' } } });

    expect(typeNames()).toEqual(['Tumor']);
    expect(segments().appearanceOf(restored)).toMatchObject({
      color: cssColorToRGBA('blue'),
      fillOpacity: 0.6,
    });
  });

  it('keeps a restored segment the config does not name', () => {
    const restored = segments().mintSegment('img-1', { name: 'Restored' });

    applyConfig(TWO_TYPES);

    expect(segments().getSegment(restored)?.name).toBe('Restored');
    expect(typeNames()).toEqual(['Restored', 'Tumor', 'Node']);
  });
});

describe('configured defaults without an active image', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('waits for an image before creating configured segment identities', async () => {
    applyConfig(TWO_TYPES);

    expect(segments().imageSets.value).toEqual({});
    expect(boundMasks()).toEqual([]);

    await seatAndView('img-1');

    expect(typeNames()).toEqual(['Tumor', 'Node']);
    expect(segments().appearanceOf(segmentIdNamed('Tumor')).cssColor).toBe(
      '#00ff00'
    );
    expect(boundMasks()).toEqual([]);
  });

  it('starts future defaults at the first palette color independently of existing rows', async () => {
    await seatAndView('img-1');
    segments().mintSegment('img-1', { name: 'User' });
    applyConfig({ segments: { First: {}, Second: {} } });
    const configuredColors = ['First', 'Second'].map(
      (name) => segments().findSegmentByName('img-1', name)!.color
    );
    expect(configuredColors).toEqual(
      TOOL_COLORS.slice(1, 3).map(cssColorToRGBA)
    );

    setActivePinia(createPinia());
    applyConfig({ segments: { First: {}, Second: {} } });
    await seatAndView('img-2');
    expect(
      segments()
        .segmentList('img-2')
        .map(({ color }) => color)
    ).toEqual(TOOL_COLORS.slice(0, 2).map(cssColorToRGBA));
  });
});
