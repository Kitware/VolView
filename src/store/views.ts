import { defineStore } from 'pinia';
import { computed, markRaw, reactive, ref, watch } from 'vue';
import { createEventHook } from '@vueuse/core';
import type { Maybe } from '@/src/types';
import type {
  Layout,
  LayoutDirection,
  LayoutTemplate,
  ViewLeaf,
} from '@/src/types/layout';
import { useIdStore } from '@/src/store/id';
import { useViewConfigStore } from '@/src/store/view-configs';
import {
  sharesSourceWindowing,
  useWindowingStore,
} from '@/src/store/view-configs/windowing';
import type { ViewInfo, ViewInfoInit, ViewType } from '@/src/types/views';
import { DefaultNamedLayouts, getAvailableViews } from '@/src/config';
import {
  parseLayoutConfig,
  parseNamedLayouts,
  type LayoutConfig,
} from '@/src/utils/layoutParsing';
import type { Manifest, StateFile } from '../io/state-file/schema';
import { onImageDeleted } from '@/src/composables/onImageDeleted';
import { declareManifestRefs } from '@/src/core/manifestRefs';
import { isRecord } from '@/src/utils';
import {
  layoutViewIds,
  mapLayoutLeaves,
  removeLayoutView,
  replaceLayoutView,
  sameLayoutShape,
  splitLayoutView,
} from '@/src/utils/layoutEditing';

const rawLayoutViewIds = (node: unknown): string[] => {
  if (!isRecord(node)) return [];
  if (typeof node.viewId === 'string') return [node.viewId];
  return Array.isArray(node.items) ? node.items.flatMap(rawLayoutViewIds) : [];
};

// The manifest references this store's remove cascade keeps clean (see the
// onImageDeleted registration below), declared for the dev-only save backstop.
declareManifestRefs('views', (manifest) => {
  const views = isRecord(manifest.viewByID) ? manifest.viewByID : {};
  return [
    ...Object.entries(views).flatMap(([id, raw]) =>
      isRecord(raw) && typeof raw.dataID === 'string'
        ? [
            {
              kind: 'dataset' as const,
              id: raw.dataID,
              where: `viewByID[${id}].dataID`,
            },
          ]
        : []
    ),
    ...(typeof manifest.activeView === 'string'
      ? [
          {
            kind: 'view' as const,
            id: manifest.activeView,
            where: 'activeView',
          },
        ]
      : []),
    ...rawLayoutViewIds(manifest.layout).map((id) => ({
      kind: 'view' as const,
      id,
      where: 'layout',
    })),
  ];
});

const viewLeaf = (viewId: string): ViewLeaf => ({ type: 'view', viewId });

// Each saved view fills exactly one pane, and a layout shows at least one.
export const isRestorableLayout = (
  layout: Layout | undefined,
  saved: Record<string, unknown>
): layout is Layout => {
  const ids = layout ? layoutViewIds(layout) : [];
  return (
    ids.length > 0 &&
    new Set(ids).size === ids.length &&
    ids.every((id) => Object.hasOwn(saved, id))
  );
};

const cloneViewInit = (init: ViewInfoInit) =>
  JSON.parse(JSON.stringify(init)) as ViewInfoInit;

function needsViewReplacement(existingView: ViewInfo, nextView: ViewInfoInit) {
  if (existingView.type !== nextView.type) return true;

  const existingOptions = existingView.options ?? null;
  const nextOptions = nextView.options ?? null;

  return JSON.stringify(existingOptions) !== JSON.stringify(nextOptions);
}

