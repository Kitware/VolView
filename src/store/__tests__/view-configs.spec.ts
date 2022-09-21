import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
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

    configStore.updateVolumeColorConfig('1', '2', {
      colorBy: {
        arrayName: 'Scalars',
        location: 'pointData',
      },
      transferFunction: {
        preset: 'Hot',
        mappingRange: [0, 1],
      },
      opacityFunction: {
        mode: vtkPiecewiseFunctionProxy.Mode.Gaussians,
        gaussians: [],
        mappingRange: [0, 1],
      },
    });

    const config = configStore.getVolumeColorConfig('1', '2');
    expect(config).to.not.be.undefined;
  });
});
