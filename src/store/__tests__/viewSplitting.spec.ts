import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import JSZip from 'jszip';
import { useViewStore } from '@/src/store/views';
import { useIdStore } from '@/src/store/id';
import {
  getLayoutDividers,
  getLayoutPanes,
  moveLayoutDividers,
} from '@/src/utils/layoutEditing';
import { ManifestSchema, type StateFile } from '@/src/io/state-file/schema';

const snapshot = (store: ReturnType<typeof useViewStore>) => {
  const state: StateFile = {
    zip: new JSZip(),
    manifest: { version: '9.0.0', dataSources: [] },
  };
  store.serialize(state);
  return ManifestSchema.parse(JSON.parse(JSON.stringify(state.manifest)));
};

const ids = (store: ReturnType<typeof useViewStore>) =>
  store.layoutViews.map((view) => view.id);

describe('Splitting layout views', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it.each(['row', 'column'] as const)(
    'splits only the chosen area along %s',
    (direction) => {
      const store = useViewStore();
      store.setLayoutFromGrid([2, 1]);
      const [left, right] = store.layoutViews;
      store.setDataForView(right.id, 'image');
      const before = getLayoutPanes(store.visibleLayout);
      const newID = store.splitView(right.id, direction)!;
      const panes = getLayoutPanes(store.visibleLayout);
      expect(ids(store)).toEqual([left.id, right.id, newID]);
      expect(panes.map((pane) => pane.viewId)).toEqual(ids(store));
      expect(panes[0]).toEqual(before[0]);
      if (direction === 'row')
        expect(panes.map(({ width }) => width)).toEqual([50, 25, 25]);
      expect(store.getView(newID)).toEqual({ ...right, id: newID });
      expect(store.getView(newID)?.options).not.toBe(right.options);
      expect(store.activeView).toBe(left.id);
      expect(store.currentLayoutName).toBeUndefined();
      if (direction === 'column')
        expect(
          panes[1].width * panes[1].height + panes[2].width * panes[2].height
        ).toBe(5000);
    }
  );

  it('splits along the parent direction as a sibling', () => {
    const store = useViewStore();
    store.setLayoutFromGrid([2, 1]);
    const [left, right] = ids(store);
    const middle = store.splitView(left, 'row')!;
    expect(store.visibleLayout).toEqual({
      direction: 'row',
      items: [left, middle, right].map((viewId) => ({ type: 'view', viewId })),
      sizes: [0.25, 0.25, 0.5],
    });
  });

  it('closes views without leaving hidden views behind', () => {
    const store = useViewStore();
    store.setLayoutFromGrid([2, 1]);
    const [left, right] = ids(store);
    const middle = store.splitView(right, 'column')!;
    const last = store.splitView(middle, 'row')!;
    store.setActiveView(middle);
    expect(store.closeView(middle)).toBe(true);
    expect(store.activeView).toBe(left);
    expect(store.getView(middle)).toBeNull();
    expect(ids(store)).toEqual([left, right, last]);
    const panes = getLayoutPanes(store.visibleLayout);
    expect(panes.map((pane) => pane.viewId)).toEqual([left, right, last]);
    expect(panes[2]).toMatchObject({
      left: 50,
      top: 50,
      width: 50,
      height: 50,
    });
    expect(Object.keys(snapshot(store).viewByID!)).toEqual([left, right, last]);
  });

  it('expands a maximized view before splitting and retains all peers', () => {
    const store = useViewStore();
    const source = store.layoutViews[1];
    store.setActiveView(source.id);
    store.toggleActiveViewMaximized();
    expect(store.visibleViews).toHaveLength(1);
    const id = store.splitView(source.id, 'column')!;
    expect(store.visibleViews).toHaveLength(5);
    expect(store.activeView).toBe(source.id);
    expect(store.visibleViews.map((view) => view.id)).toContain(id);
  });

  it('does not close the last view or split missing views', () => {
    const store = useViewStore();
    const dropped = store.layoutViews[1].id;
    store.setLayoutFromGrid([1, 1]);
    const before = snapshot(store);
    expect(ids(store)).toHaveLength(1);
    expect(store.closeView(store.layoutViews[0].id)).toBe(false);
    expect(store.closeView(dropped)).toBe(false);
    expect(store.splitView(dropped, 'row')).toBeUndefined();
    expect(snapshot(store)).toEqual(before);
  });

  it('starts a picked named layout over from its template', () => {
    const store = useViewStore();
    store.setDataForAllViews('image');
    const before = ids(store);
    store.splitView(before[0], 'row');
    store.switchToNamedLayout('Four Up');
    expect(store.currentLayoutName).toBe('Four Up');
    expect(store.viewIDs).toEqual(ids(store));
    expect(store.layoutViews.map(({ name, dataID }) => [name, dataID])).toEqual(
      ['Axial', 'Coronal', 'Sagittal', 'Volume'].map((name) => [name, 'image'])
    );
    before.forEach((id) => expect(store.getView(id)).toBeNull());
  });

  it('keeps the view count equal to the panes across layout cycles', () => {
    const store = useViewStore();
    for (let round = 0; round < 3; round += 1) {
      store.splitView(ids(store)[0], 'row');
      store.switchToNamedLayout('Axial Only');
      store.switchToNamedLayout('Four Up');
      store.closeView(ids(store)[1]);
      store.setLayoutFromGrid([2, 2]);
      expect(store.viewIDs).toEqual(expect.arrayContaining(ids(store)));
    }
    expect(ids(store)).toHaveLength(4);
  });

  it('restores a custom layout and can split without replacing restored IDs', () => {
    const store = useViewStore();
    const id = store.splitView(store.layoutViews[0].id, 'row')!;
    store.splitView(id, 'column');
    const manifest = snapshot(store);
    setActivePinia(createPinia());
    const restored = useViewStore();
    restored.deserializeLayout(manifest);
    useIdStore().reset();
    expect(restored.visibleLayout).toEqual(manifest.layout);
    const source = restored.layoutViews[0];
    const originalIDs = [...restored.viewIDs];
    const newID = restored.splitView(source.id, 'column')!;
    expect(originalIDs).not.toContain(newID);
    expect(restored.viewIDs).toHaveLength(originalIDs.length + 1);
    expect(restored.getView(source.id)).toMatchObject(source);
    expect(restored.layoutViews).toHaveLength(7);
  });

  it('clears image bindings from split views without changing layout', () => {
    const store = useViewStore();
    store.setDataForAllViews('image');
    const newID = store.splitView(store.layoutViews[0].id, 'row')!;
    const before = snapshot(store).layout;
    store.removeDataFromViews('image');
    expect(store.getAllViews().every((view) => view.dataID === null)).toBe(
      true
    );
    expect(snapshot(store).layout).toEqual(before);
    store.setDataForView(newID, 'next-image');
    store.replaceView(newID, {
      name: 'Volume',
      type: '3D',
      dataID: 'next-image',
      options: { viewDirection: 'Posterior', viewUp: 'Superior' },
    });
    expect(store.getView(newID)).toBeNull();
    expect(store.layoutViews).toHaveLength(5);
    expect(store.layoutViews[1]).toMatchObject({
      type: '3D',
      dataID: 'next-image',
    });
  });

  it('keeps resized shares through save and load, and resets them on a named pick', () => {
    const store = useViewStore();
    const container = { width: 1000, height: 1000 };
    const [across, upper] = getLayoutDividers(store.visibleLayout);
    const resized = moveLayoutDividers(
      moveLayoutDividers(store.visibleLayout, [across], 30, container),
      [upper],
      70,
      container
    );
    store.resizeLayout(resized);
    expect(store.visibleLayout).toEqual(resized);
    expect(store.currentLayoutName).toBe('Four Up');

    const manifest = snapshot(store);
    setActivePinia(createPinia());
    const restored = useViewStore();
    restored.deserializeLayout(manifest);
    expect(getLayoutPanes(restored.visibleLayout)).toEqual(
      getLayoutPanes(resized)
    );
    expect(
      getLayoutPanes(restored.visibleLayout).map(({ width }) =>
        Math.round(width)
      )
    ).toEqual([70, 30, 50, 50]);

    restored.switchToNamedLayout('Four Up');
    expect(
      getLayoutPanes(restored.visibleLayout).map(({ height }) => height)
    ).toEqual([50, 50, 50, 50]);
  });

  it('ignores a resize that changes which views the layout shows', () => {
    const store = useViewStore();
    const before = store.visibleLayout;
    store.resizeLayout({
      direction: 'row',
      items: [{ type: 'view', viewId: store.layoutViews[0].id }],
    });
    expect(store.visibleLayout).toBe(before);
  });

  it('keeps the active image shown through named layout picks', () => {
    const store = useViewStore();
    store.setDataForAllViews('other');
    const [axial] = ids(store);
    store.setDataForView(axial, 'active');
    store.setActiveView(axial);

    store.switchToNamedLayout('3D Only');
    expect(store.layoutViews.map((view) => view.dataID)).toEqual(['active']);
    store.switchToNamedLayout('Four Up');
    expect(store.getView(store.activeView)?.dataID).toBe('active');
    expect(store.layoutViews.map((view) => view.dataID)).toContain('active');
  });

  const savedView = (id: string) => ({
    id,
    type: '2D' as const,
    dataID: null,
    name: 'Axial',
    options: { orientation: 'Axial' as const },
  });
  const leaf = (viewId: string) => ({ type: 'view' as const, viewId });

  it('restores a maximized view only when the layout shows it', () => {
    const store = useViewStore();
    const restore = (activeView: string) =>
      store.deserializeLayout({
        version: '9.0.0',
        dataSources: [],
        activeView,
        isActiveViewMaximized: true,
        layout: { direction: 'row', items: [leaf('a'), leaf('b')] },
        viewByID: { a: savedView('a'), b: savedView('b') },
      });
    restore('missing');
    expect(store.activeView).toBeUndefined();
    expect(store.visibleViews.map(({ id }) => id)).toEqual(['a', 'b']);
    restore('b');
    expect(store.visibleViews.map(({ id }) => id)).toEqual(['b']);
  });

  it('keeps the current layout when a saved layout repeats, omits or names unsaved views', () => {
    const store = useViewStore();
    const before = ids(store);
    const viewByID = { a: savedView('a'), b: savedView('b') };
    [[leaf('a'), leaf('a')], [], [leaf('a'), leaf('missing')]].forEach(
      (items) => {
        store.deserializeLayout({
          version: '9.0.0',
          dataSources: [],
          layout: { direction: 'row', items },
          viewByID,
        });
        expect(ids(store)).toEqual(before);
      }
    );
  });
});
