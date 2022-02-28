import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';

import vtkProxyManager from '@kitware/vtk.js/Proxy/Core/ProxyManager';
import { useVTKProxyStore } from '@src/storex/vtk-proxy';
import { useImageStore } from '@src/storex/datasets-images';
import { useModelStore } from '@src/storex/datasets-models';
import vtkSourceProxy from '@kitware/vtk.js/Proxy/Core/SourceProxy';

export function syncProxyManagerWithStores(proxyManager: vtkProxyManager) {
  const proxyStore = useVTKProxyStore();
  const imageStore = useImageStore();
  const modelStore = useModelStore();

  let syncGuard: boolean = false;

  function registerSources<T>(dataIDs: string[], dataIndex: Record<string, T>) {
    dataIDs.forEach((id) => {
      if (!(id in proxyStore.dataToProxyID)) {
        const proxy = proxyManager.createProxy<vtkSourceProxy<T>>(
          'Sources',
          'TrivialProducer'
        );
        proxy.setInputData(dataIndex[id]);
        proxyStore.addSource(id, proxy.getProxyId());
      }
    });
  }

  const stopImageStoreSub = imageStore.$subscribe(() => {
    if (!syncGuard) {
      syncGuard = true;
      registerSources<vtkImageData>(imageStore.idList, imageStore.dataIndex);
      syncGuard = false;
    }
  });

  const stopModelStoreSub = modelStore.$subscribe(() => {
    if (!syncGuard) {
      syncGuard = true;
      registerSources<vtkPolyData>(modelStore.idList, modelStore.dataIndex);
      syncGuard = false;
    }
  });

  return () => {
    stopImageStoreSub();
    stopModelStoreSub();
  };
}
