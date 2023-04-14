import { computed, ref } from 'vue';
import { Vector3 } from '@kitware/vtk.js/types';
import { distance2BetweenPoints } from '@kitware/vtk.js/Common/Core/Math';
import { removeFromArray } from '@/src/utils';
import { RulerStateUpdate } from '@/src/core/tools/ruler';
import { TOOL_COLORS } from '@/src/config';
import { defineStore } from 'pinia';
import { InteractionState } from '@/src/vtk/RulerWidget/state';
import { useViewConfigStore } from '@/src/store/view-configs';
import { createPlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { LPSAxisDir } from '@/src/types/lps';
import { Ruler } from './types';
import { useViewStore } from '../views';
import { findImageID, getDataID } from '../datasets';

const emptyRuler = (): Ruler => ({
  name: '',
  firstPoint: null,
  secondPoint: null,
  viewAxis: null,
  slice: null,
  imageID: '',
  interactionState: InteractionState.PlacingFirst,
  color: TOOL_COLORS[0],
});

export type RulerPatch = Partial<Ruler> & RulerStateUpdate;

export const useRulerStore = defineStore('ruler', () => {
  type _This = ReturnType<typeof useRulerStore>;

  // --- state --- //

  const rulerIDs = ref<string[]>([]);
  const rulers = ref<Record<string, Ruler>>(Object.create(null));
  const activeRulerID = ref<string | null>(null);

  let colorIndex = 0;

  // --- getters --- //

  const lengthByID = computed(() => {
    const rulersIndex = rulers.value;
    return rulerIDs.value.reduce((lengths, id) => {
      const { firstPoint, secondPoint } = rulersIndex[id];
      return Object.assign(lengths, {
        [id]:
          firstPoint && secondPoint
            ? Math.sqrt(distance2BetweenPoints(firstPoint, secondPoint))
            : 0,
      });
    }, {} as Record<string, number>);
  });

  function getVTKFactory(this: _This, id: string) {
    return this.$rulers.getFactory(id);
  }

  // --- actions --- //

  function deactivateRuler(rulerID: string) {
    if (rulerID in rulers.value) {
      activeRulerID.value = null;
    }
  }

  function activateRuler(rulerID: string) {
    if (activeRulerID.value) {
      deactivateRuler(activeRulerID.value);
    }
    if (rulerID in rulers.value) {
      activeRulerID.value = rulerID;
    }
  }

  function updateRulerInternal(this: _This, id: string, patch: Partial<Ruler>) {
    if (id in rulers.value) {
      const ruler = rulers.value[id];
      Object.assign(ruler, patch);

      if (
        id === activeRulerID.value &&
        ruler.interactionState === InteractionState.Settled
      ) {
        deactivateRuler(id);
      }
    }
  }

  function updateRuler(this: _This, id: string, patch: Partial<Ruler>) {
    updateRulerInternal.call(this, id, patch);
    if (id in rulers.value) {
      const ruler = rulers.value[id];
      const update: RulerStateUpdate = {
        firstPoint: ruler.firstPoint,
        secondPoint: ruler.secondPoint,
        interactionState: ruler.interactionState,
      };
      this.$rulers.updateRuler(id, update);
    }
  }

  function addNewRuler(this: _This, rulerState: Partial<Ruler>) {
    const id = this.$id.nextID();

    rulers.value[id] = emptyRuler();
    rulerIDs.value.push(id);

    this.$rulers.createRuler(id);

    const patch = { ...rulerState };
    // set color if necessary
    if (!('color' in patch)) {
      patch.color = TOOL_COLORS[colorIndex];
      colorIndex = (colorIndex + 1) % TOOL_COLORS.length;
    }

    updateRuler.call(this, id, patch);

    return id;
  }

  function removeRuler(this: _This, id: string) {
    deactivateRuler(id);
    removeFromArray(rulerIDs.value, id);
    delete rulers.value[id];
    this.$rulers.removeRuler(id);
  }

  function removeActiveRuler(this: _This) {
    if (activeRulerID.value) {
      removeRuler.call(this, activeRulerID.value);
    }
  }

  function addNewRulerFromViewEvent(
    this: _This,
    eventData: any,
    viewID: string
  ) {
    if (activeRulerID.value) {
      return;
    }

    const viewConfigStore = useViewConfigStore();
    const currentImage = useCurrentImage();

    const imageID = currentImage.currentImageID.value;
    const imageMetadata = currentImage.currentImageMetadata.value;

    if (!imageID) {
      return;
    }

    const sliceConfig = viewConfigStore.getSliceConfig(viewID, imageID);
    if (!sliceConfig) {
      return;
    }

    const { slice, axisDirection: viewDirection } = sliceConfig;
    const viewAxis = getLPSAxisFromDir(viewDirection);

    const viewProxy = this.$proxies.getView(viewID);
    if (!viewProxy) {
      return;
    }

    const id = addNewRuler.call(this, {
      name: 'Ruler',
      imageID,
    });
    const manipulator = createPlaneManipulatorFor2DView(
      viewDirection,
      slice,
      imageMetadata
    );
    const coords = manipulator.handleEvent(
      eventData,
      viewProxy.getOpenGLRenderWindow()
    );
    if (coords.length) {
      updateRuler.call(this, id, {
        firstPoint: coords as Vector3,
        slice,
        imageID,
        viewAxis,
        interactionState: InteractionState.PlacingSecond,
      });
    }

    activateRuler(id);
  }

  function jumpToRuler(rulerID: string) {
    const ruler = rulers.value[rulerID];
    if (!ruler?.viewAxis || ruler?.slice == null) return;

    const { currentImageID } = useCurrentImage();
    const imageID = currentImageID.value;
    if (!imageID || ruler.imageID !== imageID) return;

    const viewStore = useViewStore();
    const relevantViewIDs = viewStore.viewIDs.filter((viewID) => {
      const viewSpec = viewStore.viewSpecs[viewID];
      const viewDir = viewSpec.props.viewDirection as LPSAxisDir | undefined;
      return viewDir && getLPSAxisFromDir(viewDir) === ruler.viewAxis;
    });

    const viewConfigStore = useViewConfigStore();
    relevantViewIDs.forEach((viewID) => {
      viewConfigStore.updateSliceConfig(viewID, imageID, {
        slice: ruler.slice!,
      });
    });
  }

  // --- watch RulerTool for changes to apply --- //

  function updateFromWidgetState(
    this: _This,
    event: {
      id: string;
      update: RulerStateUpdate;
    }
  ) {
    const { id, update } = event;
    const patch: Partial<Ruler> = {};

    if ('firstPoint' in update) {
      patch.firstPoint = update.firstPoint;
    }
    if ('secondPoint' in update) {
      patch.secondPoint = update.secondPoint;
    }
    if ('interactionState' in update) {
      patch.interactionState = update.interactionState;
    }

    updateRulerInternal.call(this, id, patch);
  }

  let cleanup: Function;

  function initialize(this: _This) {
    const update = updateFromWidgetState.bind(this);
    this.$rulers.events.on('widgetUpdate', update);
    cleanup = () => this.$rulers.events.off('widgetUpdate', update);
  }

  function uninitialize(this: _This) {
    cleanup();
  }

  // --- tool activation --- //

  function activateTool() {
    return true;
  }

  function deactivateTool(this: _This) {
    removeActiveRuler.call(this);
  }

  function serialize(state: StateFile) {
    state.manifest.tools.rulers = rulerIDs.value
      .map((rulerID) => rulers.value[rulerID])
      // If parent image is DICOM, save VolumeKey
      .map(({ imageID, ...rest }) => ({
        imageID: getDataID(imageID),
        ...rest,
      }));
  }

  function deserialize(
    this: _This,
    manifest: Manifest,
    dataIDMap: Record<string, string>
  ) {
    const rulersInState = manifest.tools.rulers;

    rulersInState
      .map(({ imageID, ...rest }) => {
        const newID = dataIDMap[imageID];
        return {
          ...rest,
          imageID: findImageID(newID),
        };
      })
      .forEach((ruler) => {
        addNewRuler.call(this, ruler);
      });
  }

  return {
    rulerIDs,
    rulers,
    activeRulerID,
    lengthByID,
    getVTKFactory,

    initialize,
    uninitialize,

    activateTool,
    deactivateTool,

    addNewRuler,
    addNewRulerFromViewEvent,
    removeActiveRuler,
    removeRuler,
    updateRuler,
    serialize,
    deserialize,
    jumpToRuler,
  };
});
