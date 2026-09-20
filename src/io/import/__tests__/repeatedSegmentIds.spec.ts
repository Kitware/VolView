import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { completeStateFileRestore } from '@/src/io/import/processors/restoreStateFile';
import { useMessageStore } from '@/src/store/messages';
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
    });

    await completeStateFileRestore(manifest, [], { parent: 'parent' });

    const notice = useMessageStore().messages.find(
      ({ title }) => title === 'Some scene content could not be restored'
    );
    expect(notice?.options.details).toBe(
      '- segment: Spleen (repeats the id of an earlier segment)'
    );
  });
});
