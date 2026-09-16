import { beforeEach, describe, it, expect } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';

import {
  applyPostStateConfig,
  config,
  recognizeConfig,
} from '@/src/io/import/configJson';
import { useImageCacheStore } from '@/src/store/image-cache';
import { MessageType, useMessageStore } from '@/src/store/messages';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { useViewStore } from '@/src/store/views';

const segments = () => useSegmentStore().segments;

const typeSummary = () =>
  segments().segmentList.value.map((type) => ({
    name: type.name,
    color: segments().appearanceOf(type.id).cssColor,
  }));

describe('config schema', () => {
  describe('shortcuts', () => {
    it('should accept partial shortcuts', () => {
      const result = config.safeParse({
        shortcuts: {
          polygon: 'Ctrl+p',
          rectangle: 'b',
        },
      });

      expect(result.success).to.be.true;
      expect(result.data?.shortcuts).to.deep.equal({
        polygon: 'Ctrl+p',
        rectangle: 'b',
      });
    });

    it('should reject invalid shortcut keys', () => {
      const result = config.safeParse({
        shortcuts: {
          invalidKey: 'Ctrl+x',
        },
      });

      expect(result.success).to.be.false;
    });

    it('should accept a list of keys for one action', () => {
      const result = config.safeParse({
        shortcuts: {
          deleteSelectedAnnotations: ['delete', 'backspace'],
        },
      });

      expect(result.success).to.be.true;
      expect(result.data?.shortcuts?.deleteSelectedAnnotations).to.deep.equal([
        'delete',
        'backspace',
      ]);
    });

    // + - and _ separate the keys of a chord, so a binding with one in key
    // position can never fire. It is dropped on apply, not rejected here,
    // so the rest of the config still loads.
    it.each(['ctrl+-', '-', 'shift+_'])(
      'should still parse a config carrying the unbindable %s',
      (binding) => {
        const result = config.safeParse({ shortcuts: { polygon: binding } });

        expect(result.success).to.be.true;
      }
    );

    it('should accept empty shortcuts', () => {
      const result = config.safeParse({
        shortcuts: {},
      });

      expect(result.success).to.be.true;
    });

    it('should accept config without shortcuts', () => {
      const result = config.safeParse({});

      expect(result.success).to.be.true;
    });
  });
});

describe('segment config', () => {
  const seatAndView = (id: string) => {
    useImageCacheStore().addVTKImageData(vtkImageData.newInstance(), 'CT', {
      id,
    });
    useViewStore().setDataForAllViews(id);
  };

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // Config is applied before the primary selection, so there is no current
  // image when the segments arrive.
  it('applies the shared segments configured before an image loads', async () => {
    applyPostStateConfig(
      config.parse({ segments: { Tumor: { color: '#00ff00' } } })
    );

    seatAndView('img-1');
    await nextTick();

    expect(typeSummary()).toEqual([{ name: 'Tumor', color: '#00ff00' }]);
  });

  // Functional CSS notation is not parsed. Falling back to black would read as
  // a deliberate colour, so the file's own boundary says what it could not use.
  it('reports a config color it cannot parse instead of blackening it', () => {
    applyPostStateConfig(
      config.parse({
        segments: {
          Tumor: { color: 'rgb(214, 0, 0)' },
          Node: { color: 'nonsense' },
          Fine: { color: '#00ff00' },
        },
      })
    );

    const [message] = useMessageStore().messages;
    expect(message.type).toBe(MessageType.Error);
    expect(message.title).toContain('Tumor (rgb(214, 0, 0))');
    expect(message.title).toContain('Node (nonsense)');
    expect(message.title).not.toContain('Fine');
  });

  it('configures rulers out of the one segment section', async () => {
    applyPostStateConfig(
      config.parse({ segments: { Tumor: { color: '#00ff00' } } })
    );

    seatAndView('img-1');
    await nextTick();

    const rulers = useRulerStore();
    const ruler = rulers.addTool({ imageID: 'img-1' });
    expect(rulers.appearanceOfTool(ruler)).toMatchObject({
      name: 'Tumor',
      cssColor: '#00ff00',
    });
  });

  it('applies segments to an image that is already loaded', async () => {
    seatAndView('img-1');
    await nextTick();

    applyPostStateConfig(
      config.parse({ segments: { Tumor: { color: '#00ff00' } } })
    );

    expect(typeSummary()).toEqual([{ name: 'Tumor', color: '#00ff00' }]);
  });

  it('offers the same segments on each image the user views', async () => {
    applyPostStateConfig(
      config.parse({ segments: { Tumor: { color: '#00ff00' } } })
    );

    seatAndView('img-1');
    await nextTick();
    seatAndView('img-2');
    await nextTick();

    expect(typeSummary()).toEqual([{ name: 'Tumor', color: '#00ff00' }]);
    // Offered, not minted: a configured segment gets a mask on the first edit.
    expect(
      useSegmentationStore().getSegmentationForImage('img-1')
    ).toBeUndefined();
  });

  // The segment carries the appearance, so one configured entry reaches paint,
  // rectangles and polygons alike.
  it('keeps the configured appearance on the segment an edit lands in', async () => {
    applyPostStateConfig(
      config.parse({
        segments: { Tumor: { color: '#00ff00', strokeWidth: 9 } },
      })
    );
    seatAndView('img-1');
    await nextTick();

    const segmentId = segments().findSegmentByName('Tumor')!.id;
    segments().selectSegment(segmentId);
    const maskId = useSegmentationStore().resolveEditTarget('img-1');
    const rectangles = useRectangleStore();
    const rectangle = rectangles.addTool({ imageID: 'img-1' });

    expect(useSegmentationStore().getMask(maskId).segmentId).toBe(segmentId);
    expect(rectangles.appearanceOfTool(rectangle)).toMatchObject({
      name: 'Tumor',
      cssColor: '#00ff00',
      strokeWidth: 9,
    });
  });

  it('creates nothing when no segments are configured', async () => {
    applyPostStateConfig(config.parse({ segments: {} }));

    seatAndView('img-1');
    await nextTick();

    expect(segments().segmentList.value).toEqual([]);
    expect(
      useSegmentationStore().getSegmentationForImage('img-1')
    ).toBeUndefined();
  });
});

