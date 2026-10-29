import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import {
  maskOn,
  seatSpecImage,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

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

    registry.addSegment('img-1', {
      name: registry.uniqueName('img-1', 'Liver'),
    });
    const third = registry.addSegment('img-1', {
      name: registry.uniqueName('img-1', 'Liver'),
    });
    expect(nameOf(third)).toBe('Liver (3)');
    registry.deleteSegment(third);
    expect(registry.uniqueName('img-1', 'Liver ')).toBe('Liver (3)');
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
    expect(registry.uniqueName('img-1', ' Spleen ')).toBe('Spleen');
  });

  it('finds the first in registry order when a name repeats', () => {
    const registry = createSegmentRegistry();
    const first = registry.addSegment('img-1', { name: 'Liver' });
    const second = registry.addSegment('img-1', { name: 'Other' });
    registry.updateSegment(second, { name: 'Liver' });

    expect(registry.findSegmentByName('img-1', 'Liver')?.id).toBe(first);

    registry.moveSegment(second, first);

    expect(registry.findSegmentByName('img-1', 'Liver')?.id).toBe(second);
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
      registry.segmentNamed('img-1', 'Tumor', { color: [9, 9, 9, 255] })
    ).toBe(id);
    // The registry's own color wins on a match.
    expect(registry.getSegment(id)?.color).toEqual([1, 2, 3, 255]);
  });

  it('mints a segment when no name matches', () => {
    const registry = createSegmentRegistry();
    registry.addSegment('img-1', { name: 'Tumor' });

    const id = registry.segmentNamed('img-1', 'Node');

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
      has: () => false,
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
    const revision = registry.selectionRevision.value;

    registry.selectSegment(chosen);

    expect(registry.selectionRevision.value).toBe(revision + 1);
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

  it('selects a configured segment without minting one beside it', () => {
    const registry = createSegmentRegistry();

    registry.replaceConfigSegments('img-1', { Tumor: {}, Edema: {} });
    const tumor = registry.findSegmentByName('img-1', 'Tumor')?.id;

    expect(registry.selectedSegmentId('img-1')).toBe(tumor);
    expect(registry.ensureSelectedSegment('img-1')).toBe(tumor);
    expect(namesOf(registry)).toEqual(['Tumor', 'Edema']);
  });

  it('keeps the current color when a configured color does not parse', () => {
    const registry = createSegmentRegistry();
    const id = registry.mintSegment('img-1', {
      name: 'Tumor',
      color: [0, 255, 0, 255],
    });

    registry.replaceConfigSegments('img-1', {
      Tumor: { color: 'rgb(255, 0, 0)', strokeWidth: 3 },
    });

    expect(registry.getSegment(id)).toMatchObject({
      color: [0, 255, 0, 255],
      strokeWidth: 3,
    });
  });

  it('adopts restored segments under fresh ids, overwriting nothing', () => {
    const registry = createSegmentRegistry();
    const existing = registry.addSegment('img-1', {
      name: 'Tumor',
      color: [1, 1, 1, 255],
    });
    registry.declareReferences('test', {
      has: (segmentId) => segmentId === existing,
      remove: () => {},
    });

    const { idMap } = registry.adopt('img-1', [
      {
        id: existing,
        name: 'Tumor',
        color: [2, 2, 2, 255],
        visible: true,
        locked: false,
      },
    ]);

    expect(idMap[existing]).not.toBe(existing);
    expect(registry.getSegment(existing)?.color).toEqual([1, 1, 1, 255]);
    expect(registry.getSegment(idMap[existing])?.color).toEqual([2, 2, 2, 255]);
    expect(namesOf(registry)).toEqual(['Tumor', 'Tumor (2)']);
  });

  it('restores onto an empty segment of the same name', () => {
    const registry = createSegmentRegistry();
    const existing = registry.addSegment('img-1', {
      name: 'Tumor',
      color: [1, 1, 1, 255],
      strokeWidth: 3,
    });

    const { idMap } = registry.adopt('img-1', [
      {
        ...savedSegment('saved'),
        visible: false,
        locked: true,
        fillOpacity: 0.5,
      },
    ]);

    expect(idMap.saved).toBe(existing);
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

    const { idMap } = registry.adopt('img-1', [
      savedSegment('a'),
      savedSegment('b'),
    ]);

    expect(idMap.a).toBe(existing);
    expect(idMap.b).not.toBe(existing);
    expect(namesOf(registry)).toEqual(['Tumor', 'Tumor (2)']);
  });

  it('suffixes a repeated name the same restore minted first', () => {
    const registry = createSegmentRegistry();

    const { idMap } = registry.adopt('img-1', [
      savedSegment('a'),
      savedSegment('b'),
    ]);

    expect(idMap.a).not.toBe(idMap.b);
    expect(namesOf(registry)).toEqual(['Tumor', 'Tumor (2)']);
  });

  it('restores onto an empty configured segment beneath the config', () => {
    const registry = createSegmentRegistry();
    registry.replaceConfigSegments('img-1', { Tumor: { color: '#ff0000' } });
    const tumor = registry.findSegmentByName('img-1', 'Tumor')?.id;

    const { idMap } = registry.adopt('img-1', [
      {
        ...savedSegment('saved'),
        visible: false,
        locked: true,
        fillOpacity: 0.5,
      },
    ]);

    expect(idMap.saved).toBe(tumor);
    expect(namesOf(registry)).toEqual(['Tumor']);
    expect(registry.getSegment(tumor)).toMatchObject({
      color: cssColorToRGBA('#ff0000'),
      visible: false,
      locked: true,
      fillOpacity: 0.5,
    });

    // The session's appearance is what the config now layers over.
    registry.replaceConfigSegments('img-1', { Tumor: {} });
    expect(registry.getSegment(tumor)?.color).toEqual([2, 2, 2, 255]);

    // The segment is the session's too, so clearing the config keeps it.
    registry.replaceConfigSegments('img-1', null);
    expect(registry.getSegment(tumor)?.name).toBe('Tumor');
  });

  it('adopts the first of a repeated id and seats no segment for the rest', () => {
    const registry = createSegmentRegistry();

    const { idMap, repeated } = registry.adopt('img-1', [
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

    // Only one segment can answer for an id, so the second entry seats
    // nothing rather than a segment no mask or shape could reference.
    expect(Object.keys(idMap)).toEqual(['dup']);
    expect(namesOf(registry)).toEqual(['A']);
    expect(registry.getSegment(idMap.dup)?.name).toBe('A');
    expect(repeated.map(({ name }) => name)).toEqual(['B']);
  });

  // A file's ids are its own, so one that happens to spell an Object.prototype
  // key is an ordinary id: it seats a segment, and a lookup on the returned map
  // answers with that segment rather than with an inherited member.
  it('adopts a segment whose id spells a prototype member', () => {
    const registry = createSegmentRegistry();

    const { idMap } = registry.adopt('img-1', [
      {
        id: 'constructor',
        name: 'A',
        color: [1, 1, 1, 255],
        visible: true,
        locked: false,
      },
    ]);

    expect(Object.keys(idMap)).toEqual(['constructor']);
    expect(namesOf(registry)).toEqual(['A']);
    const [mintedId] = Object.values(idMap);
    expect(registry.getSegment(mintedId)?.name).toBe('A');
    expect(idMap.toString).toBeUndefined();
  });

  describe('a restored selection', () => {
    const restoreSaved = (registry: SegmentRegistry) =>
      registry.adopt('img-1', [
        {
          id: 'saved',
          name: 'Saved',
          color: [1, 1, 1, 255],
          visible: true,
          locked: false,
        },
      ]).idMap.saved;

    it('replaces the selection a config offered', () => {
      const registry = createSegmentRegistry();
      registry.replaceConfigSegments('img-1', { Tumor: {}, Edema: {} });
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
      registry.replaceConfigSegments('img-1', { Tumor: {}, Edema: {} });
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

  it('copies definitions and selection without sharing later edits', () => {
    const registry = createSegmentRegistry();
    const first = registry.addSegment('first', {
      name: 'Tumor',
      color: [1, 2, 3, 255],
      visible: false,
      locked: true,
      strokeWidth: 4,
    });
    registry.addSegment('first', { name: 'Node' });
    registry.selectSegment(first);

    registry.initializeSet('second', registry.snapshot('first'));
    const [copied] = registry.segmentList('second');

    expect(copied).toMatchObject({
      name: 'Tumor',
      color: [1, 2, 3, 255],
      visible: true,
      locked: false,
      strokeWidth: 4,
    });
    expect(copied.id).not.toBe(first);
    expect(registry.selectedSegmentId('second')).toBe(copied.id);
    registry.updateSegment(copied.id, { name: 'Lesion', locked: true });
    registry.moveSegment(copied.id, registry.segmentList('second')[1].id, true);
    registry.deleteSegment(copied.id);

    expect(namesOf(registry, 'first')).toEqual(['Tumor', 'Node']);
    expect(registry.getSegment(first)?.locked).toBe(true);
    expect(registry.selectedSegmentId('first')).toBe(first);
    expect(namesOf(registry, 'second')).toEqual(['Node']);
  });

  it('keeps the captured definitions while the source changes', () => {
    const registry = createSegmentRegistry();
    const first = registry.addSegment('first', { name: 'Tumor' });
    const snapshot = registry.snapshot('first');
    registry.updateSegment(first, { name: 'Lesion', color: [2, 3, 4, 255] });

    registry.initializeSet('second', snapshot);

    expect(namesOf(registry, 'second')).toEqual(['Tumor']);
    expect(registry.segmentList('second')[0].color).not.toEqual([2, 3, 4, 255]);
    expect(registry.segmentList('second')[0].color).not.toBe(
      snapshot.segments[0].color
    );
  });

  it('preserves an initialized empty set instead of copying again', () => {
    const registry = createSegmentRegistry();
    registry.addSegment('first', { name: 'Tumor' });
    registry.initializeSet('second', registry.snapshot('first'));
    registry.deleteSegment(registry.segmentList('second')[0].id);

    registry.initializeSet('second', registry.snapshot('first'));

    expect(namesOf(registry, 'second')).toEqual([]);
    expect(registry.imageSets.value.second).toEqual({ segmentIds: [] });
  });

  it('matches names, assigns defaults and applies config within one image', () => {
    const registry = createSegmentRegistry();
    const first = registry.addSegment('first', { name: 'Tumor' });
    const second = registry.segmentNamed('second', 'Tumor');
    registry.replaceConfigSegments('second', { Tumor: { color: 'red' } });

    expect(second).not.toBe(first);
    expect(registry.findSegmentByName('first', 'Tumor')?.id).toBe(first);
    expect(registry.uniqueName('second', 'Tumor')).toBe('Tumor (2)');
    expect(registry.getSegment(first)?.color).not.toEqual(
      cssColorToRGBA('red')
    );
    expect(registry.getSegment(second)?.color).toEqual(cssColorToRGBA('red'));
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
    expect(registry.ownerImageId(first)).toBe('first');
  });

  it('removes only the deleted image and its referenced content', () => {
    const registry = createSegmentRegistry();
    const first = registry.addSegment('first', { name: 'Tumor' });
    const second = registry.addSegment('second', { name: 'Tumor' });
    const removed: string[] = [];
    registry.declareReferences('content', {
      has: () => true,
      remove: (id) => removed.push(id),
    });

    registry.removeImage('first');

    expect(removed).toEqual([first]);
    expect(registry.imageSets.value.first).toBeUndefined();
    expect(registry.getSegment(first)).toBeUndefined();
    expect(registry.ownerImageId(first)).toBeUndefined();
    expect(registry.getSegment(second)?.name).toBe('Tumor');
  });

  it('reads absent image context without initializing anything', () => {
    const registry = createSegmentRegistry();

    expect(registry.segmentList(undefined)).toEqual([]);
    expect(registry.selectedSegmentId(undefined)).toBeUndefined();
    expect(registry.belongsToImage(undefined, 'missing')).toBe(false);
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
    expect(maskOn('img-1', id).segmentId).toBe(id);
  });

  it('starts the shared registry empty, so viewing creates nothing', () => {
    expect(useSegmentStore().segments.segmentList('img-1')).toEqual([]);
    expect(useSegmentationStore().segmentations).toEqual({});
  });

  it('suffixes a restored segment whose name holds a mask or a shape', () => {
    const shared = useSegmentStore().segments;
    const masked = shared.addSegment('img-1', {
      name: 'Tumor',
      color: [1, 1, 1, 255],
    });
    maskOn('img-1', masked);
    const shaped = shared.addSegment('img-1', {
      name: 'Node',
      color: [1, 1, 1, 255],
    });
    usePolygonStore().addTool({ imageID: 'img-1', segmentId: shaped });

    const { idMap } = shared.adopt('img-1', [
      savedSegment('tumor', 'Tumor'),
      savedSegment('node', 'Node'),
    ]);

    expect(namesOf(shared)).toEqual(['Tumor', 'Node', 'Tumor (2)', 'Node (2)']);
    expect([idMap.tumor, idMap.node]).not.toContain(masked);
    expect([idMap.tumor, idMap.node]).not.toContain(shaped);
    expect(shared.getSegment(masked)?.color).toEqual([1, 1, 1, 255]);
    expect(shared.getSegment(shaped)?.color).toEqual([1, 1, 1, 255]);
  });
});
