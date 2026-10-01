import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSyncWindowing } from '@/src/composables/useSyncWindowing';
import { useViewStore } from '@/src/store/views';
import { useWindowingStore } from '@/src/store/view-configs/windowing';

beforeEach(() => setActivePinia(createPinia()));

function setup() {
  const views = useViewStore();
  const windowing = useWindowingStore();
  views.setDataForAllViews('oct');
  const raw = views.layoutViews.find((view) => view.type === '2D')!;
  const rawPeer = views.layoutViews.find(
    (view) => view.type === '2D' && view.id !== raw.id
  )!;
  const volume = views.layoutViews.find((view) => view.type === '3D')!;
  views.replaceView(volume.id, {
    type: 'EnFace',
    name: 'En face',
    dataID: 'oct',
    options: {},
  });
  const projected = views.layoutViews.find((view) => view.type === 'EnFace')!;
  windowing.updateConfig(raw.id, 'oct', { width: 58899, level: 29983.5 }, true);
  windowing.updateConfig(
    projected.id,
    'oct',
    { width: 2179, level: 17080 },
    true
  );
  useSyncWindowing();
  return { views, windowing, raw, rawPeer, projected };
}

describe('raw and projected windowing domains', () => {
  it('synchronizes raw views without overwriting a projection window', () => {
    const { windowing, raw, rawPeer, projected } = setup();
    windowing.updateConfig(raw.id, 'oct', { width: 30000, level: 20000 }, true);
    expect(windowing.getConfig(rawPeer.id, 'oct')).toMatchObject({
      width: 30000,
      level: 20000,
    });
    expect(windowing.getConfig(projected.id, 'oct')).toMatchObject({
      width: 2179,
      level: 17080,
    });
  });

  it('keeps B-scans and differently scaled projections unchanged by projection edits', () => {
    const { views, windowing, raw, projected } = setup();
    const slot = views.layoutViews.find(
      (view) => view.type === '2D' && view.id !== raw.id
    )!;
    views.replaceView(slot.id, {
      type: 'EnFace',
      name: 'Sum projection',
      dataID: 'oct',
      options: {},
    });
    const sum = views.layoutViews.find(
      (view) => view.name === 'Sum projection'
    )!.id;
    windowing.updateConfig(sum, 'oct', { width: 483738, level: 3791760 }, true);
    windowing.updateConfig(
      projected.id,
      'oct',
      { width: 1000, level: 16000 },
      true
    );
    expect(windowing.getConfig(raw.id, 'oct')).toMatchObject({
      width: 58899,
      level: 29983.5,
    });
    expect(windowing.getConfig(sum, 'oct')).toMatchObject({
      width: 483738,
      level: 3791760,
    });
  });

  it('does not copy manually adjusted raw contrast when switching to En face', () => {
    const { views, windowing, raw } = setup();
    views.replaceView(raw.id, {
      type: 'EnFace',
      name: 'New projection',
      dataID: 'oct',
      options: {},
    });
    const projection = views.layoutViews.find(
      (view) => view.name === 'New projection'
    )!;
    expect(windowing.getConfig(projection.id, 'oct').userTriggered).toBe(false);
    expect(windowing.getConfig(projection.id, 'oct').width).not.toBe(58899);
  });

  it('uses raw peer contrast when replacing En face with a slice view', () => {
    const { views, windowing, raw, projected } = setup();
    windowing.updateConfig(raw.id, 'oct', { width: 30000, level: 20000 }, true);
    views.replaceView(projected.id, {
      type: '2D',
      name: 'Restored slice',
      dataID: 'oct',
      options: { orientation: 'Axial' },
    });
    const restored = views.layoutViews.find(
      (view) => view.name === 'Restored slice'
    )!;
    expect(windowing.getConfig(restored.id, 'oct')).toMatchObject({
      width: 30000,
      level: 20000,
    });
  });
});
