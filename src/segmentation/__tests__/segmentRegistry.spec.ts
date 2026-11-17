import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { computed } from 'vue';
import { seatSpecImage } from '@/src/segmentation/__tests__/segmentMaskFixtures';

import { TOOL_COLORS } from '@/src/config';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useRulerStore } from '@/src/store/tools/rulers';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useRectangleStore } from '@/src/store/tools/rectangles';
import {
  createSegmentRegistry,
  type SegmentRegistry,
} from '@/src/segmentation/segmentRegistry';
import { cssColorToRGBA } from '@/src/segmentation/color';
import type { Segment } from '@/src/segmentation/segment';

const savedSegment = (id: string, name = 'Tumor'): Segment => ({
  id,
  name,
  color: [2, 2, 2, 255],
  visible: true,
  locked: false,
});

const namesOf = (registry: SegmentRegistry, imageId = 'img-1') =>
  registry.segmentList(imageId).map((segment) => segment.name);

describe('segment registry', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('mints a named segment and selects it', () => {
    const registry = createSegmentRegistry();

    const id = registry.addSegment('img-1', { name: 'Tumor' });

    expect(registry.getSegment(id)?.name).toBe('Tumor');
    expect(registry.selectedSegmentId('img-1')).toBe(id);
  });

  it('keeps a segment id across a rename', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment('img-1', { name: 'Tumor' });

    registry.updateSegment(id, { name: 'Lesion' });

    expect(registry.getSegment(id)?.name).toBe('Lesion');
    expect(registry.segmentList('img-1').map((segment) => segment.id)).toEqual([
      id,
    ]);
  });

  it('keeps the required fields a patch leaves undefined', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment('img-1', {
      name: 'Tumor',
      color: [1, 2, 3, 255],
    });

    registry.updateSegment(id, { name: undefined, color: undefined });

    expect(registry.getSegment(id)).toMatchObject({
      name: 'Tumor',
      color: [1, 2, 3, 255],
    });
    expect(registry.findSegmentByName('img-1', 'Tumor')?.id).toBe(id);
  });

  it('assigns consecutive default segment names', () => {
    const registry = createSegmentRegistry();

    expect(registry.getSegment(registry.addSegment('img-1'))?.name).toBe(
      'Segment 1'
    );
    expect(registry.getSegment(registry.addSegment('img-1'))?.name).toBe(
      'Segment 2'
    );
  });

  it('mints the lowest free name again once a deletion or rename frees it', () => {
    const registry = createSegmentRegistry();
    const nameOf = (id: string) => registry.getSegment(id)?.name;
    const [first, second] = [
      registry.addSegment('img-1'),
      registry.addSegment('img-1'),
    ];
    registry.addSegment('img-1');

    registry.deleteSegment(first);
    expect(nameOf(registry.addSegment('img-1'))).toBe('Segment 1');

    registry.updateSegment(second, { name: 'Liver' });
    expect(nameOf(registry.addSegment('img-1'))).toBe('Segment 2');
    expect(nameOf(registry.addSegment('img-1'))).toBe('Segment 4');

    registry.addSegment('img-1', { name: 'Liver' });
    const third = registry.addSegment('img-1', { name: 'Liver' });
    expect(nameOf(third)).toBe('Liver (3)');
    registry.deleteSegment(third);
    expect(nameOf(registry.addSegment('img-1', { name: 'Liver ' }))).toBe(
      'Liver (3)'
    );
  });

  it('cycles the tool colors for minted segments', () => {
    const registry = createSegmentRegistry();

    const ids = TOOL_COLORS.map(() => registry.addSegment('img-1'));

    expect(ids.map((id) => registry.getSegment(id)?.color)).toEqual(
      TOOL_COLORS.map(cssColorToRGBA)
    );
  });

  it('lists segments in creation order, which is the picking order', () => {
    const registry = createSegmentRegistry();
    const first = registry.addSegment('img-1', { name: 'Tumor' });
    const second = registry.addSegment('img-1', { name: 'Node' });

    expect(namesOf(registry)).toEqual(['Tumor', 'Node']);
    expect(registry.orderIndexOf(first)).toBe(0);
    expect(registry.orderIndexOf(second)).toBe(1);
  });

  it('reuses an image list across readers and unrelated edits while keeping its contents reactive', () => {
    const registry = createSegmentRegistry();
    const first = registry.addSegment('first', { name: 'A' });
    const other = registry.addSegment('second', { name: 'Other' });
    const list = computed(() => registry.segmentList('first'));
    const initial = list.value;

    expect(registry.segmentList('first')).toBe(initial);
    registry.selectSegment(first);
    registry.updateSegment(other, { name: 'Unrelated' });
    registry.mintSegment('second');
    expect(registry.segmentList('first')).toBe(initial);
    expect(list.value).toBe(initial);

    registry.updateSegment(first, { name: 'Renamed' });
    expect(list.value).not.toBe(initial);
    expect(list.value.map(({ name }) => name)).toEqual(['Renamed']);
    const next = registry.mintSegment('first', { name: 'B' });
    expect(list.value.map(({ id }) => id)).toEqual([first, next]);
    registry.moveSegment(next, first);
    expect(list.value.map(({ id }) => id)).toEqual([next, first]);
    registry.deleteSegment(first);
    expect(list.value.map(({ id }) => id)).toEqual([next]);
    registry.removeImage('first');
    expect(list.value).toEqual([]);
    const replacement = registry.addSegment('first', { name: 'Replacement' });
    expect(list.value.map(({ id }) => id)).toEqual([replacement]);
  });

  it('keeps the list and the order index in step across a deletion', () => {
    const registry = createSegmentRegistry();
    const ids = ['A', 'B', 'C'].map((name) =>
      registry.addSegment('img-1', { name })
    );

    registry.deleteSegment(ids[1]);
    const fourth = registry.addSegment('img-1', { name: 'D' });
    registry.updateSegment(ids[2], { name: 'C2' });

    expect(namesOf(registry)).toEqual(['A', 'C2', 'D']);
    expect(registry.orderIndexOf(fourth)).toBe(2);
    expect(registry.orderIndexOf(ids[1])).toBe(-1);
  });

  it('forgets a deleted or renamed name', () => {
    const registry = createSegmentRegistry();
    const liver = registry.addSegment('img-1', { name: 'Liver' });
    const spleen = registry.addSegment('img-1', { name: 'Spleen' });

    registry.deleteSegment(liver);
    registry.updateSegment(spleen, { name: 'Kidney' });

    expect(registry.findSegmentByName('img-1', 'Liver')).toBeUndefined();
    expect(registry.findSegmentByName('img-1', 'Spleen')).toBeUndefined();
    expect(registry.findSegmentByName('img-1', 'Kidney')?.id).toBe(spleen);
    const again = registry.addSegment('img-1', { name: ' Spleen ' });
    expect(registry.getSegment(again)?.name).toBe('Spleen');
  });

  it('numbers a mint or rename onto a taken name', () => {
    const registry = createSegmentRegistry();
    const first = registry.addSegment('img-1', { name: 'Liver' });
    const second = registry.addSegment('img-1', { name: 'Other' });

    registry.updateSegment(second, { name: 'Liver' });
    const third = registry.addSegment('img-1', { name: ' Liver ' });
    registry.updateSegment(first, { name: ' Liver ' });

    expect(namesOf(registry)).toEqual(['Liver', 'Liver (2)', 'Liver (3)']);
    expect(registry.findSegmentByName('img-1', 'Liver')?.id).toBe(first);
    expect(registry.findSegmentByName('img-1', 'Liver (3)')?.id).toBe(third);
  });

  it('resolves absent appearance to the app defaults', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment('img-1', { name: 'Tumor' });

    const appearance = registry.appearanceOf(id);

    expect(appearance.fillOpacity).toBe(1);
    expect(appearance.outlineOpacity).toBe(1);
    expect(registry.getSegment(id)?.fillOpacity).toBeUndefined();
  });

  it('binds an exact name to the segment already carrying it', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment('img-1', {
      name: 'Tumor',
      color: [1, 2, 3, 255],
    });

    expect(
      registry.seatSegment('img-1', { name: 'Tumor', color: [9, 9, 9, 255] })
    ).toBe(id);
    // The registry's own color wins on a match.
    expect(registry.getSegment(id)?.color).toEqual([1, 2, 3, 255]);
  });

  it('mints a segment when no name matches', () => {
    const registry = createSegmentRegistry();
    registry.addSegment('img-1', { name: 'Tumor' });

    const id = registry.seatSegment('img-1', { name: 'Node' });

    expect(registry.getSegment(id)?.name).toBe('Node');
    expect(namesOf(registry)).toEqual(['Tumor', 'Node']);
  });

  it('clears the selection when the last segment is deleted', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment('img-1', { name: 'Tumor' });

    registry.deleteSegment(id);

    expect(registry.segmentList('img-1')).toEqual([]);
    expect(registry.selectedSegmentId('img-1')).toBeFalsy();
  });

  it('hands a referenced segment to the removal callback before dropping it', () => {
    const registry = createSegmentRegistry();
    const removed: Array<string | undefined> = [];
    registry.declareReferences('test', {
      holds: () => false,
      remove: (segmentId) => removed.push(registry.getSegment(segmentId)?.name),
    });
    const id = registry.addSegment('img-1', { name: 'Tumor' });

    registry.deleteSegment(id);

    expect(removed).toEqual(['Tumor']);
    expect(registry.getSegment(id)).toBeUndefined();
  });

  it('mints and selects a segment for the first edit that needs one', () => {
    const registry = createSegmentRegistry();

    const id = registry.ensureSelectedSegment('img-1');

    expect(registry.selectedSegmentId('img-1')).toBe(id);
    // Idempotent: a second edit reuses the selection.
    expect(registry.ensureSelectedSegment('img-1')).toBe(id);
  });

  it('selects the first existing segment without adding a placeholder', () => {
    const registry = createSegmentRegistry();
    const first = registry.mintSegment('img-1', { name: 'Liver' });
    const second = registry.mintSegment('img-1', { name: 'Spleen' });
    expect(registry.ensureSelectedSegment('img-1')).toBe(first);
    expect(
      registry.segmentList('img-1').map((segment) => segment.name)
    ).toEqual(['Liver', 'Spleen']);
    registry.selectSegment(second);
    expect(registry.ensureSelectedSegment('img-1')).toBe(second);
  });

  it('selects the first segment in list order while none is chosen', () => {
    const registry = createSegmentRegistry();
    const first = registry.mintSegment('img-1', { name: 'Liver' });
    const second = registry.mintSegment('img-1', { name: 'Spleen' });

    expect(registry.selectedSegmentId('img-1')).toBe(first);

    registry.moveSegment(second, first);

    expect(registry.selectedSegmentId('img-1')).toBe(second);
  });

  it('keeps a choice when asked to select nothing or a missing segment', () => {
    const registry = createSegmentRegistry();
    registry.mintSegment('img-1', { name: 'Liver' });
    const chosen = registry.mintSegment('img-1', { name: 'Spleen' });
    registry.selectSegment(chosen);

    registry.selectSegment(undefined);
    registry.selectSegment(null);
    registry.selectSegment('nope');

    expect(registry.selectedSegmentId('img-1')).toBe(chosen);
  });

  it('asks for the chosen row to be revealed again on reselection', () => {
    const registry = createSegmentRegistry();
    const chosen = registry.mintSegment('img-1', { name: 'Liver' });
    registry.selectSegment(chosen);
    const revision = registry.selectionRevision('img-1');

    registry.selectSegment(chosen);

    expect(registry.selectionRevision('img-1')).toBe(revision + 1);
  });

  it('falls back to the first segment once the chosen one is deleted', () => {
    const registry = createSegmentRegistry();
    const first = registry.mintSegment('img-1', { name: 'Liver' });
    const chosen = registry.mintSegment('img-1', { name: 'Spleen' });
    registry.mintSegment('img-1', { name: 'Kidney' });
    registry.selectSegment(chosen);

    registry.deleteSegment(chosen);

    expect(registry.selectedSegmentId('img-1')).toBe(first);
  });

  it('seeds a new set from the config and selects its first segment', () => {
    const registry = createSegmentRegistry();
    registry.applyConfig({ Tumor: {}, Edema: {} });

    registry.ensureSet('img-1');
    const tumor = registry.findSegmentByName('img-1', 'Tumor')?.id;

    expect(registry.selectedSegmentId('img-1')).toBe(tumor);
    expect(registry.ensureSelectedSegment('img-1')).toBe(tumor);
    expect(namesOf(registry)).toEqual(['Tumor', 'Edema']);
  });

  it('continues the image palette beneath colors supplied by a config', () => {
    const registry = createSegmentRegistry();
    registry.addSegment('img-1');
    registry.addSegment('img-1');

    registry.applyConfig({
      Tumor: {},
      Liver: { color: 'blue' },
    });

    expect(registry.segmentList('img-1').map(({ color }) => color)).toEqual(
      [...TOOL_COLORS.slice(0, 3), 'blue'].map(cssColorToRGBA)
    );
    expect(registry.getSegment(registry.addSegment('img-1'))?.color).toEqual(
      cssColorToRGBA(TOOL_COLORS[4])
    );
  });

  it('gives a prepended config key the next color without changing retained keys', () => {
    const registry = createSegmentRegistry();
    registry.applyConfig({ Tumor: {}, Liver: {} });
    registry.ensureSet('img-1');
    const retained = registry.segmentList('img-1');

    registry.applyConfig({
      Node: {},
      Tumor: {},
      Liver: {},
    });

    expect(registry.segmentList('img-1')).toEqual([
      ...retained,
      expect.objectContaining({
        name: 'Node',
        color: cssColorToRGBA(TOOL_COLORS[2]),
      }),
    ]);
  });

  it('keeps the current color when a configured color does not parse', () => {
    const registry = createSegmentRegistry();
    const id = registry.mintSegment('img-1', {
      name: 'Tumor',
      color: [0, 255, 0, 255],
    });

    registry.applyConfig({
      Tumor: { color: 'rgb(255, 0, 0)', strokeWidth: 3 },
    });

    expect(registry.getSegment(id)).toMatchObject({
      color: [0, 255, 0, 255],
      strokeWidth: 3,
    });
  });

  it('restores onto an empty segment of the same name', () => {
    const registry = createSegmentRegistry();
    const existing = registry.addSegment('img-1', {
      name: 'Tumor',
      color: [1, 1, 1, 255],
      strokeWidth: 3,
    });

    const idMap = registry.adopt('img-1', [
      {
        ...savedSegment('saved'),
        visible: false,
        locked: true,
        fillOpacity: 0.5,
      },
    ]);

    expect(idMap.get('saved')).toBe(existing);
    expect(namesOf(registry)).toEqual(['Tumor']);
    expect(registry.getSegment(existing)).toEqual({
      id: existing,
      name: 'Tumor',
      color: [2, 2, 2, 255],
      visible: false,
      locked: true,
      fillOpacity: 0.5,
      outlineOpacity: undefined,
      strokeWidth: undefined,
    });
  });

  it('seats one restored segment per existing name and suffixes the rest', () => {
    const registry = createSegmentRegistry();
    const existing = registry.addSegment('img-1', { name: 'Tumor' });

    const idMap = registry.adopt('img-1', [
      savedSegment('a'),
      savedSegment('b'),
    ]);

    expect(idMap.get('a')).toBe(existing);
    expect(idMap.get('b')).not.toBe(existing);
    expect(namesOf(registry)).toEqual(['Tumor', 'Tumor (2)']);
  });

  it('suffixes a repeated name the same restore minted first', () => {
    const registry = createSegmentRegistry();

    const idMap = registry.adopt('img-1', [
      savedSegment('a'),
      savedSegment('b'),
    ]);

    expect(idMap.get('a')).not.toBe(idMap.get('b'));
    expect(namesOf(registry)).toEqual(['Tumor', 'Tumor (2)']);
  });

  it('numbers a second unnamed segment under a name it can be found by', () => {
    const registry = createSegmentRegistry();
    registry.addSegment('img-1', { name: '' });
    const second = registry.addSegment('img-1', { name: '' });

    expect(namesOf(registry)).toEqual(['', '(2)']);
    expect(registry.findSegmentByName('img-1', '(2)')?.id).toBe(second);
  });

  it('gives a restored set the same result whenever the config arrived', () => {
    const config = { Tumor: { color: '#090909' }, Node: {} };
    const before = createSegmentRegistry();
    before.applyConfig(config);
    before.adopt('img-1', [savedSegment('saved')]);
    before.applyTemplate('img-1');

    const after = createSegmentRegistry();
    after.adopt('img-1', [savedSegment('saved')]);
    after.applyConfig(config);

    const look = (registry: SegmentRegistry) =>
      registry.segmentList('img-1').map(({ name, color }) => ({ name, color }));
    expect(look(before)).toEqual(look(after));
    expect(look(before)).toEqual([
      { name: 'Tumor', color: [9, 9, 9, 255] },
      expect.objectContaining({ name: 'Node' }),
    ]);
  });

  it('seeds no set for an image the app does not hold', () => {
    const registry = createSegmentRegistry({ imageExists: () => false });
    registry.applyConfig({ Tumor: {} });

    registry.ensureSet('img-1');

    expect(namesOf(registry)).toEqual([]);
  });

  it('maps a repeated id to the segment its first entry made', () => {
    const registry = createSegmentRegistry();

    const idMap = registry.adopt('img-1', [
      {
        id: 'dup',
        name: 'A',
        color: [1, 1, 1, 255],
        visible: true,
        locked: false,
      },
      {
        id: 'dup',
        name: 'B',
        color: [2, 2, 2, 255],
        visible: true,
        locked: false,
      },
    ]);

    expect(namesOf(registry)).toEqual(['A']);
    expect(registry.getSegment(idMap.get('dup'))?.name).toBe('A');
  });

  describe('a restored selection', () => {
    const restoreSaved = (registry: SegmentRegistry) =>
      registry
        .adopt('img-1', [
          {
            id: 'saved',
            name: 'Saved',
            color: [1, 1, 1, 255],
            visible: true,
            locked: false,
          },
        ])
        .get('saved');

    it('replaces the selection a config offered', () => {
      const registry = createSegmentRegistry();
      registry.applyConfig({ Tumor: {}, Edema: {} });
      registry.ensureSet('img-1');
      const saved = restoreSaved(registry);

      registry.restoreSelection('img-1', saved);

      expect(registry.selectedSegmentId('img-1')).toBe(saved);
    });

    it('replaces the first-segment fallback', () => {
      const registry = createSegmentRegistry();
      registry.mintSegment('img-1', { name: 'Tumor' });
      const saved = restoreSaved(registry);

      registry.restoreSelection('img-1', saved);

      expect(registry.selectedSegmentId('img-1')).toBe(saved);
    });

    it('replaces a segment an edit seated automatically', () => {
      const registry = createSegmentRegistry();
      registry.ensureSelectedSegment('img-1');
      const saved = restoreSaved(registry);

      registry.restoreSelection('img-1', saved);

      expect(registry.selectedSegmentId('img-1')).toBe(saved);
    });

    it('leaves a selection the user made', () => {
      const registry = createSegmentRegistry();
      registry.applyConfig({ Tumor: {}, Edema: {} });
      registry.ensureSet('img-1');
      const edema = registry.findSegmentByName('img-1', 'Edema')?.id;
      registry.selectSegment(edema);
      const saved = restoreSaved(registry);

      registry.restoreSelection('img-1', saved);

      expect(registry.selectedSegmentId('img-1')).toBe(edema);
    });
  });
});

