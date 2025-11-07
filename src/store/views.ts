import { defineStore } from 'pinia';
import { computed, markRaw, reactive, ref, watch } from 'vue';
import { createEventHook } from '@vueuse/core';
import type { Maybe } from '@/src/types';
import type { Layout, LayoutItem } from '@/src/types/layout';
import { useIdStore } from '@/src/store/id';
import type { ViewInfo, ViewInfoInit, ViewType } from '@/src/types/views';
import { DefaultNamedLayouts, getAvailableViews } from '@/src/config';
import {
  parseNamedLayouts,
  type LayoutConfig,
} from '@/src/utils/layoutParsing';
import type { StateFile } from '../io/state-file/schema';

const DEFAULT_VIEW_INIT: ViewInfoInit = {
  type: '2D',
  dataID: null,
  name: 'Axial',
  options: {
    orientation: 'Axial',
  },
};

function iterLayout(
  layout: Layout,
  cb: (item: LayoutItem & { type: 'slot' }) => void
) {
  layout.items.forEach((item) => {
    if (item.type === 'slot') cb(item);
    else iterLayout(item, cb);
  });
}

function calcLayoutViewCount(layout: Layout): number {
  return layout.items.reduce((sum, item) => {
    if (item.type === 'slot') return sum + 1;
    return sum + calcLayoutViewCount(item);
  }, 0);
}

function generateLayoutFromGrid(size: [number, number]): Layout {
  const [width, height] = size;
  return {
    direction: 'column',
    items: Array.from({ length: height }).map((_, rowIndex) => {
      return {
        type: 'layout',
        direction: 'row',
        items: Array.from({ length: width }).map((__, colIndex) => {
          return {
            type: 'slot',
            slotIndex: rowIndex * width + colIndex,
          };
        }),
      };
    }),
  };
}

function needsViewReplacement(existingView: ViewInfo, nextView: ViewInfoInit) {
  if (existingView.type !== nextView.type) return true;

  const existingOptions = existingView.options ?? null;
  const nextOptions = nextView.options ?? null;

  return JSON.stringify(existingOptions) !== JSON.stringify(nextOptions);
}