export const useViewStore = defineStore('view', () => {
  const idStore = useIdStore();

  // Triggers whenever a view is created with a dataID or when a view's dataset changes.
  const ViewDataChangeEvent =
    markRaw(createEventHook<[string, Maybe<string>]>());

  // Triggers whenever a view in the layout is replaced.
  // [beforeViewID, afterViewID]
  const LayoutViewReplacedEvent = markRaw(createEventHook<[string, string]>());

  const parsedDefaultLayouts = parseNamedLayouts(DefaultNamedLayouts);
  const firstLayout = Object.values(parsedDefaultLayouts)[0];

  // Every view in viewByID is a leaf of this tree; dropping a leaf deletes its view.
  const layout = ref<Layout>({ direction: 'column', items: [] });
  const viewByID = reactive<Record<string, ViewInfo>>({});
  const activeView = ref<Maybe<string>>();
  const disabledViewTypes = ref<ViewType[]>([]);
  const namedLayouts = ref(parsedDefaultLayouts);

  const matchesTemplate = (template: LayoutTemplate) =>
    sameLayoutShape(
      template,
      layout.value,
      ({ view: init }, { viewId }: ViewLeaf) => {
        const view = viewByID[viewId];
        return !!view && !needsViewReplacement(view, init);
      }
    );

  // A named layout is current when switching to it would only rename views.
  const currentLayoutName = computed(
    () =>
      Object.entries(namedLayouts.value).find(([, template]) =>
        matchesTemplate(template)
      )?.[0]
  );

  const isActiveViewMaximized = ref(false);

  const availableViewsForSwitcher = computed(() => {
    const allViews = getAvailableViews();
    return allViews.list.filter(
      (view) => !disabledViewTypes.value.includes(view.type)
    );
  });

  // Every view in the layout, whether or not maximizing hides it.
  const layoutViews = computed(() =>
    layoutViewIds(layout.value).flatMap((id) =>
      viewByID[id] ? [viewByID[id]] : []
    )
  );

  // A lone view has nothing to hide, so it never counts as maximized.
  const maximizedView = computed(() => {
    if (
      activeView.value &&
      isActiveViewMaximized.value &&
      layoutViews.value.length > 1
    )
      return viewByID[activeView.value];
    return undefined;
  });

  const visibleViews = computed(() => {
    if (maximizedView.value) return [maximizedView.value];
    return layoutViews.value;
  });

  const viewIDs = computed(() => Object.keys(viewByID));

  function getView(id: Maybe<string>) {
    if (!id) return null;
    return viewByID[id] ?? null;
  }

  function getAllViews() {
    return Object.values(viewByID);
  }

  function getViewsForData(dataID: Maybe<string>) {
    if (!dataID) return [];
    return getAllViews().filter((view) => {
      return view.dataID === dataID;
    });
  }

  function setActiveView(id: Maybe<string>) {
    if (activeView.value === id) return;
    activeView.value = id;
  }

  function toggleActiveViewMaximized() {
    if (!activeView.value) return;
    isActiveViewMaximized.value = !isActiveViewMaximized.value;
  }

  function ensureActiveViewIsVisible() {
    const views = visibleViews.value;
    if (!views.length) {
      setActiveView(null);
      return;
    }

    if (!views.find((view) => view.id === activeView.value)) {
      setActiveView(views[0].id);
    }
  }

  function addView(viewInit: ViewInfoInit) {
    let id = idStore.nextId();
    // Restored views retain their saved IDs without advancing the ID generator.
    while (id in viewByID) id = idStore.nextId();

    const view = {
      id,
      ...viewInit,
    } satisfies ViewInfo;

    viewByID[view.id] = view;
    if (view.dataID) {
      ViewDataChangeEvent.trigger(view.id, view.dataID);
    }

    return id;
  }

  function deleteView(id: string) {
    useViewConfigStore().removeView(id);
    delete viewByID[id];
  }

  // Keeps only views the layout shows.
  function commitLayout(nextLayout: Layout) {
    const kept = new Set(layoutViewIds(nextLayout));
    isActiveViewMaximized.value = false;
    layout.value = nextLayout;
    viewIDs.value.filter((id) => !kept.has(id)).forEach(deleteView);
    ensureActiveViewIsVisible();
  }

  const isInLayout = (id: string) => layoutViewIds(layout.value).includes(id);

  function replaceView(id: string, viewInfo: ViewInfoInit) {
    if (!isInLayout(id)) throw new Error('invalid view to replace');
    const newViewId = addView(viewInfo);
    layout.value = replaceLayoutView(layout.value, id, newViewId);
    LayoutViewReplacedEvent.trigger(id, newViewId);
    if (activeView.value === id) {
      setActiveView(newViewId);
    }
    deleteView(id);
  }

  function splitView(id: string, direction: LayoutDirection) {
    const view = getView(id);
    if (!view || !isInLayout(id)) return undefined;

    const newID = addView(
      cloneViewInit({
        name: view.name,
        type: view.type,
        dataID: view.dataID,
        options: view.options,
      } as ViewInfoInit)
    );
    useViewConfigStore().copyView(id, newID);
    commitLayout(splitLayoutView(layout.value, id, newID, direction));
    return newID;
  }

  // Accepts only a layout that differs in shares, so no view comes or goes.
  function resizeLayout(nextLayout: Layout) {
    if (
      !sameLayoutShape(
        nextLayout,
        layout.value,
        (next: ViewLeaf, current: ViewLeaf) => next.viewId === current.viewId
      )
    )
      return;
    layout.value = nextLayout;
  }

  function closeView(id: string) {
    if (layoutViews.value.length <= 1 || !isInLayout(id)) return false;
    commitLayout(removeLayoutView(layout.value, id));
    if (viewByID[id]) deleteView(id);
    return true;
  }

  const activeImage = () =>
    getView(activeView.value)?.dataID ??
    layoutViews.value.find((view) => view.dataID)?.dataID ??
    null;

  // Picking a layout starts over with the template's views, all showing the
  // active image.
  function applyTemplate(template: LayoutTemplate) {
    const dataID = activeImage();
    // Window/level follows each image across views, so new views keep it.
    const windowed = layoutViews.value.filter(sharesSourceWindowing);
    commitLayout(
      mapLayoutLeaves(template, ({ view: init }) => {
        const id = addView({ ...cloneViewInit(init), dataID });
        if (sharesSourceWindowing(viewByID[id]))
          windowed.forEach((source) =>
            Object.entries(
              useWindowingStore().configs[source.id] ?? {}
            ).forEach(([data, config]) =>
              useWindowingStore().updateConfig(id, data, config)
            )
          );
        return viewLeaf(id);
      })
    );
  }

  function setLayoutFromGrid(gridSize: [number, number]) {
    applyTemplate(parseLayoutConfig({ gridSize }));
  }

  function setNamedLayoutsFromConfig(layouts: Record<string, LayoutConfig>) {
    namedLayouts.value = parseNamedLayouts(layouts);
  }

  function switchToNamedLayout(name: string) {
    const template = namedLayouts.value[name];
    if (!template) {
      throw new Error(`Named layout "${name}" not found`);
    }
    applyTemplate(template);
  }

  function setDataForView(
    viewID: string,
    dataID: Maybe<string>,
    options?: { activateView?: boolean }
  ) {
    const view = viewByID[viewID];
    if (!view) return;

    view.dataID = dataID;
    ViewDataChangeEvent.trigger(viewID, dataID);
    // If activeView is null/stale, fall back to a visible view so global
    // tools (which resolve their image through activeView) have one to read.
    if (options?.activateView !== false) ensureActiveViewIsVisible();
  }

  function setDataForActiveView(dataID: Maybe<string>) {
    if (!activeView.value) return;
    setDataForView(activeView.value, dataID);
  }

  function setDataForAllViews(
    dataID: Maybe<string>,
    selectedViewID?: Maybe<string>
  ) {
    viewIDs.value.forEach((viewID) => {
      setDataForView(viewID, dataID, { activateView: false });
    });
    if (visibleViews.value.some(({ id }) => id === selectedViewID))
      setActiveView(selectedViewID);
    ensureActiveViewIsVisible();
  }

  function removeDataFromViews(dataID: string) {
    getViewsForData(dataID).forEach((view) => setDataForView(view.id, null));
  }

  function applyDisabledViewTypesFilter() {
    if (!disabledViewTypes.value.length) return;

    [...layoutViews.value].forEach((view) => {
      if (disabledViewTypes.value.includes(view.type)) {
        const replacement = availableViewsForSwitcher.value[0];
        if (replacement) {
          replaceView(view.id, replacement);
        }
      }
    });
  }

  function serialize(stateFile: StateFile) {
    const { manifest } = stateFile;
    manifest.layout = layout.value;
    manifest.activeView = activeView.value;
    manifest.isActiveViewMaximized = isActiveViewMaximized.value;
    manifest.viewByID = Object.fromEntries(
      layoutViews.value.map((view) => [view.id, view])
    );
  }

  function deserializeLayout(manifest: Manifest) {
    // No old view is current while the incoming layout replaces its contents.
    setActiveView(undefined);
    const saved = manifest.viewByID ?? {};
    if (isRestorableLayout(manifest.layout, saved)) {
      viewIDs.value.forEach(deleteView);
      layoutViewIds(manifest.layout).forEach((id) => {
        viewByID[id] = { ...saved[id], dataID: null } as unknown as ViewInfo;
      });
      isActiveViewMaximized.value = false;
      layout.value = manifest.layout;
    }
    // A saved active view the layout no longer shows cannot stay maximized.
    const hidden = !!manifest.activeView && !isInLayout(manifest.activeView);
    isActiveViewMaximized.value = !hidden && !!manifest.isActiveViewMaximized;
    // Reused views acquire their saved selection after their data is rebound.
    if (manifest.viewByID)
      setActiveView(hidden ? undefined : manifest.activeView);
  }

  function bindViewsToData(
    stateID: string,
    storeID: string,
    manifest: Manifest
  ) {
    if (!manifest.viewByID) return;

    Object.entries(manifest.viewByID).forEach(([id, view]) => {
      if (view.dataID === stateID && viewByID[id]) {
        setDataForView(id, storeID);
      }
    });
  }

  // initialization

  applyTemplate(firstLayout);

  watch(disabledViewTypes, () => {
    applyDisabledViewTypesFilter();
  });

  onImageDeleted((deletedIDs) => {
    deletedIDs.forEach((id) => removeDataFromViews(id));
  });

  return {
    visibleLayout: computed(() => {
      if (maximizedView.value)
        return {
          direction: 'column',
          items: [viewLeaf(maximizedView.value.id)],
        } satisfies Layout;
      return layout.value;
    }),
    visibleViews,
    maximizedView,
    layoutViews,
    viewIDs,
    activeView,
    viewByID,
    disabledViewTypes,
    availableViewsForSwitcher,
    namedLayouts,
    currentLayoutName,
    getView,
    splitView,
    closeView,
    resizeLayout,
    getAllViews,
    getViewsForData,
    replaceView,
    setLayoutFromGrid,
    setNamedLayoutsFromConfig,
    switchToNamedLayout,
    setActiveView,
    setDataForView,
    setDataForActiveView,
    setDataForAllViews,
    removeDataFromViews,
    toggleActiveViewMaximized,
    serialize,
    deserializeLayout,
    bindViewsToData,
    ViewDataChangeEvent,
    LayoutViewReplacedEvent,
  };
});