describe('image segment sets', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('matches names and assigns defaults within one image', () => {
    const registry = createSegmentRegistry();
    const first = registry.addSegment('first', { name: 'Tumor' });
    const second = registry.seatSegment('second', { name: 'Tumor' });

    expect(second).not.toBe(first);
    expect(registry.findSegmentByName('first', 'Tumor')?.id).toBe(first);
    expect(registry.getSegment(registry.addSegment('first'))?.name).toBe(
      'Segment 1'
    );
    expect(registry.getSegment(registry.addSegment('second'))?.name).toBe(
      'Segment 1'
    );
  });

  it('refuses moving or restoring selection across image ownership', () => {
    const registry = createSegmentRegistry();
    const first = registry.addSegment('first', { name: 'Tumor' });
    const second = registry.mintSegment('second', { name: 'Node' });

    registry.moveSegment(first, second);
    registry.restoreSelection('second', first);

    expect(namesOf(registry, 'first')).toEqual(['Tumor']);
    expect(namesOf(registry, 'second')).toEqual(['Node']);
    expect(registry.selectedSegmentId('second')).toBe(second);
    expect(registry.belongsToImage('second', first)).toBe(false);
    expect(registry.belongsToImage('first', first)).toBe(true);
  });

  it('forgets only the removed image metadata without invoking per-segment content removal', () => {
    const registry = createSegmentRegistry();
    const first = registry.addSegment('first', { name: 'Tumor' });
    const another = registry.addSegment('first', { name: 'Node' });
    const second = registry.addSegment('second', { name: 'Tumor' });
    registry.applyConfig({ Configured: {} });
    let individualRemovals = 0;
    registry.declareReferences('content', {
      holds: () => false,
      remove: () => {
        individualRemovals += 1;
      },
    });

    registry.removeImage('first');

    expect(individualRemovals).toBe(0);
    expect(registry.segmentList('first')).toEqual([]);
    expect(registry.getSegment(first)).toBeUndefined();
    expect(registry.getSegment(another)).toBeUndefined();
    expect(registry.belongsToImage('first', first)).toBe(false);
    expect(registry.getSegment(second)?.name).toBe('Tumor');
    expect(registry.selectedSegmentId('first')).toBeUndefined();
    expect(registry.selectedSegmentId('second')).toBe(second);
    registry.ensureSet('first');
    expect(registry.segmentList('first').map(({ name }) => name)).toEqual([
      'Configured',
    ]);
    const replacement = registry.addSegment('first');
    expect(registry.getSegment(replacement)?.name).toBe('Segment 1');
  });

  it('reads absent image context without initializing anything', () => {
    const registry = createSegmentRegistry();

    [undefined, 'missing'].forEach((imageId) => {
      expect(registry.segmentList(imageId)).toEqual([]);
      expect(registry.selectedSegmentId(imageId)).toBeUndefined();
      expect(registry.belongsToImage(imageId, 'missing')).toBe(false);
    });
    expect(registry.imageSets.value).toEqual({});
  });
});

