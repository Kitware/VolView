import chai, { expect } from 'chai';
import chaiSubset from 'chai-subset';

import { setActivePinia, createPinia } from 'pinia';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import RulerTool from '@/src/core/tools/ruler';
import { useRulerStore } from '@/src/store/tools/rulers';
import { InteractionState } from '@/src/vtk/RulerWidget/state';
import { Vector3 } from '@kitware/vtk.js/types';
import { LPSAxis } from '@/src/types/lps';

chai.use(chaiSubset);

describe('Ruler store', () => {
  let rulerCore: RulerTool;
  let rulerStore: ReturnType<typeof useRulerStore>;

  beforeEach(() => {
    rulerCore = new RulerTool();

    const pinia = createPinia();
    pinia.use(
      CorePiniaProviderPlugin({
        rulers: rulerCore,
      })
    );

    setActivePinia(pinia);

    rulerStore = useRulerStore();
    rulerStore.initialize();
  });

  afterEach(() => {
    rulerStore.uninitialize();
  });

  it('should support CRUD operations', () => {
    const id = rulerStore.addNewRuler({});
    expect(rulerStore.rulerIDs).to.include(id);

    const patch = {
      name: 'ruler #1',
      firstPoint: [0, 0, 1] as Vector3,
      secondPoint: [0, 0, 2] as Vector3,
      viewAxis: 'Axial' as LPSAxis,
      slice: 50,
      imageID: '3',
      interactionState: InteractionState.Settled,
      color: '#ccc',
    };
    rulerStore.updateRuler(id, patch);
    expect(rulerStore.rulers[id]).to.deep.equal(patch);

    rulerStore.removeRuler(id);
    expect(rulerStore.rulerIDs).to.not.include(id);
  });

  it('should sync state with the injected RulerTool', () => {
    const id = rulerStore.addNewRuler({});
    const factory = rulerCore.getFactory(id);
    expect(factory).to.not.be.null;

    const state = factory!.getWidgetState();
    state.getFirstPoint().setOrigin([1, 2, 3]);
    expect(rulerStore.rulers[id].firstPoint).to.deep.equal([1, 2, 3]);

    rulerStore.updateRuler(id, {
      secondPoint: [4, 5, 6],
    });

    expect(state.getSecondPoint().getOrigin()).to.deep.equal([4, 5, 6]);
  });

  // addRulerFromViewEvent requires an integration test due to
  // its dependency on vtkOpenGLRenderWindow
});
