import chai, { expect } from 'chai';
import chaiSubset from 'chai-subset';

import { setActivePinia, createPinia } from 'pinia';
import { useRulerStore } from '@/src/store/tools/rulers';
import { Ruler } from '@/src/types/ruler';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import IDGenerator from '@/src/core/id';
import { RequiredWithPartial } from '@/src/types';

chai.use(chaiSubset);

function createRuler(): RequiredWithPartial<
  Ruler,
  'id' | 'color' | 'label' | 'labelProps'
> {
  return {
    firstPoint: [1, 1, 1],
    secondPoint: [2, 2, 2],
    imageID: '4',
    name: 'Ruler',
    frameOfReference: {
      planeNormal: [1, 0, 0],
      planeOrigin: [0, 0, 0],
    },
    slice: 23,
    placing: false,
  };
}

describe('Ruler store', () => {
  beforeEach(() => {
    const pinia = createPinia();
    pinia.use(
      CorePiniaProviderPlugin({
        id: new IDGenerator(),
      })
    );
    setActivePinia(pinia);
  });

  it('should add new rulers', () => {
    const store = useRulerStore();
    const id = store.addRuler(createRuler());
    expect(store.rulerByID).to.have.key(id);
  });

  it('should update rulers, if they exist', () => {
    const store = useRulerStore();
    const id = store.addRuler(createRuler());

    store.updateRuler(id, {
      imageID: '123',
    });
    expect(store.rulerByID[id]).to.have.property('imageID', '123');

    store.updateRuler('fakeID', {
      slice: 88,
    });
    expect(store.rulerByID).to.not.have.property('fakeID');
  });

  it('should cycle colors when creating new rulers', () => {
    const store = useRulerStore();
    const r1 = store.addRuler(createRuler());
    const r2 = store.addRuler(createRuler());

    const color1 = store.rulerByID[r1].color;
    const color2 = store.rulerByID[r2].color;
    expect(color1).to.not.deep.equal(color2);
  });

  it('should have a rulers getter', () => {
    const store = useRulerStore();
    const r1 = store.addRuler(createRuler());
    const r2 = store.addRuler(createRuler());

    expect(store.rulers).to.have.length(2);
    expect(store.rulers[0]).to.have.property('id', r1);
    expect(store.rulers[1]).to.have.property('id', r2);
  });

  it('should have a lengthByID getter', () => {
    const store = useRulerStore();
    const r1 = store.addRuler({
      ...createRuler(),
      firstPoint: [0, 0, 0],
      secondPoint: [5, 0, 0],
    });

    const expectedLength = 5;
    expect(store.lengthByID).to.have.property(r1, expectedLength);
  });

  // TODO testing jumpToRuler requires store integration
  // TODO testing (de)serialize requires store integration
});
