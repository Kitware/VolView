import { vtkAlgorithm, vtkObject } from '@kitware/vtk.js/interfaces';
import vtkProxyManager from '@kitware/vtk.js/Proxy/Core/ProxyManager';

export interface vtkClass {
  newInstance: () => vtkObject;
  extend: (publiAPI: any, model: any) => void;
}

export interface vtkReader extends vtkObject, vtkAlgorithm {
  parseAsArrayBuffer: (ab: ArrayBufferLike) => void;
  parseAsText: (text: string) => void;
}

export default interface vtkProxyObject extends vtkObject {
  getProxyId(): string;
  getProxyGroup(): string;
  getProxyName(): string;
  getProxyManager(): vtkProxyManager;
  setProxyManager(manager: vtkProxyManager): void;
}
