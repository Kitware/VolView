import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { planSegmentationInput } from '@/src/processing/composables/segmentationInput';
import {
  captureLabelmapParts,
  composeLabelmapPart,
} from '@/src/segmentation/io/composition';
import {
  addMask,
  seatImage,
  seedVoxel,
  segmentOfMask,
  selectSegment,
} from '@/src/segmentation/__tests__/segmentMaskFixtures';

const seed = async () => {
  const parent = await seatImage('packing-parent', { dimensions: [8, 1, 1] });
  const entries = [
    ['Selected', [0, 1]],
    ['Crossing', [0, 2]],
    ['Disjoint', [3]],
    ['Conflicting', [3, 4]],
  ] as const;
  const masks = entries.map(([name, xs]) => {
    const id = addMask('packing-parent', name);
    xs.forEach((x) => seedVoxel(id, [x, 0, 0]));
    return id;
  });
  useSegmentStore().segments.selectSegment(segmentOfMask(masks[0]));
  const segmentation =
    useSegmentationStore().getSegmentationForImage('packing-parent')!;
  return { parent, masks, segmentation };
};

const namesAtVoxels = (composite: ReturnType<typeof composeLabelmapPart>) => {
  const names = new Map(
    composite.segments.map(({ value, name }) => [value, name])
  );
  return Array.from(
    composite.labelmap.getPointData().getScalars().getData(),
    (value) => names.get(value) ?? ''
  );
};

describe('processing labelmap packing', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('keeps the selected mask whole and omits conflicting masks entirely', async () => {
    const { segmentation } = await seed();
    const plan = planSegmentationInput(segmentation.id, false);
    const snapshot = captureLabelmapParts(plan.parentId, plan.parts);
    expect(snapshot.parts).toHaveLength(1);
    expect(
      namesAtVoxels(composeLabelmapPart(snapshot.parent, snapshot.parts[0]))
    ).toEqual(['Selected', 'Selected', '', 'Disjoint', '', '', '', '']);
    expect(plan.warning).toContain('Crossing');
    expect(plan.warning).toContain('Conflicting');
    expect(plan.warning).not.toContain('Selected,');
  });

  it('preserves all whole masks across multiple input files', async () => {
    const { segmentation } = await seed();
    const plan = planSegmentationInput(segmentation.id, true);
    const snapshot = captureLabelmapParts(plan.parentId, plan.parts);
    expect(snapshot.parts).toHaveLength(2);
    expect(plan.warning).toBeUndefined();
    expect(
      snapshot.parts.map((part) =>
        namesAtVoxels(composeLabelmapPart(snapshot.parent, part))
      )
    ).toEqual([
      ['Selected', 'Selected', '', 'Disjoint', '', '', '', ''],
      ['Crossing', '', 'Crossing', 'Conflicting', 'Conflicting', '', '', ''],
    ]);
  });

  it('changes which whole masks fit when selection changes', async () => {
    const { masks, segmentation } = await seed();
    useSegmentStore().segments.selectSegment(segmentOfMask(masks[1]));
    const plan = planSegmentationInput(segmentation.id, false);
    const snapshot = captureLabelmapParts(plan.parentId, plan.parts);
    expect(
      namesAtVoxels(composeLabelmapPart(snapshot.parent, snapshot.parts[0]))
    ).toEqual(['Crossing', '', 'Crossing', 'Disjoint', '', '', '', '']);
    expect(plan.warning).toContain('Selected');
  });

  it('retains captured pixels and metadata after live masks and the parent change', async () => {
    const { masks, segmentation, parent } = await seed();
    const plan = planSegmentationInput(segmentation.id, true);
    const snapshot = captureLabelmapParts(plan.parentId, plan.parts);
    useSegmentStore().segments.deleteSegment(segmentOfMask(masks[1]));
    parent.setSpacing([2, 2, 2]);
    const second = composeLabelmapPart(snapshot.parent, snapshot.parts[1]);
    expect(namesAtVoxels(second)).toEqual([
      'Crossing',
      '',
      'Crossing',
      'Conflicting',
      'Conflicting',
      '',
      '',
      '',
    ]);
    expect(second.labelmap.getSpacing()).toEqual([1, 1, 1]);
  });
});

// Alpha and Beta overlap on one image; Gamma lives on another one entirely.
const seedTwoImages = async () => {
  await seatImage('image-a', { dimensions: [8, 1, 1] });
  await seatImage('image-b', { dimensions: [8, 1, 1] });
  const alpha = addMask('image-a', 'Alpha');
  const beta = addMask('image-a', 'Beta');
  const gamma = addMask('image-b', 'Gamma');
  seedVoxel(alpha, [0, 0, 0]);
  seedVoxel(beta, [0, 0, 0]);
  seedVoxel(beta, [1, 0, 0]);
  seedVoxel(gamma, [0, 0, 0]);
  return {
    alpha,
    gamma,
    segmentation: useSegmentationStore().getSegmentationForImage('image-a')!,
  };
};

describe('single-file packing against a selection from another image', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('packs a mask this image holds and says where to select', async () => {
    const { gamma, segmentation } = await seedTwoImages();
    selectSegment(gamma);

    const plan = planSegmentationInput(segmentation.id, false);
    const snapshot = captureLabelmapParts(plan.parentId, plan.parts);

    expect(
      namesAtVoxels(composeLabelmapPart(snapshot.parent, snapshot.parts[0]))
    ).toEqual(['Alpha', '', '', '', '', '', '', '']);
    expect(plan.warning).toBe(
      'This input accepts one labelmap. Omitted whole segments: Beta.' +
        ' Select a segment on this image to prioritize it.'
    );
  });

  it('drops the advice once a segment on this image is selected', async () => {
    const { alpha, segmentation } = await seedTwoImages();
    selectSegment(alpha);

    const plan = planSegmentationInput(segmentation.id, false);

    expect(plan.warning).toBe(
      'This input accepts one labelmap. Omitted whole segments: Beta.'
    );
  });
});
