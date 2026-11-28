import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { readSessionSetup } from '@/src/io/import/__tests__/restoreProcessorFixtures';

const savedView = (id: string) => ({
  id,
  name: 'Axial',
  type: '2D',
  dataID: null,
  options: { orientation: 'Axial' },
  config: { image: { slice: { slice: 3, min: 0, max: 9, syncState: false } } },
});

const leaf = (viewId: string) => ({ type: 'view', viewId });

describe('restoring saved views', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('restores settings only for the views its layout shows', async () => {
    const { manifest } = await readSessionSetup({
      version: '9.0.0',
      dataSources: [],
      layout: { direction: 'row', items: [leaf('a'), leaf('b')] },
      viewByID: {
        a: savedView('a'),
        b: savedView('b'),
        hidden: savedView('hidden'),
      },
    });

    expect(Object.keys(manifest.viewByID ?? {})).toEqual(['a', 'b']);
  });

  it('restores no saved views when the layout cannot be restored', async () => {
    const { manifest } = await readSessionSetup({
      version: '9.0.0',
      dataSources: [],
      layout: { direction: 'row', items: [leaf('a'), leaf('a')] },
      activeView: 'a',
      viewByID: { a: savedView('a') },
    });

    expect(manifest.viewByID).toBeUndefined();
    expect(manifest.activeView).toBeUndefined();
  });
});
