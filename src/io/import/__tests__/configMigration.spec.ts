import { describe, expect, it } from 'vitest';
import { config, recognizeConfig } from '../configJson';

const legacy = { defaultLabels: { Tumor: { color: 'red' } } };

describe('canonical segmentation configuration', () => {
  it.each(['nii.gz', 'nrrd', ''])(
    'migrates save format %s without retaining the old key',
    (format) => {
      const parsed = config.parse({ io: { segmentGroupSaveFormat: format } });
      expect(parsed.io?.segmentationSaveFormat).toBe(format);
      expect(parsed.io).not.toHaveProperty('segmentGroupSaveFormat');
      expect(config.parse({ io: { segmentationSaveFormat: format } })).toEqual(
        parsed
      );
      expect(
        config.parse({
          io: {
            segmentationSaveFormat: format,
            segmentGroupSaveFormat: format,
          },
        })
      ).toEqual(parsed);
    }
  );

  it.each([
    ['nii', 'nrrd'],
    ['', 'nii'],
    ['nii', ''],
  ])('rejects conflicting formats %s and %s', (old, current) => {
    expect(() =>
      config.parse({
        io: { segmentGroupSaveFormat: old, segmentationSaveFormat: current },
      })
    ).toThrow('conflicts with io.segmentationSaveFormat');
  });

  it.each(['segmentGroupSaveFormat', 'segmentationSaveFormat'])(
    'rejects non-string %s',
    (key) => {
      for (const value of [null, 3]) {
        expect(config.safeParse({ io: { [key]: value } }).success).toBe(false);
      }
    }
  );

  it.each([null, {}, { Other: { color: 'blue' } }])(
    'preserves canonical segments %j over labels',
    (segments) => {
      const parsed = config.parse({ segments, labels: legacy });
      expect(parsed.segments).toEqual(segments);
      expect(parsed).not.toHaveProperty('labels');
    }
  );

  it.each([{}, { defaultLabels: null }, { polygonLabels: {} }])(
    'preserves empty legacy registry semantics for %j',
    (labels) => {
      expect(config.parse({ labels }).segments).toEqual({});
    }
  );

  it('leaves an omitted registry untouched and rejects a null legacy section', () => {
    expect(config.parse({}).segments).toBeUndefined();
    expect(config.safeParse({ labels: null }).success).toBe(false);
  });

  it('converts labels during recognition and reports all deprecated keys', async () => {
    const recognized = await recognizeConfig({
      labels: legacy,
      io: { segmentGroupSaveFormat: 'nii', segmentGroupExtension: 'seg' },
    });
    expect(recognized).toMatchObject({
      kind: 'config',
      config: {
        segments: legacy.defaultLabels,
        io: { segmentationSaveFormat: 'nii', segmentationExtension: 'seg' },
      },
      ignoredKeys: [],
      deprecatedKeys: [
        'io.segmentGroupExtension',
        'io.segmentGroupSaveFormat',
        'labels',
      ],
    });
    if (recognized.kind === 'config')
      expect(recognized.config).not.toHaveProperty('labels');
  });

  it('keeps tool precedence, drops rectangle-only styling, and strips labels', () => {
    const parsed = config.parse({
      labels: {
        rulerLabels: { Shared: { color: 'red', strokeWidth: 2 } },
        rectangleLabels: {
          Shared: { color: 'blue' },
          Rectangle: { color: 'green', fillColor: 'yellow' },
        },
        polygonLabels: { Shared: { color: 'black' } },
        defaultLabels: { Shared: { color: 'white' } },
      },
    });
    expect(parsed.segments).toEqual({
      Shared: { color: 'red', strokeWidth: 2 },
      Rectangle: { color: 'green' },
    });
    expect(parsed).not.toHaveProperty('labels');
  });
});
