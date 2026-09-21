import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  applyPostStateConfig,
  config,
  recognizeConfig,
} from '@/src/io/import/configJson';
import { useSegmentStore } from '@/src/segmentation/segments';

const segments = () => useSegmentStore().segments;

const segmentSummary = () =>
  segments().segmentList.value.map((segment) => ({
    name: segment.name,
    color: segments().appearanceOf(segment.id).cssColor,
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
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('reports config colors it cannot parse', () => {
    const addError = vi.fn();
    applyPostStateConfig(
      config.parse({
        segments: {
          Tumor: { color: 'rgb(214, 0, 0)' },
          Node: { color: 'nonsense' },
          Fine: { color: '#00ff00' },
        },
      }),
      addError
    );
    expect(addError).toHaveBeenCalledTimes(1);
    const [[message]] = addError.mock.calls;
    expect(message).toContain('Tumor (rgb(214, 0, 0))');
    expect(message).toContain('Node (nonsense)');
    expect(message).not.toContain('Fine');
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

    expect(segmentSummary()).toEqual([
      { name: 'Long axis', color: '#0000ff' },
      { name: 'Tumor', color: '#00ff00' },
    ]);
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

    expect(segmentSummary()).toEqual([
      { name: 'constructor', color: '#0000ff' },
      { name: 'toString', color: '#00ff00' },
      { name: 'ordinary', color: '#ffffff' },
    ]);
  });
});
