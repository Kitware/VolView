import Vue from 'vue';
import VueCompositionApi, { ref } from '@vue/composition-api';
import { expect } from 'chai';
import { createPrimitiveSyncContext } from '../createPrimitiveSyncContext';

describe('createPrimitiveSyncContext', () => {
  before(() => {
    Vue.use(VueCompositionApi);
  });

  it('should work', () => {
    const useSync = createPrimitiveSyncContext(0);

    const var1 = ref(0);
    const var2 = ref(0);
    const key1 = ref('key1');
    const key2 = ref('key1');

    useSync(key1, var1);
    useSync(key2, var2);

    expect(var1.value).to.equal(0);
    expect(var2.value).to.equal(0);

    var1.value = 2;

    expect(var1.value).to.equal(2);
    expect(var2.value).to.equal(2);

    var2.value = 4;

    expect(var1.value).to.equal(4);
    expect(var2.value).to.equal(4);

    key2.value = 'key2';
    var2.value = 6;

    expect(var1.value).to.equal(4);
    expect(var2.value).to.equal(6);
  });
});
