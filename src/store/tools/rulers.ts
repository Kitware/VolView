import { computed, del, ref, set } from '@vue/composition-api';
import { distance2BetweenPoints } from '@kitware/vtk.js/Common/Core/Math';
import { removeFromArray } from '@/src/utils';
import { TOOL_COLORS } from '@/src/config';
import { defineStore } from 'pinia';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { LPSAxisDir } from '@/src/types/lps';
import { findImageID, getDataID } from '../datasets';
import { Ruler, RulerPatch } from '../../types/ruler';
import { useViewStore } from '../views';
import { useViewConfigStore } from '../view-configs';

const createRulerWithDefaults = (ruler: Partial<Ruler>): Ruler => ({
  firstPoint: [0, 0, 0],
  secondPoint: [0, 0, 0],
  frameOfReference: {
    planeOrigin: [0, 0, 0],
    planeNormal: [1, 0, 0],
  },
  slice: -1,
  imageID: '',
  id: '',
  name: 'Ruler',
  color: TOOL_COLORS[0],
  placing: false,
  ...ruler,
});

export const useRulerStore = defineStore('ruler', () => {
  type _This = ReturnType<typeof useRulerStore>;

  // --- state --- //

  const rulerIDs = ref<string[]>([]);
  const rulerByID = ref<Record<string, Ruler>>(Object.create(null));

  // used for picking the next ruler color
  let colorIndex = 0;
  function getNextColor() {
    const color = TOOL_COLORS[colorIndex];
    colorIndex = (colorIndex + 1) % TOOL_COLORS.length;
    return color;
  }

  // --- getters --- //

  const rulers = computed<Ruler[]>(() => {
    const byID = rulerByID.value;
    return rulerIDs.value.map((id) => byID[id]);
  });

  const lengthByID = computed<Record<string, number>>(() => {
    const byID = rulerByID.value;
    return rulerIDs.value.reduce((lengths, id) => {
      const { firstPoint, secondPoint } = byID[id];
      return Object.assign(lengths, {
        [id]: Math.sqrt(distance2BetweenPoints(firstPoint, secondPoint)),
      });
    }, {});
  });

  // --- actions --- //

  function addRuler(this: _This, ruler: RulerPatch) {
    const id = this.$id.nextID();
    const color = ruler.color ?? getNextColor();
    set(rulerByID.value, id, createRulerWithDefaults({ ...ruler, id, color }));
    rulerIDs.value.push(id);
    return id;
  }

  function removeRuler(id: string) {
    if (id in rulerByID.value) {
      removeFromArray(rulerIDs.value, id);
      del(rulerByID.value, id);
    }
  }

  function updateRuler(id: string, patch: RulerPatch) {
    if (id in rulerByID.value) {
      set(rulerByID.value, id, { ...rulerByID.value[id], ...patch });
    }
  }

  function jumpToRuler(rulerID: string) {
    const ruler = rulerByID.value[rulerID];
    const { currentImageID, currentImageMetadata } = useCurrentImage();

    const imageID = currentImageID.value;
    if (!imageID || ruler.imageID !== imageID) return;

    const rulerImageFrame = frameOfReferenceToImageSliceAndAxis(
      ruler.frameOfReference,
      currentImageMetadata.value
    );

    if (!rulerImageFrame) return;

    const viewStore = useViewStore();
    const relevantViewIDs = viewStore.viewIDs.filter((viewID) => {
      const viewSpec = viewStore.viewSpecs[viewID];
      const viewDir = viewSpec.props.viewDirection as LPSAxisDir | undefined;
      return viewDir && getLPSAxisFromDir(viewDir) === rulerImageFrame.axis;
    });

    const viewConfigStore = useViewConfigStore();
    relevantViewIDs.forEach((viewID) => {
      viewConfigStore.updateSliceConfig(viewID, imageID, {
        slice: ruler.slice!,
      });
    });
  }

  // --- tool activation --- //

  function activateTool(this: _This) {
    return true;
  }

  function deactivateTool() {}

  // --- serialization --- //

  function serialize(state: StateFile) {
    state.manifest.tools.rulers = rulers.value
      .filter((ruler) => !ruler.placing)
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
        addRuler.call(this, ruler);
      });
  }

  return {
    rulers,
    rulerIDs,
    rulerByID,
    lengthByID,
    activateTool,
    deactivateTool,
    addRuler,
    updateRuler,
    removeRuler,
    jumpToRuler,
    serialize,
    deserialize,
  };
});
