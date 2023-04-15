import chai, { expect } from 'chai';
import chaiSubset from 'chai-subset';

import { setActivePinia, createPinia } from 'pinia';
import { useRulerStore } from '@/src/store/tools/rulers';

chai.use(chaiSubset);

describe('Ruler store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('should allow adding rulers', () => {
    const store = useRulerStore();
    expect(store).to.be.not.null;
  });

  // it('should support CRUD operations', () => {
  //   const rulerStore = useRulerStore();
  //   const id = rulerStore.addNewRuler({});
  //   expect(rulerStore.rulerIDs).to.include(id);

  //   const patch = {
  //     name: 'ruler #1',
  //     firstPoint: [0, 0, 1] as Vector3,
  //     secondPoint: [0, 0, 2] as Vector3,
  //     viewAxis: 'Axial' as LPSAxis,
  //     slice: 50,
  //     imageID: '3',
  //     interactionState: InteractionState.Settled,
  //     color: '#ccc',
  //   };
  //   rulerStore.updateRuler(id, patch);
  //   expect(rulerStore.rulers[id]).to.deep.equal(patch);

  //   rulerStore.removeRuler(id);
  //   expect(rulerStore.rulerIDs).to.not.include(id);
  // });
});