describe('the shared registry', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
  });

  it('shares one registry across paint, rectangles, polygons and rulers', () => {
    const id = useSegmentStore().segments.addSegment('img-1', {
      name: 'Tumor',
    });

    const tools = [usePolygonStore(), useRectangleStore(), useRulerStore()].map(
      (store) => store.toolByID[store.addTool({ imageID: 'img-1' })]
    );

    expect(tools.map((tool) => tool.segmentId)).toEqual([id, id, id]);
    expect(useSegmentationStore().resolveEditTarget('img-1', id)).toBe(id);
  });

  it('starts the shared registry empty, so viewing creates nothing', () => {
    expect(useSegmentStore().segments.segmentList('img-1')).toEqual([]);
    expect(useSegmentStore().segments.imageSets.value).toEqual({});
  });

  describe('restoring onto a segment already in use', () => {
    const inUse = () => {
      const shared = useSegmentStore().segments;
      const masked = shared.addSegment('img-1', {
        name: 'Tumor',
        color: [1, 1, 1, 255],
      });
      useSegmentationStore().materializeMask(masked);
      const shaped = shared.addSegment('img-1', {
        name: 'Node',
        color: [1, 1, 1, 255],
      });
      usePolygonStore().addTool({ imageID: 'img-1', segmentId: shaped });
      return { shared, masked, shaped };
    };

    it('numbers a restored mask instead of joining it', () => {
      const { shared, masked, shaped } = inUse();

      const idMap = shared.adopt('img-1', [
        { ...savedSegment('tumor', 'Tumor'), withMask: true },
        { ...savedSegment('node', 'Node'), withMask: true },
      ]);

      expect(namesOf(shared)).toEqual([
        'Tumor',
        'Node',
        'Tumor (2)',
        'Node (2)',
      ]);
      expect(idMap.get('tumor')).not.toBe(masked);
      expect(idMap.get('node')).not.toBe(shaped);
      expect(shared.getSegment(masked)?.color).toEqual([1, 1, 1, 255]);
      expect(shared.getSegment(shaped)?.color).toEqual([1, 1, 1, 255]);
    });

    it('joins a restored segment without a mask and keeps the look', () => {
      const { shared, masked, shaped } = inUse();

      const idMap = shared.adopt('img-1', [
        savedSegment('tumor', 'Tumor'),
        savedSegment('node', 'Node'),
      ]);

      expect(namesOf(shared)).toEqual(['Tumor', 'Node']);
      expect(idMap.get('tumor')).toBe(masked);
      expect(idMap.get('node')).toBe(shaped);
      expect(shared.getSegment(masked)?.color).toEqual([1, 1, 1, 255]);
      expect(shared.getSegment(shaped)?.color).toEqual([1, 1, 1, 255]);
    });
  });
});
