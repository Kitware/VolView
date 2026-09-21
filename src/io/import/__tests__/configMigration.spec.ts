import { describe, expect, it } from 'vitest';
import { config, recognizeConfig } from '@/src/io/import/configJson';
import handleConfig from '@/src/io/import/processors/handleConfig';

const legacy = { defaultLabels: { Tumor: { color: 'red' } } };

describe('canonical segmentation configuration', () => {
  it('names a rejected config key in plain text', async () => {
    const raw = {
      io: { segmentGroupExtension: 'a', segmentationExtension: 'b' },
    };
    const file = new File([JSON.stringify(raw)], 'config.json', {
      type: 'application/json',
    });

    await expect(
      handleConfig({ type: 'file', file, fileType: 'application/json' })
    ).rejects.toThrow(
      'Failed to parse config file: ✖ io.segmentGroupExtension conflicts with io.segmentationExtension. Use only io.segmentationExtension.\n  → at io.segmentationExtension'
    );
  });

  it.each([null, {}, { Other: { color: 'blue' } }])(
    'preserves canonical segments %j over labels',
    (segments) => {
      const parsed = config.parse({ segments, labels: legacy });
      expect(parsed.segments).toEqual(segments);
      expect(parsed).not.toHaveProperty('labels');
    }
  );

  it.each([
    {},
    { defaultLabels: null },
    { rulerLabels: null },
    { rulerLabels: null, rectangleLabels: null, polygonLabels: null },
  ])('leaves the registry alone for legacy labels %j', (labels) => {
    expect(config.parse({ labels }).segments).toBeUndefined();
  });

  it.each([{ polygonLabels: {} }, { defaultLabels: {} }])(
    'clears the registry for the empty legacy record in %j',
    (labels) => {
      expect(config.parse({ labels }).segments).toEqual({});
    }
  );

  it('reads defaultLabels only while some tool has no record of its own', () => {
    const labels = {
      rulerLabels: { Ruler: { color: 'red' } },
      rectangleLabels: null,
      defaultLabels: { Fallback: { color: 'blue' } },
    };

    expect(config.parse({ labels }).segments).toEqual({
      Ruler: { color: 'red' },
      Fallback: { color: 'blue' },
    });
    expect(
      config.parse({ labels: { ...labels, polygonLabels: null } }).segments
    ).toEqual({ Ruler: { color: 'red' } });
  });

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
      deprecations: [
        'io.segmentGroupExtension was migrated to io.segmentationExtension. Update your configuration to use io.segmentationExtension.',
        'io.segmentGroupSaveFormat was migrated to io.segmentationSaveFormat. Update your configuration to use io.segmentationSaveFormat.',
        'labels was migrated to segments. Update your configuration to use segments.',
      ],
    });
    if (recognized.kind === 'config')
      expect(recognized.config).not.toHaveProperty('labels');
  });

  it('reports labels as ignored, not migrated, beside segments', async () => {
    const recognized = await recognizeConfig({
      labels: legacy,
      segments: { Other: {} },
    });

    expect(recognized).toMatchObject({
      config: { segments: { Other: {} } },
      deprecations: [
        'labels is ignored because segments is present. Remove labels.',
      ],
    });
  });

  it('notes a rectangle label fill color it drops', async () => {
    const recognized = await recognizeConfig({
      labels: {
        rectangleLabels: { Box: { color: 'red', fillColor: '#ff000030' } },
      },
    });

    expect(recognized).toMatchObject({
      deprecations: [
        'labels was migrated to segments. Update your configuration to use segments.',
        'Rectangle label fillColor is no longer supported and was ignored.',
      ],
    });
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
