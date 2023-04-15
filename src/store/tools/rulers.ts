import { computed, del, ref, set } from '@vue/composition-api';
import { distance2BetweenPoints } from '@kitware/vtk.js/Common/Core/Math';
import { removeFromArray } from '@/src/utils';
import { TOOL_COLORS } from '@/src/config';
import { defineStore } from 'pinia';
import { Manifest, StateFile } from '@/src/io/state-file/schema';
import { RequiredWithPartial } from '@/src/types';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { frameOfReferenceToImageSliceAndAxis } from '@/src/utils/frameOfReference';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { LPSAxisDir } from '@/src/types/lps';
import { findImageID, getDataID } from '../datasets';
import { Ruler, RulerPatch, PlacingRuler } from '../../types/ruler';
import { useViewStore } from '../views';
import { useViewConfigStore } from '../view-configs';

const emptyPlacingRuler = (
  id: string,
  color = TOOL_COLORS[0]
): PlacingRuler => ({
  id,
  color,
});

function isPlacingRulerFinalized(ruler: PlacingRuler): ruler is Ruler {
  return Boolean(
    ruler.firstPoint &&
      ruler.secondPoint &&
      ruler.name &&
      ruler.imageID &&
      ruler.frameOfReference &&
      ruler.slice != null
  );
}

export const useRulerStore = defineStore('ruler', () => {
  type _This = ReturnType<typeof useRulerStore>;

  // --- state --- //

  const rulerIDs = ref<string[]>([]);
  const rulerByID = ref<Record<string, Ruler>>(Object.create(null));
  const placingRulerByID = ref<Record<string, PlacingRuler>>({});

  // used for picking the next ruler color
  let colorIndex = 0;
  function getNextColor() {
    const color = TOOL_COLORS[colorIndex];
    colorIndex = (colorIndex + 1) % TOOL_COLORS.length;
    return color;
  }

  function getNextPlacingRulerID() {
    return `PlacingRuler-${Object.keys(placingRulerByID.value).length}`;
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

  function createPlacingRuler() {
    const id = getNextPlacingRulerID();
    set(placingRulerByID.value, id, emptyPlacingRuler(id, getNextColor()));
    return id;
  }

  function resetPlacingRuler(id: string) {
    if (!(id in placingRulerByID.value)) {
      return;
    }
    const { color } = placingRulerByID.value[id];
    set(placingRulerByID.value, id, emptyPlacingRuler(id, color));
  }

  function isPlacingRuler(id: string) {
    return id in placingRulerByID.value;
  }

  function addRuler(
    this: _This,
    ruler: RequiredWithPartial<Ruler, 'id' | 'color'>
  ) {
    const id = ruler.id ?? this.$id.nextID();
    if (id in rulerByID.value) {
      throw new Error('Cannot add ruler with conflicting ID');
    }
    const color = ruler.color ?? getNextColor();
    set(rulerByID.value, id, {
      ...ruler,
      id,
      color,
    });
    rulerIDs.value.push(id);
    return id;
  }

  function removeRuler(id: string) {
    if (id in rulerByID.value) {
      removeFromArray(rulerIDs.value, id);
      del(rulerByID.value, id);
    } else if (id in placingRulerByID.value) {
      del(placingRulerByID.value, id);
    }
  }

  function updateRuler(id: string, patch: RulerPatch) {
    if (id in placingRulerByID.value) {
      set(placingRulerByID.value, id, {
        ...placingRulerByID.value[id],
        ...patch,
      });
    } else if (id in rulerByID.value) {
      set(rulerByID.value, id, { ...rulerByID.value[id], ...patch });
    }
  }

  /**
   * Saves a given placing ruler and returns the new ruler's ID.
   *
   * This makes a copy of the placing ruler and saves it.
   * @param this
   * @param id
   * @returns
   */
  function commitPlacingRuler(this: _This, id: string) {
    const ruler = placingRulerByID.value[id];
    if (ruler && isPlacingRulerFinalized(ruler)) {
      // allocate a non-placing ID
      const clone = { ...ruler, id: this.$id.nextID() };
      addRuler.call(this, clone);
      resetPlacingRuler(id);
      return clone.id;
    }
    return null;
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

  function deactivateTool() {
    placingRulerByID.value = {};
  }

  // --- serialization --- //

  function serialize(state: StateFile) {
    state.manifest.tools.rulers = rulerIDs.value
      .map((rulerID) => rulerByID.value[rulerID])
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
    placingRulerByID,
    activateTool,
    deactivateTool,
    createPlacingRuler,
    resetPlacingRuler,
    commitPlacingRuler,
    isPlacingRuler,
    addRuler,
    updateRuler,
    removeRuler,
    jumpToRuler,
    serialize,
    deserialize,
  };
});
