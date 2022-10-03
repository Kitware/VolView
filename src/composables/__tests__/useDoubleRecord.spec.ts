import { expect } from 'chai';
import vueCompositionApi, { computed } from '@vue/composition-api';
import Vue from 'vue';
import { useDoubleRecord } from '../useDoubleRecord';

Vue.use(vueCompositionApi);

describe('useDoubleRecord', () => {
  it('should work', () => {
    type Config = {
      propA: number;
    };

    const dr = useDoubleRecord<Config>();

    const ab = dr.getComputed('a', 'b');
    const abPropA = computed(() => ab.value?.propA);
    const hasAB = dr.hasComputed('a', 'b');
    expect(ab.value).to.be.undefined;
    expect(abPropA.value).to.be.undefined;
    expect(hasAB.value).to.be.false;

    dr.set('a', 'b', {
      propA: 43,
    });

    expect(ab.value).to.not.be.undefined;
    expect(hasAB.value).to.be.true;
    expect(abPropA.value).to.equal(43);

    dr.set('a', 'b', {
      ...ab.value!,
      propA: 11,
    });
    expect(abPropA.value).to.equal(11);

    dr.deleteSecondKey('b');

    expect(ab.value).to.be.undefined;
    expect(abPropA.value).to.be.undefined;
    expect(hasAB.value).to.be.false;

    dr.set('a', 'b', {
      propA: 9,
    });

    expect(hasAB.value).to.be.true;

    dr.deleteFirstKey('a');

    expect(hasAB.value).to.be.false;

    expect(() => {
      dr.delete('nonexistent', 'nonexistent');
    }).to.not.throw;
  });
});
