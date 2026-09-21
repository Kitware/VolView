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

const namesOf = (registry: {
  segmentList: { value: Array<{ name: string }> };
}) => registry.segmentList.value.map((type) => type.name);

describe('segment registry', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('mints a named segment and selects it', () => {
    const registry = createSegmentRegistry();

    const id = registry.addSegment({ name: 'Tumor' });

    expect(registry.getSegment(id)?.name).toBe('Tumor');
    expect(registry.selectedSegmentId.value).toBe(id);
  });

  it('keeps a segment id across a rename', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment({ name: 'Tumor' });

    registry.updateSegment(id, { name: 'Lesion' });

    expect(registry.getSegment(id)?.name).toBe('Lesion');
    expect(registry.segmentList.value.map((type) => type.id)).toEqual([id]);
  });

  it('keeps the required fields a patch leaves undefined', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment({ name: 'Tumor', color: [1, 2, 3, 255] });

    registry.updateSegment(id, { name: undefined, color: undefined });

    expect(registry.getSegment(id)).toMatchObject({
      name: 'Tumor',
      color: [1, 2, 3, 255],
    });
    expect(registry.findSegmentByName('Tumor')?.id).toBe(id);
  });

  it('assigns consecutive default segment names', () => {
    const registry = createSegmentRegistry();

    expect(registry.getSegment(registry.addSegment())?.name).toBe('Segment 1');
    expect(registry.getSegment(registry.addSegment())?.name).toBe('Segment 2');
  });

  it('mints the lowest free name again once a deletion or rename frees it', () => {
    const registry = createSegmentRegistry();
    const nameOf = (id: string) => registry.getSegment(id)?.name;
    const [first, second] = [registry.addSegment(), registry.addSegment()];
    registry.addSegment();

    registry.deleteSegment(first);
    expect(nameOf(registry.addSegment())).toBe('Segment 1');

    registry.updateSegment(second, { name: 'Liver' });
    expect(nameOf(registry.addSegment())).toBe('Segment 2');
    expect(nameOf(registry.addSegment())).toBe('Segment 4');

    registry.addSegment({ name: registry.uniqueName('Liver') });
    const third = registry.addSegment({ name: registry.uniqueName('Liver') });
    expect(nameOf(third)).toBe('Liver (3)');
    registry.deleteSegment(third);
    expect(registry.uniqueName('Liver ')).toBe('Liver (3)');
  });

  it('cycles the tool colors for minted segments', () => {
    const registry = createSegmentRegistry();

    const ids = TOOL_COLORS.map(() => registry.addSegment());

    expect(ids.map((id) => registry.getSegment(id)?.color)).toEqual(
      TOOL_COLORS.map(cssColorToRGBA)
    );
  });

  it('lists segments in creation order, which is the picking order', () => {
    const registry = createSegmentRegistry();
    const first = registry.addSegment({ name: 'Tumor' });
    const second = registry.addSegment({ name: 'Node' });

    expect(namesOf(registry)).toEqual(['Tumor', 'Node']);
    expect(registry.orderIndexOf(first)).toBe(0);
    expect(registry.orderIndexOf(second)).toBe(1);
  });

  it('keeps the list and the order index in step across a deletion', () => {
    const registry = createSegmentRegistry();
    const ids = ['A', 'B', 'C'].map((name) => registry.addSegment({ name }));

    registry.deleteSegment(ids[1]);
    const fourth = registry.addSegment({ name: 'D' });
    registry.updateSegment(ids[2], { name: 'C2' });

    expect(namesOf(registry)).toEqual(['A', 'C2', 'D']);
    expect(registry.orderIndexOf(fourth)).toBe(2);
    expect(registry.orderIndexOf(ids[1])).toBe(-1);
  });

  it('forgets a deleted or renamed name', () => {
    const registry = createSegmentRegistry();
    const liver = registry.addSegment({ name: 'Liver' });
    const spleen = registry.addSegment({ name: 'Spleen' });

    registry.deleteSegment(liver);
    registry.updateSegment(spleen, { name: 'Kidney' });

    expect(registry.findSegmentByName('Liver')).toBeUndefined();
    expect(registry.findSegmentByName('Spleen')).toBeUndefined();
    expect(registry.findSegmentByName('Kidney')?.id).toBe(spleen);
    expect(registry.uniqueName(' Spleen ')).toBe('Spleen');
  });

  it('finds the first in registry order when a name repeats', () => {
    const registry = createSegmentRegistry();
    const first = registry.addSegment({ name: 'Liver' });
    const second = registry.addSegment({ name: 'Other' });
    registry.updateSegment(second, { name: 'Liver' });

    expect(registry.findSegmentByName('Liver')?.id).toBe(first);

    registry.moveSegment(second, first);

    expect(registry.findSegmentByName('Liver')?.id).toBe(second);
  });

  it('resolves absent appearance to the app defaults', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment({ name: 'Tumor' });

    const appearance = registry.appearanceOf(id);

    expect(appearance.fillOpacity).toBe(1);
    expect(appearance.outlineOpacity).toBe(1);
    expect(registry.getSegment(id)?.fillOpacity).toBeUndefined();
  });

  it('binds an exact name to the segment already carrying it', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment({ name: 'Tumor', color: [1, 2, 3, 255] });

    expect(registry.segmentNamed('Tumor', { color: [9, 9, 9, 255] })).toBe(id);
    // The registry's own color wins on a match.
    expect(registry.getSegment(id)?.color).toEqual([1, 2, 3, 255]);
  });

  it('mints a segment when no name matches', () => {
    const registry = createSegmentRegistry();
    registry.addSegment({ name: 'Tumor' });

    const id = registry.segmentNamed('Node');

    expect(registry.getSegment(id)?.name).toBe('Node');
    expect(namesOf(registry)).toEqual(['Tumor', 'Node']);
  });

  it('clears the selection when the last segment is deleted', () => {
    const registry = createSegmentRegistry();
    const id = registry.addSegment({ name: 'Tumor' });

    registry.deleteSegment(id);

    expect(registry.segmentList.value).toEqual([]);
    expect(registry.selectedSegmentId.value).toBeFalsy();
  });

  it('hands a referenced segment to the removal callback before dropping it', () => {
    const registry = createSegmentRegistry();
    const removed: Array<string | undefined> = [];
    registry.declareReferences('test', {
      has: () => false,
      remove: (segmentId) => removed.push(registry.getSegment(segmentId)?.name),
    });
    const id = registry.addSegment({ name: 'Tumor' });

    registry.deleteSegment(id);

    expect(removed).toEqual(['Tumor']);
    expect(registry.getSegment(id)).toBeUndefined();
  });

  it('mints and selects a segment for the first edit that needs one', () => {
    const registry = createSegmentRegistry();

    const id = registry.ensureSelectedSegment();

    expect(registry.selectedSegmentId.value).toBe(id);
    // Idempotent: a second edit reuses the selection.
    expect(registry.ensureSelectedSegment()).toBe(id);
  });

  it('selects the first existing segment without adding a placeholder', () => {
    const registry = createSegmentRegistry();
    const first = registry.mintSegment({ name: 'Liver' });
    const second = registry.mintSegment({ name: 'Spleen' });
    expect(registry.ensureSelectedSegment()).toBe(first);
    expect(registry.segmentList.value.map((segment) => segment.name)).toEqual([
      'Liver',
      'Spleen',
    ]);
    registry.selectSegment(second);
    expect(registry.ensureSelectedSegment()).toBe(second);
  });

  it('selects the first segment in list order while none is chosen', () => {
    const registry = createSegmentRegistry();
    const first = registry.mintSegment({ name: 'Liver' });
    const second = registry.mintSegment({ name: 'Spleen' });

    expect(registry.selectedSegmentId.value).toBe(first);

    registry.moveSegment(second, first);

    expect(registry.selectedSegmentId.value).toBe(second);
  });

  it('keeps a choice when asked to select nothing or a missing segment', () => {
    const registry = createSegmentRegistry();
    registry.mintSegment({ name: 'Liver' });
    const chosen = registry.mintSegment({ name: 'Spleen' });
    registry.selectSegment(chosen);

    registry.selectSegment(undefined);
    registry.selectSegment(null);
    registry.selectSegment('nope');

    expect(registry.selectedSegmentId.value).toBe(chosen);
  });

  it('asks for the chosen row to be revealed again on reselection', () => {
    const registry = createSegmentRegistry();
    const chosen = registry.mintSegment({ name: 'Liver' });
    registry.selectSegment(chosen);
    const revision = registry.selectionRevision.value;

    registry.selectSegment(chosen);

    expect(registry.selectionRevision.value).toBe(revision + 1);
  });

  it('falls back to the first segment once the chosen one is deleted', () => {
    const registry = createSegmentRegistry();
    const first = registry.mintSegment({ name: 'Liver' });
    const chosen = registry.mintSegment({ name: 'Spleen' });
    registry.mintSegment({ name: 'Kidney' });
    registry.selectSegment(chosen);

    registry.deleteSegment(chosen);

    expect(registry.selectedSegmentId.value).toBe(first);
  });

  it('selects a configured segment without minting one beside it', () => {
    const registry = createSegmentRegistry();

    registry.replaceConfigSegments({ Tumor: {}, Edema: {} });
    const tumor = registry.findSegmentByName('Tumor')?.id;

    expect(registry.selectedSegmentId.value).toBe(tumor);
    expect(registry.ensureSelectedSegment()).toBe(tumor);
    expect(namesOf(registry)).toEqual(['Tumor', 'Edema']);
  });

  it('keeps the current color when a configured color does not parse', () => {
    const registry = createSegmentRegistry();
    const id = registry.mintSegment({ name: 'Tumor', color: [0, 255, 0, 255] });

    registry.replaceConfigSegments({
      Tumor: { color: 'rgb(255, 0, 0)', strokeWidth: 3 },
    });

    expect(registry.getSegment(id)).toMatchObject({
      color: [0, 255, 0, 255],
      strokeWidth: 3,
    });
  });

  it('adopts restored segments under fresh ids, overwriting nothing', () => {
    const registry = createSegmentRegistry();
    const existing = registry.addSegment({
      name: 'Tumor',
      color: [1, 1, 1, 255],
    });
    registry.declareReferences('test', {
      has: (segmentId) => segmentId === existing,
      remove: () => {},
    });

    const { idMap } = registry.adopt([
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
    const existing = registry.addSegment({
      name: 'Tumor',
      color: [1, 1, 1, 255],
      strokeWidth: 3,
    });

    const { idMap } = registry.adopt([
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
    const existing = registry.addSegment({ name: 'Tumor' });

    const { idMap } = registry.adopt([savedSegment('a'), savedSegment('b')]);

    expect(idMap.a).toBe(existing);
    expect(idMap.b).not.toBe(existing);
    expect(namesOf(registry)).toEqual(['Tumor', 'Tumor (2)']);
  });

  it('suffixes a repeated name the same restore minted first', () => {
    const registry = createSegmentRegistry();

    const { idMap } = registry.adopt([savedSegment('a'), savedSegment('b')]);

    expect(idMap.a).not.toBe(idMap.b);
    expect(namesOf(registry)).toEqual(['Tumor', 'Tumor (2)']);
  });

  it('restores onto an empty configured segment beneath the config', () => {
    const registry = createSegmentRegistry();
    registry.replaceConfigSegments({ Tumor: { color: '#ff0000' } });
    const tumor = registry.findSegmentByName('Tumor')?.id;

    const { idMap } = registry.adopt([
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
    registry.replaceConfigSegments({ Tumor: {} });
    expect(registry.getSegment(tumor)?.color).toEqual([2, 2, 2, 255]);

    // The segment is the session's too, so clearing the config keeps it.
    registry.replaceConfigSegments(null);
    expect(registry.getSegment(tumor)?.name).toBe('Tumor');
  });

  it('adopts the first of a repeated id and seats no segment for the rest', () => {
    const registry = createSegmentRegistry();

    const { idMap, repeated } = registry.adopt([
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

    const { idMap } = registry.adopt([
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
      registry.adopt([
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
      registry.replaceConfigSegments({ Tumor: {}, Edema: {} });
      const saved = restoreSaved(registry);

      registry.restoreSelection(saved);

      expect(registry.selectedSegmentId.value).toBe(saved);
    });

    it('replaces the first-segment fallback', () => {
      const registry = createSegmentRegistry();
      registry.mintSegment({ name: 'Tumor' });
      const saved = restoreSaved(registry);

      registry.restoreSelection(saved);

      expect(registry.selectedSegmentId.value).toBe(saved);
    });

    it('replaces a segment an edit seated automatically', () => {
      const registry = createSegmentRegistry();
      registry.ensureSelectedSegment();
      const saved = restoreSaved(registry);

      registry.restoreSelection(saved);

      expect(registry.selectedSegmentId.value).toBe(saved);
    });

    it('leaves a selection the user made', () => {
      const registry = createSegmentRegistry();
      registry.replaceConfigSegments({ Tumor: {}, Edema: {} });
      const edema = registry.findSegmentByName('Edema')?.id;
      registry.selectSegment(edema);
      const saved = restoreSaved(registry);

      registry.restoreSelection(saved);

      expect(registry.selectedSegmentId.value).toBe(edema);
    });
  });
});

describe('the shared registry', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await seatSpecImage('img-1');
  });

  it('shares one registry across paint, rectangles, polygons and rulers', () => {
    const id = useSegmentStore().segments.addSegment({ name: 'Tumor' });

    const tools = [usePolygonStore(), useRectangleStore(), useRulerStore()].map(
      (store) => store.toolByID[store.addTool({ imageID: 'img-1' })]
    );

    expect(tools.map((tool) => tool.segmentId)).toEqual([id, id, id]);
    expect(maskOn('img-1', id).segmentId).toBe(id);
  });

  it('starts the shared registry empty, so viewing creates nothing', () => {
    expect(useSegmentStore().segments.segmentList.value).toEqual([]);
    expect(useSegmentationStore().segmentations).toEqual({});
  });

  it('suffixes a restored segment whose name holds a mask or a shape', () => {
    const shared = useSegmentStore().segments;
    const masked = shared.addSegment({ name: 'Tumor', color: [1, 1, 1, 255] });
    maskOn('img-1', masked);
    const shaped = shared.addSegment({ name: 'Node', color: [1, 1, 1, 255] });
    usePolygonStore().addTool({ imageID: 'img-1', segmentId: shaped });

    const { idMap } = shared.adopt([
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
