import { del, set } from '@vue/composition-api';
import { Vector3 } from '@kitware/vtk.js/types';
import { distance2BetweenPoints } from '@kitware/vtk.js/Common/Core/Math';
import { removeFromArray } from '@/src/utils';
import { RulerStateUpdate } from '@/src/tools/ruler';
import { defineStore } from 'pinia';
import { InteractionState } from '@/src/vtk/RulerWidget/state';
import { LPSAxis } from '../../utils/lps';
import { useIDStore } from '../../storex/id';

export interface RulerTool {
  name: string;
  /**
   * Point is in image index space.
   */
  firstPoint: Vector3 | null;
  /**
   * Point is in image index space.
   */
  secondPoint: Vector3 | null;
  /**
   * The associated view slicing axis.
   */
  viewAxis: LPSAxis | null;
  /**
   * The associated slice along the axis.
   */
  slice: number | null;
  /**
   * The associated image dataset.
   *
   * The ruler currently does not store orientation info,
   * and so depends on the associated image space.
   */
  imageID: string;
  /**
   * The current interaction state.
   */
  interactionState: InteractionState;
}

const emptyRulerTool = (): RulerTool => ({
  name: '',
  firstPoint: null,
  secondPoint: null,
  viewAxis: null,
  slice: null,
  imageID: '',
  interactionState: InteractionState.PlacingFirst,
});

export type RulerPatch = Partial<RulerTool> & RulerStateUpdate;

interface State {
  rulerIDs: string[];
  rulers: Record<string, RulerTool>;
  activeRulerID: string | null;
  // imageToRulers: Record<string, string[]>;
}

export const useRulerToolStore = defineStore('rulerTool', {
  state: (): State => ({
    rulerIDs: [],
    rulers: Object.create(null),
    activeRulerID: null,
    // imageToRulers: Object.create(null),
  }),
  getters: {
    lengths(state) {
      return state.rulerIDs.reduce((lengths, id) => {
        const { firstPoint, secondPoint } = state.rulers[id];
        return Object.assign(lengths, {
          [id]:
            firstPoint && secondPoint
              ? Math.sqrt(distance2BetweenPoints(firstPoint, secondPoint))
              : 0,
        });
      }, {} as Record<string, number>);
    },
  },
  actions: {
    activateRuler(rulerID: string) {
      if (this.activeRulerID) {
        this.deactivateRuler(this.activeRulerID);
      }
      if (rulerID in this.rulers) {
        this.activeRulerID = rulerID;
      }
    },
    deactivateRuler(rulerID: string) {
      if (rulerID in this.rulers) {
        this.activeRulerID = null;
      }
    },
    addNewRuler(ruler: Partial<RulerTool>) {
      const idStore = useIDStore();
      const id = idStore.getNextID();

      set(this.rulers, id, emptyRulerTool());
      this.rulerIDs.push(id);

      this.$tools.ruler.createRuler(id);
      // triggers a sync from store to widget state
      this.updateRuler(id, ruler);

      return id;
    },
    removeRuler(id: string) {
      this.deactivateRuler(id);
      this.$tools.ruler.removeRuler(id);
      removeFromArray(this.rulerIDs, id);
      del(this.rulers, id);
    },
    /**
     * Updates a ruler.
     *
     * @param id
     * @param patch {RulerPatch}
     * @param updateManager should we update the manager/widget state. This is a recursion guard.
     */
    updateRuler(id: string, patch: Partial<RulerTool>, updateManager = true) {
      if (id in this.rulers) {
        const ruler = this.rulers[id];
        Object.assign(ruler, patch);

        if (
          id === this.activeRulerID &&
          ruler.interactionState === InteractionState.Settled
        ) {
          this.deactivateRuler(id);
        }

        if (updateManager) {
          const update: RulerStateUpdate = {
            firstPoint: ruler.firstPoint,
            secondPoint: ruler.secondPoint,
            interactionState: ruler.interactionState,
          };
          this.$tools.ruler.updateRuler(id, update);
        }
      }
    },
    /*
    updatePendingRuler(ruler: NullableValues<RulerTool>) {
      Object.assign(this.pendingRuler, ruler);
    },
    clearPendingRuler() {
      this.pendingRuler = createNulledRuler();
    },
    */
  },
});

export type RulerToolStore = ReturnType<typeof useRulerToolStore>;

/**
 * When a tool manager emits a widget update, it calls this entrypoint.
 *
 * It is expected that the pinia instance is active by the time this is called.
 */
export const updateRulerFromWidgetStateEvent = (event: {
  id: string;
  update: RulerStateUpdate;
}) => {
  const { id, update } = event;
  const rulerStore = useRulerToolStore();
  const patch: Partial<RulerTool> = {};

  if ('firstPoint' in update) {
    patch.firstPoint = update.firstPoint;
  }
  if ('secondPoint' in update) {
    patch.secondPoint = update.secondPoint;
  }
  if ('interactionState' in update) {
    patch.interactionState = update.interactionState;
  }
  rulerStore.updateRuler(id, patch, false);
};
