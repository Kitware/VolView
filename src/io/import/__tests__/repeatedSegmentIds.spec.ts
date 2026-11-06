import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { createStateFileRestorer } from '@/src/io/import/processors/restoreStateFile';
import { migrateManifest } from '@/src/io/state-file/migrations';
import { ManifestSchema } from '@/src/io/state-file/schema';
import {
  manifestForImages,
  seatImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

const segment = (id: string, name: string) => ({
  id,
  name,
  color: [255, 0, 0, 255],
});

describe('restoring a manifest whose segments repeat an id', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('names the segment it could not restore', async () => {
    await seatImage('parent', { dimensions: [4, 4, 1] });
    const manifest = manifestForImages(['parent'], {
      segments: [segment('s1', 'Liver'), segment('s1', 'Spleen')],
      imageSegmentSets: [{ imageId: 'parent', segmentIds: ['s1'] }],
    });

    const addWarning = vi.fn();
    const restore = createStateFileRestorer({ addWarning });
    await restore(manifest, [], { parent: 'parent' });
    expect(addWarning).toHaveBeenCalledExactlyOnceWith(
      'Some scene content could not be restored',
      {
        details:
          '- segment: Spleen (catalog row 2; image: parent.nrrd; repeats the id of an earlier segment)',
      }
    );
  });

  it('reports a repeated legacy row once when its catalog is copied to several images', async () => {
    await seatImage('a');
    await seatImage('b');
    const migrated = migrateManifest(
      JSON.stringify(
        manifestForImages(['a', 'b'], {
          version: '7.0.0',
          segments: [segment('s1', 'Liver'), segment('s1', 'Spleen')],
        })
      )
    );
    const addWarning = vi.fn();

    await createStateFileRestorer({ addWarning })(
      ManifestSchema.parse(migrated.manifest),
      [],
      { a: 'a', b: 'b' },
      { migration: migrated.migration }
    );

    expect(addWarning).toHaveBeenCalledExactlyOnceWith(
      'Some scene content could not be restored',
      {
        details:
          '- segment: Spleen (catalog row 2; images: a.nrrd, b.nrrd; repeats the id of an earlier segment)',
      }
    );
  });

  it.each(['7.0.0', '8.0.0'])(
    'reports distinct same-name rows separately in version %s',
    async (version) => {
      await seatImage('a');
      await seatImage('b');
      const migrated = migrateManifest(
        JSON.stringify(
          manifestForImages(['a', 'b'], {
            version,
            segments: [
              segment('first', 'First'),
              segment('first', 'Repeated'),
              segment('second', 'Second'),
              segment('second', 'Repeated'),
            ],
            imageSegmentSets: [
              { imageId: 'a', segmentIds: ['first'] },
              { imageId: 'b', segmentIds: ['second'] },
            ],
          })
        )
      );
      const addWarning = vi.fn();
      await createStateFileRestorer({ addWarning })(
        ManifestSchema.parse(migrated.manifest),
        [],
        { a: 'a', b: 'b' },
        { migration: migrated.migration }
      );

      const images = (imageId: string) =>
        version === '7.0.0'
          ? 'images: a.nrrd, b.nrrd'
          : `image: ${imageId}.nrrd`;
      expect(addWarning).toHaveBeenCalledExactlyOnceWith(
        'Some scene content could not be restored',
        {
          details: [
            `- segment: Repeated (catalog row 2; ${images('a')}; repeats the id of an earlier segment)`,
            `- segment: Repeated (catalog row 4; ${images('b')}; repeats the id of an earlier segment)`,
          ].join('\n'),
        }
      );
    }
  );

  it.each([undefined, []])(
    'reports orphan definitions when image memberships are %j',
    async (imageSegmentSets) => {
      await seatImage('parent');
      const manifest = manifestForImages(['parent'], {
        segments: [segment('orphan', 'Unassigned')],
        imageSegmentSets,
      });
      const addWarning = vi.fn();
      await createStateFileRestorer({ addWarning })(manifest, [], {
        parent: 'parent',
      });
      expect(addWarning).toHaveBeenCalledExactlyOnceWith(
        'Some scene content could not be restored',
        { details: '- segment: Unassigned (is not assigned to an image)' }
      );
    }
  );
});