describe('legacy labels', () => {
  const applyLabels = (labels: unknown) =>
    applyPostStateConfig(config.parse({ labels }));

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // Only known top-level keys mark a file as config, so a config that names
  // nothing but labels has to keep counting as one.
  it('recognizes a config that carries only labels', async () => {
    const recognized = await recognizeConfig({
      labels: { defaultLabels: { Tumor: { color: 'red' } } },
    });

    expect(recognized.kind).toBe('config');
  });

  it('reads every label record into the one registry', () => {
    applyLabels({
      defaultLabels: { Tumor: { color: '#00ff00' } },
      rulerLabels: { 'Long axis': { color: '#0000ff' } },
    });

    expect(typeSummary()).toEqual([
      { name: 'Long axis', color: '#0000ff' },
      { name: 'Tumor', color: '#00ff00' },
    ]);
  });

  it('carries a label stroke width onto its segment', () => {
    applyLabels({ polygonLabels: { Tumor: { color: 'red', strokeWidth: 4 } } });

    const segmentId = segments().findSegmentByName('Tumor')!.id;
    expect(segments().appearanceOf(segmentId).strokeWidth).toBe(4);
  });

  it('gives a name several tools declared one segment', () => {
    applyLabels({
      rulerLabels: { Tumor: { color: '#0000ff' } },
      polygonLabels: { Tumor: { color: '#00ff00' } },
    });

    expect(typeSummary()).toEqual([{ name: 'Tumor', color: '#0000ff' }]);
  });

  it('keeps inherited-property names and their first-source appearance', () => {
    applyLabels({
      rulerLabels: {
        constructor: { color: '#0000ff' },
        toString: { color: '#00ff00' },
      },
      polygonLabels: {
        constructor: { color: '#ff0000' },
        ordinary: { color: '#ffffff' },
      },
    });

    expect(typeSummary()).toEqual([
      { name: 'constructor', color: '#0000ff' },
      { name: 'toString', color: '#00ff00' },
      { name: 'ordinary', color: '#ffffff' },
    ]);
  });

  it('lets a tool record outrank the default of the same name', () => {
    applyLabels({
      defaultLabels: { Tumor: { color: '#00ff00' } },
      rectangleLabels: { Tumor: { color: '#0000ff' } },
    });

    expect(typeSummary()).toEqual([{ name: 'Tumor', color: '#0000ff' }]);
  });

  it('keeps a rectangle label whose fill color has no segment equivalent', () => {
    applyLabels({
      rectangleLabels: { Tumor: { color: '#00ff00', fillColor: '#ff000030' } },
    });

    expect(typeSummary()).toEqual([{ name: 'Tumor', color: '#00ff00' }]);
  });

  it('leaves the labels of an already converted config alone', () => {
    applyPostStateConfig(
      config.parse({
        segments: { Lesion: { color: '#00ff00' } },
        labels: { defaultLabels: { Tumor: { color: '#0000ff' } } },
      })
    );

    expect(typeSummary()).toEqual([{ name: 'Lesion', color: '#00ff00' }]);
  });
});
