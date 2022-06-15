import chai, { expect } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';

import { setActivePinia, createPinia } from 'pinia';

import { useView2DStore } from '@src/store/views-2D';
import { useViewConfigStore } from '@/src/store/view-configs';
import { CorePiniaProviderPlugin } from '@/src/core/provider';
import ProxyManager from '@/src/core/proxies';

chai.use(chaiAsPromised);
chai.use(sinonChai);

describe('View 2D Config store', () => {
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
    const viewConfigStore = useViewConfigStore();
    view2DStore.createView('Left');
    const anterior = view2DStore.createView('Anterior');

    viewConfigStore.updateSliceDomain(anterior.id, '1', [0, 100]);
    viewConfigStore.updateWLDomain(anterior.id, '1', [10, 250]);
  }

  it('clamps slice values appropriately', () => {
    const viewConfigStore = useViewConfigStore();
    addTestData();

    viewConfigStore.setSlice('2', '1', 200);
    let config = viewConfigStore.getSliceConfig('2', '1');
    expect(config).to.not.be.null;
    if (config !== null) {
      expect(config.slice).to.equal(100);
    }

    viewConfigStore.setSlice('2', '1', -200);
    config = viewConfigStore.getSliceConfig('2', '1');
    expect(config).to.not.be.null;
    if (config !== null) {
      expect(config.slice).to.equal(0);
    }
  });

  it('updates slice domains', () => {
    const viewConfigStore = useViewConfigStore();
    addTestData();
    viewConfigStore.updateSliceDomain('2', '1', [0, 20]);
    const config = viewConfigStore.getSliceConfig('2', '1');
    expect(config).to.not.be.null;
    if (config !== null) {
      expect(config.max).to.equal(20);
    }
  });
});
