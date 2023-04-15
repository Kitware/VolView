import chai, { expect } from 'chai';
import chaiSubset from 'chai-subset';

import { setActivePinia, createPinia } from 'pinia';
import { useRulerStore } from '@/src/store/tools/rulers';
import { Ruler, RulerPatch } from '@/src/types/ruler';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import IDGenerator from '@/src/core/id';
import { RequiredWithPartial } from '@/src/types';

chai.use(chaiSubset);

function createRuler(): RequiredWithPartial<Ruler, 'id' | 'color'> {
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

  describe('Placing rulers', () => {
    it('should create and delete placing rulers', () => {
      const store = useRulerStore();

      const pr1 = store.createPlacingRuler();
      const pr2 = store.createPlacingRuler();
      const pr3 = store.createPlacingRuler();

      expect(store.isPlacingRuler(pr1)).to.be.true;
      expect(Object.keys(store.placingRulerByID)).to.have.length(3);

      expect(store.placingRulerByID).to.have.property(pr1);
      expect(store.placingRulerByID).to.have.property(pr2);
      expect(store.placingRulerByID).to.have.property(pr3);

      store.removeRuler(pr1);
      expect(store.placingRulerByID).to.not.have.property(pr1);
      expect(store.isPlacingRuler(pr1)).to.be.false;

      store.removeRuler(pr2);
      store.removeRuler(pr3);

      expect(Object.keys(store.placingRulerByID)).to.have.length(0);
    });

    it('should update placing rulers', () => {
      const store = useRulerStore();
      const pr = store.createPlacingRuler();

      expect(store.placingRulerByID[pr]).to.not.have.property('firstPoint');

      const patch: RulerPatch = {
        firstPoint: [1, 2, 1],
      };
      store.updateRuler(pr, patch);

      expect(store.placingRulerByID[pr]).to.have.property(
        'firstPoint',
        patch.firstPoint
      );
    });

    it('should reset placing rulers', () => {
      const store = useRulerStore();
      const pr = store.createPlacingRuler();

      store.updateRuler(pr, {
        firstPoint: [1, 1, 1],
        secondPoint: [2, 2, 2],
        imageID: '4',
      });

      expect(store.placingRulerByID[pr]).to.include.keys(
        'firstPoint',
        'secondPoint',
        'imageID'
      );

      store.resetPlacingRuler(pr);

      expect(store.placingRulerByID[pr]).to.not.include.keys(
        'firstPoint',
        'secondPoint',
        'imageID'
      );
    });

    it('should not commit a placing ruler when not finalized', () => {
      const store = useRulerStore();
      const pr = store.createPlacingRuler();
      expect(store.commitPlacingRuler(pr)).to.be.null;
    });

    it('should commit a placing ruler', () => {
      const store = useRulerStore();
      const pr = store.createPlacingRuler();
      store.updateRuler(pr, createRuler());

      const id = store.commitPlacingRuler(pr);
      expect(id).to.not.be.null;
      expect(store.rulerByID).to.have.key(id!);
    });

    it('should clear placing rulers upon deactivation', () => {
      const store = useRulerStore();
      store.createPlacingRuler();
      store.createPlacingRuler();

      store.deactivateTool();
      expect(store.placingRulerByID).to.not.have.any.keys;
    });
  });

  it('should add new rulers', () => {
    const store = useRulerStore();
    const id = store.addRuler(createRuler());
    expect(store.rulerByID).to.have.key(id);
  });

  it('should not allow conflicting ruler IDs', () => {
    const store = useRulerStore();
    const id = store.addRuler(createRuler());
    expect(() => {
      store.addRuler({
        ...createRuler(),
        id,
      });
    }).to.throw(Error);
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
