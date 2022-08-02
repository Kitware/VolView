import { IPiecewiseFunctionProxyMode } from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { setActivePinia, createPinia } from 'pinia';
import { useViewConfigStore } from '../view-configs';

chai.use(chaiAsPromised);

describe('View Config Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('supports setting and getting volume coloring configs', () => {
    const configStore = useViewConfigStore();

    configStore.setVolumeColoring('1', '2', {
      colorBy: {
        arrayName: 'Scalars',
        location: 'pointData',
      },
      transferFunction: 'Hot',
      opacityFunction: {
        mode: IPiecewiseFunctionProxyMode.Gaussians,
        gaussians: [],
      },
    });

    expect(Object.values(configStore.volumeColorConfigs)).to.have.length(1);
    expect(configStore.viewConfigs['1'].size).to.equal(1);
  });
});
