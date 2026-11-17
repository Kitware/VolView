import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSegmentStore } from '@/src/segmentation/segments';
import { useSegmentationStore } from '@/src/segmentation/store';
import { planSegmentationInput } from '@/src/processing/segmentationInput';
import {
  captureLabelmapParts,
  composeLabelmapPart,
} from '@/src/segmentation/io/composition';
import {
  addSegment,
  seatImage,
  seedVoxel,
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
    const id = addSegment('packing-parent', name);
    xs.forEach((x) => seedVoxel(id, [x, 0, 0]));
    return id;
  });
  useSegmentStore().segments.selectSegment(masks[0]);
  return { parent, masks, imageId: 'packing-parent' };
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
    const { imageId } = await seed();
    const plan = planSegmentationInput(imageId, false);
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
    const { imageId } = await seed();
    const plan = planSegmentationInput(imageId, true);
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
    const { masks, imageId } = await seed();
    useSegmentStore().segments.selectSegment(masks[1]);
    const plan = planSegmentationInput(imageId, false);
    const snapshot = captureLabelmapParts(plan.parentId, plan.parts);
    expect(
      namesAtVoxels(composeLabelmapPart(snapshot.parent, snapshot.parts[0]))
    ).toEqual(['Crossing', '', 'Crossing', 'Disjoint', '', '', '', '']);
    expect(plan.warning).toContain('Selected');
  });

  it('retains captured pixels and metadata after live masks and the parent change', async () => {
    const { masks, imageId, parent } = await seed();
    const plan = planSegmentationInput(imageId, true);
    useSegmentStore().segments.updateSegment(masks[1], {
      color: [1, 2, 3, 255],
    });
    const snapshot = captureLabelmapParts(plan.parentId, plan.parts);
    const segmentId = masks[1];
    useSegmentStore().segments.updateSegment(segmentId, {
      name: 'Changed',
      color: [10, 20, 30, 255],
    });
    useSegmentationStore().maskVoxels(masks[1]).scalars().fill(0);
    useSegmentStore().segments.deleteSegment(segmentId);
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
    expect(second.segments[0]).toMatchObject({
      name: 'Crossing',
      color: [1, 2, 3, 255],
    });
    expect(second.labelmap.getSpacing()).toEqual([1, 1, 1]);
  });
});

// Alpha and Beta overlap on one image; Gamma lives on another one entirely.
const seedTwoImages = async () => {
  await seatImage('image-a', { dimensions: [8, 1, 1] });
  await seatImage('image-b', { dimensions: [8, 1, 1] });
  const alpha = addSegment('image-a', 'Alpha');
  const beta = addSegment('image-a', 'Beta');
  const gamma = addSegment('image-b', 'Gamma');
  seedVoxel(alpha, [0, 0, 0]);
  seedVoxel(beta, [0, 0, 0]);
  seedVoxel(beta, [1, 0, 0]);
  seedVoxel(gamma, [0, 0, 0]);
  return {
    alpha,
    gamma,
    imageId: 'image-a',
  };
};

describe('single-file packing with image-scoped selection', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('keeps this image’s preferred mask when another image’s segment is selected', async () => {
    const { gamma, imageId } = await seedTwoImages();
    selectSegment(gamma);

    const plan = planSegmentationInput(imageId, false);
    const snapshot = captureLabelmapParts(plan.parentId, plan.parts);

    expect(
      namesAtVoxels(composeLabelmapPart(snapshot.parent, snapshot.parts[0]))
    ).toEqual(['Alpha', '', '', '', '', '', '', '']);
    expect(plan.warning).toBe(
      'This input accepts one labelmap. Omitted whole segments: Beta.'
    );
  });

  it('names an omitted unnamed segment the way the lists do', async () => {
    const { alpha, imageId } = await seedTwoImages();
    seedVoxel(addSegment('image-a', ''), [0, 0, 0]);
    selectSegment(alpha);

    const plan = planSegmentationInput(imageId, false);

    expect(plan.warning).toBe(
      'This input accepts one labelmap. Omitted whole segments: Beta, (no name).'
    );
  });

  it('drops the advice once a segment on this image is selected', async () => {
    const { alpha, imageId } = await seedTwoImages();
    selectSegment(alpha);

    const plan = planSegmentationInput(imageId, false);

    expect(plan.warning).toBe(
      'This input accepts one labelmap. Omitted whole segments: Beta.'
    );
  });
});