export const useViewStore = defineStore('view', () => {
  const idStore = useIdStore();

  // Triggers whenever a view is created with a dataID or when a view's dataset changes.
  const ViewDataChangeEvent = markRaw(
    createEventHook<[string, Maybe<string>]>()
  );

  // Triggers whenever a view in the layout is replaced.
  // [beforeViewID, afterViewID]
  const LayoutViewReplacedEvent = markRaw(createEventHook<[string, string]>());

  const parsedDefaultLayouts = parseNamedLayouts(DefaultNamedLayouts);

  const defaultNamedLayoutEntries = Object.entries(parsedDefaultLayouts);
  const firstLayout = defaultNamedLayoutEntries[0][1];
  const firstLayoutName = defaultNamedLayoutEntries[0][0];

  const layout = ref<Layout>(firstLayout.layout);
  // which assigns view IDs to layout slots
  const layoutSlots = ref<string[]>([]);
  const viewByID = reactive<Record<string, ViewInfo>>({});
  const activeView = ref<Maybe<string>>();
  const disabledViewTypes = ref<ViewType[]>([]);
  const namedLayouts =
    ref<Record<string, { layout: Layout; views: ViewInfoInit[] }>>(
      parsedDefaultLayouts
    );
  const currentLayoutName = ref<Maybe<string>>(firstLayoutName);

  const isActiveViewMaximized = ref(false);
  const maximizedView = computed(() => {
    if (activeView.value && isActiveViewMaximized.value)
      return viewByID[activeView.value];
    return undefined;
  });

  const availableViewsForSwitcher = computed(() => {
    const allViews = getAvailableViews();
    return allViews.list.filter(
      (view) => !disabledViewTypes.value.includes(view.type)
    );
  });

  const visibleViews = computed(() => {
    if (maximizedView.value) return [maximizedView.value];
    const views: ViewInfo[] = [];
    iterLayout(layout.value, (item) => {
      const viewId = layoutSlots.value[item.slotIndex];
      views.push(viewByID[viewId]);
    });
    return views;
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
    activeView.value = id;
  }

  function toggleActiveViewMaximized() {
    if (!activeView.value) return;
    isActiveViewMaximized.value = !isActiveViewMaximized.value;
  }

  function ensureActiveViewIsVisible() {
    if (!visibleViews.value.length) {
      setActiveView(null);
      return;
    }

    if (!visibleViews.value.find((view) => view.id === activeView.value)) {
      setActiveView(visibleViews.value[0].id);
    }
  }

  function addView(viewInit: ViewInfoInit) {
    const id = idStore.nextId();

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

  function replaceView(id: string, viewInfo: ViewInfoInit) {
    const slotIndex = layoutSlots.value.findIndex((viewId) => id === viewId);
    if (slotIndex === -1) throw new Error('invalid view to replace');
    const newViewId = addView(viewInfo);
    layoutSlots.value[slotIndex] = newViewId;
    LayoutViewReplacedEvent.trigger(id, newViewId);

    if (activeView.value === id) {
      setActiveView(newViewId);
    }

    delete viewByID[id];
  }

  function applyLayoutChange(
    newLayout: Layout,
    options?: {
      layoutName?: Maybe<string>;
      updateSlots?: (viewCount: number) => void;
    }
  ) {
    if (options?.layoutName !== undefined) {
      currentLayoutName.value = options.layoutName;
    }

    isActiveViewMaximized.value = false;

    if (options?.updateSlots) {
      const viewCount = calcLayoutViewCount(newLayout);
      options.updateSlots(viewCount);
    }

    layout.value = newLayout;
    ensureActiveViewIsVisible();
  }

  function setLayout(newLayout: Layout) {
    applyLayoutChange(newLayout, {
      updateSlots: (viewCount) => {
        // we don't remove non-visible views so we can preserve their state for later
        while (layoutSlots.value.length < viewCount) {
          layoutSlots.value.push(addView(DEFAULT_VIEW_INIT));
        }
      },
    });
  }

  function setLayoutFromGrid(gridSize: [number, number]) {
    currentLayoutName.value = null;
    setLayout(generateLayoutFromGrid(gridSize));
  }

  function setNamedLayoutsFromConfig(layouts: Record<string, LayoutConfig>) {
    namedLayouts.value = parseNamedLayouts(layouts);
  }

  function switchToNamedLayout(name: string) {
    const namedLayout = namedLayouts.value[name];
    if (!namedLayout) {
      throw new Error(`Named layout "${name}" not found`);
    }
    applyLayoutChange(namedLayout.layout, {
      layoutName: name,
      updateSlots: () => {
        namedLayout.views.forEach((viewInit, index) => {
          if (index < layoutSlots.value.length) {
            const existingViewId = layoutSlots.value[index];
            const existingView = viewByID[existingViewId];
            if (existingView) {
              if (needsViewReplacement(existingView, viewInit)) {
                replaceView(existingViewId, {
                  ...viewInit,
                  dataID: existingView.dataID,
                });
              } else {
                existingView.name = viewInit.name;
              }
            }
          } else {
            layoutSlots.value.push(addView(viewInit));
          }
        });
      },
    });
  }

  function setDataForView(viewID: string, dataID: Maybe<string>) {
    if (!(viewID in viewByID)) return;
    viewByID[viewID].dataID = dataID;
    ViewDataChangeEvent.trigger(viewID, dataID);
  }

  function setDataForActiveView(dataID: Maybe<string>) {
    if (!activeView.value) return;
    setDataForView(activeView.value, dataID);
  }

  function setDataForAllViews(dataID: Maybe<string>) {
    viewIDs.value.forEach((viewID) => {
      setDataForView(viewID, dataID);
    });
  }

  function removeDataFromViews(dataID: string) {
    layoutSlots.value.forEach((id) => {
      if (viewByID[id].dataID === dataID) {
        setDataForView(id, null);
      }
    });
  }

  function applyDisabledViewTypesFilter() {
    if (!disabledViewTypes.value.length) return;

    layoutSlots.value.forEach((id) => {
      const view = viewByID[id];
      if (disabledViewTypes.value.includes(view.type)) {
        const replacement = availableViewsForSwitcher.value[0];
        if (replacement) {
          replaceView(id, replacement);
        }
      }
    });
  }

  function serialize(stateFile: StateFile) {
    const { manifest } = stateFile;
    manifest.layout = layout.value;
    manifest.activeView = activeView.value;
    manifest.isActiveViewMaximized = isActiveViewMaximized.value;
    manifest.layoutSlots = layoutSlots.value;
    manifest.viewByID = viewByID;
  }

  function deserialize(
    manifest: StateFile['manifest'],
    dataIDMap: Record<string, string>
  ) {
    setLayout(manifest.layout);
    setActiveView(manifest.activeView);
    isActiveViewMaximized.value = manifest.isActiveViewMaximized;
    layoutSlots.value = manifest.layoutSlots;

    viewIDs.value.forEach((key) => {
      delete viewByID[key];
    });

    Object.entries(manifest.viewByID).forEach(([id, view]) => {
      viewByID[id] = {
        ...view,
        dataID: view.dataID ? dataIDMap[view.dataID] : null,
      } as unknown as ViewInfo;
    });
  }

  // initialization

  firstLayout.views.forEach((viewInit) => {
    layoutSlots.value.push(addView(viewInit));
  });

  watch(disabledViewTypes, () => {
    applyDisabledViewTypesFilter();
  });

  return {
    visibleLayout: computed<Layout>(() => {
      if (maximizedView.value)
        return {
          direction: 'column',
          items: [{ type: 'slot', slotIndex: 0 }],
        } satisfies Layout;
      return layout.value;
    }),
    visibleViews,
    viewIDs,
    activeView,
    viewByID,
    disabledViewTypes,
    availableViewsForSwitcher,
    namedLayouts,
    currentLayoutName,
    getView,
    getAllViews,
    getViewsForData,
    replaceView,
    setLayout,
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
    deserialize,
    ViewDataChangeEvent,
    LayoutViewReplacedEvent,
  };
});
