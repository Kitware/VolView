import { describe, it, expect, vi } from 'vitest';
import {
  computeEffectiveView,
  volume2DViewsOfImage,
} from '@/src/core/views/effectiveView';
import type {
  ViewInfo,
  ViewInfo2D,
  ViewInfo3D,
  ViewInfoOblique,
} from '@/src/types/views';

vi.mock('@/src/core/cine/isCineImage', () => ({
  isCineImage: (id: string | null | undefined) => id === 'cine-image',
  getCineImage: () => null,
}));

const view2D: ViewInfo2D = {
  id: 'v-2d',
  type: '2D',
  dataID: null,
  name: 'Axial',
  options: { orientation: 'Axial' },
};

const view3D: ViewInfo3D = {
  id: 'v-3d',
  type: '3D',
  dataID: null,
  name: 'Volume',
  options: { viewDirection: 'Posterior', viewUp: 'Superior' },
};

const viewOblique: ViewInfoOblique = {
  id: 'v-ob',
  type: 'Oblique',
  dataID: null,
  name: 'Oblique',
  options: {},
};

describe('computeEffectiveView', () => {
  it('returns empty when dataID is missing', () => {
    expect(computeEffectiveView(view2D, null).kind).toBe('empty');
    expect(computeEffectiveView(view3D, undefined).kind).toBe('empty');
  });

  it('returns volume2D for a 2D slot bound to a volume image', () => {
    const eff = computeEffectiveView(view2D, 'volume-image');
    expect(eff.kind).toBe('volume2D');
    if (eff.kind === 'volume2D') {
      expect(eff.axis).toBe('Axial');
      expect(eff.renderDataID).toBe('volume-image');
    }
  });

  it('returns volume3D for a 3D slot bound to a volume image', () => {
    const eff = computeEffectiveView(view3D, 'volume-image');
    expect(eff.kind).toBe('volume3D');
  });

  it('returns oblique for an Oblique slot bound to a volume image', () => {
    const eff = computeEffectiveView(viewOblique, 'volume-image');
    expect(eff.kind).toBe('oblique');
  });

  it('returns cine when a 2D slot is bound to a cine image', () => {
    const eff = computeEffectiveView(view2D, 'cine-image');
    expect(eff.kind).toBe('cine');
  });

  it('returns cine when a 3D slot is bound to a cine image (data wins)', () => {
    const eff = computeEffectiveView(view3D, 'cine-image');
    expect(eff.kind).toBe('cine');
  });
});

const slotFor = (id: string, orientation: string, dataID: string | null) =>
  ({
    id,
    type: '2D',
    dataID,
    name: orientation,
    options: { orientation },
  }) as ViewInfo;

describe('volume2DViewsOfImage', () => {
  it('keeps every 2D view of the image, with its axis', () => {
    const views = [
      slotFor('axial', 'Axial', 'image-1'),
      slotFor('sagittal', 'Sagittal', 'image-1'),
      slotFor('coronal', 'Coronal', 'image-1'),
    ];

    expect(volume2DViewsOfImage('image-1', views)).toEqual([
      { viewId: 'axial', axis: 'Axial' },
      { viewId: 'sagittal', axis: 'Sagittal' },
      { viewId: 'coronal', axis: 'Coronal' },
    ]);
  });

  it('keeps two views sharing an axis', () => {
    const views = [
      slotFor('axial-1', 'Axial', 'image-1'),
      slotFor('axial-2', 'Axial', 'image-1'),
    ];

    expect(volume2DViewsOfImage('image-1', views)).toEqual([
      { viewId: 'axial-1', axis: 'Axial' },
      { viewId: 'axial-2', axis: 'Axial' },
    ]);
  });

  it('drops views showing a different image', () => {
    const views = [
      slotFor('axial', 'Axial', 'image-1'),
      slotFor('sagittal', 'Sagittal', 'image-2'),
    ];

    expect(volume2DViewsOfImage('image-1', views)).toEqual([
      { viewId: 'axial', axis: 'Axial' },
    ]);
  });

  it('drops empty, 3D, oblique and cine views', () => {
    const views = [
      slotFor('empty', 'Sagittal', null),
      { ...view3D, dataID: 'image-1' },
      { ...viewOblique, dataID: 'image-1' },
      slotFor('cine', 'Coronal', 'cine-image'),
    ];

    expect(volume2DViewsOfImage('image-1', views)).toEqual([]);
  });
});
