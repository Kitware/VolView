import chai, { expect } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';

import { setActivePinia, createPinia } from 'pinia';

import { useView2DStore } from '@src/store/views-2D';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import ProxyManager from '@/src/core/proxies';

chai.use(chaiAsPromised);
chai.use(sinonChai);

describe('View 2D store', () => {
  let proxyManager = sinon.createStubInstance(ProxyManager);

  beforeEach(() => {
    proxyManager = sinon.createStubInstance(ProxyManager);

    const pinia = createPinia();
    pinia.use(
      CorePiniaProviderPlugin({
        proxyManager,
      })
    );
    setActivePinia(pinia);
  });

  function addTestData() {
    const view2DStore = useView2DStore();
    view2DStore.createView('Left');
    view2DStore.createView('Anterior', [0, 100], [10, 250]);
  }

  it('sets the default slice and window level', () => {
    const view2DStore = useView2DStore();
    addTestData();

    expect(view2DStore.sliceConfigs['1'].slice).to.equal(0);
    expect(view2DStore.wlConfigs['1'].level).to.be.closeTo(0.5, 0.001);
    expect(view2DStore.wlConfigs['1'].width).to.equal(1);
  });

  it('clamps slice values appropriately', () => {
    const view2DStore = useView2DStore();
    addTestData();

    view2DStore.setSlice('2', 200);
    expect(view2DStore.sliceConfigs['2'].slice).to.equal(100);

    view2DStore.setSlice('2', -200);
    expect(view2DStore.sliceConfigs['2'].slice).to.equal(0);
  });

  it('updates slice domains', () => {
    const view2DStore = useView2DStore();
    addTestData();

    view2DStore.updateSliceDomain('1', [0, 20]);
    expect(view2DStore.sliceConfigs['1'].max).to.equal(20);
  });
});
