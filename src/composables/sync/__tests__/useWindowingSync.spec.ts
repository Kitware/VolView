import Vue from 'vue';
import VueCompositionApi, { computed, ref } from '@vue/composition-api';
import { WindowLevelConfig } from '@/src/store/view-configs/windowing';
import Sinon from 'sinon';
import chai, { expect } from 'chai';
import SinonChai from 'sinon-chai';
import { useWindowingSync } from '../useWindowingSync';

chai.use(SinonChai);

function makeContext(k: string) {
  const setSpy = Sinon.spy();
  const windowing = ref<WindowLevelConfig>({
    width: 1,
    level: 0,
    min: 0,
    max: 10,
  });
  const key = ref(k);
  const source = computed({
    get: () => windowing.value,
    set: (newValue) => {
      setSpy(newValue);
      windowing.value = newValue;
    },
  });

  return { windowing, key, source, setSpy };
}

describe('useWindowingSync', () => {
  before(() => {
    Vue.use(VueCompositionApi);
  });
  it('should work', () => {
    const ctxt1 = makeContext('abc');
    const ctxt2 = makeContext('abc');

    useWindowingSync(ctxt1.key, ctxt1.source);
    useWindowingSync(ctxt2.key, ctxt2.source);

    const newValue = {
      ...ctxt1.windowing.value,
      level: 4,
    };
    ctxt1.windowing.value = newValue;

    expect(ctxt2.setSpy).to.have.been.calledWith(newValue);
    expect(ctxt2.windowing.value.level).to.equal(newValue.level);
  });
});
