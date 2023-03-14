import { vtkObject } from '@kitware/vtk.js/interfaces';
import { VtkProxy } from '@kitware/vtk.js/macros';
import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
import vtkProxyManager from '@kitware/vtk.js/Proxy/Core/ProxyManager';
import vtkSourceProxy from '@kitware/vtk.js/Proxy/Core/SourceProxy';
import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';

// mapped in proxy.js
export enum ViewProxyType {
  Volume = 'View3D',
  Slice = 'View2D',
}

/**
 * Wrapper around the vtkProxyManager, since we don't need some of
 * its complexities.
 */
export default class ProxyWrapper {
  private viewProxies: Map<string, vtkViewProxy>;
  private dataProxies: Map<string, vtkSourceProxy<vtkObject>>;
  private proxyManager: vtkProxyManager;

  constructor(proxyManager: vtkProxyManager) {
    this.viewProxies = new Map();
    this.dataProxies = new Map();
    this.proxyManager = proxyManager;
  }

  delete() {
    const deleteProxy = (proxy: VtkProxy) =>
      this.proxyManager.deleteProxy(proxy);

    this.viewProxies.forEach(deleteProxy);
    this.dataProxies.forEach(deleteProxy);
  }

  createView(id: string, type: ViewProxyType) {
    if (this.viewProxies.has(id)) {
      throw new Error('Cannot create a view with the same ID');
    }

    const proxy = this.proxyManager.createProxy<vtkViewProxy>('Views', type, {
      name: type,
    });

    this.viewProxies.set(id, proxy);
    return proxy;
  }

  getView<T extends vtkViewProxy>(id: string) {
    return <T | null>this.viewProxies.get(id);
  }

  removeView(id: string) {
    const proxy = this.viewProxies.get(id);
    if (proxy) {
      this.proxyManager.deleteProxy(proxy);
      this.viewProxies.delete(id);
    }
  }

  addData<T extends vtkObject>(id: string, data: T) {
    if (this.dataProxies.has(id)) {
      return;
    }
    const proxy = this.proxyManager.createProxy<vtkSourceProxy<T>>(
      'Sources',
      'TrivialProducer'
    );
    proxy.setInputData(data);
    this.dataProxies.set(id, proxy);
  }

  getData<T extends vtkObject>(id: string) {
    return <vtkSourceProxy<T> | null>(this.dataProxies.get(id) ?? null);
  }

  updateData<T extends vtkObject>(id: string, data: T) {
    const proxy = this.dataProxies.get(id);
    if (!proxy) {
      return;
    }
    proxy.setInputData(data);
  }

  deleteData(id: string) {
    const proxy = this.dataProxies.get(id);
    this.dataProxies.delete(id);
    if (proxy) this.proxyManager.deleteProxy(proxy);
    else throw new Error('Did not find proxy for ID');
  }

  getDataRepresentationForView<T extends vtkAbstractRepresentationProxy>(
    dataID: string,
    viewID: string
  ): T | null {
    const dataProxy = this.dataProxies.get(dataID);
    const viewProxy = this.viewProxies.get(viewID);
    if (!dataProxy || !viewProxy) {
      return null;
    }

    return this.proxyManager.getRepresentation(dataProxy, viewProxy);
  }
}
