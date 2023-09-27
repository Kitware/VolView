import vtkGeometryRepresentationProxy from '@kitware/vtk.js/Proxy/Representations/GeometryRepresentationProxy';
import { RGBColor } from '@kitware/vtk.js/types';

export type OutlineProperties = {lineWidth: number | undefined, color: RGBColor | undefined, opacity: number | undefined};

export interface vtkMultiSliceRepresentationProxy
extends vtkGeometryRepresentationProxy {
  setDataOutlineProperties(props: OutlineProperties): void;
  setSliceOutlineProperties(props: OutlineProperties[]): void;
  setPlanes(planes: {origin: vec3, normal: vec3}[]): void;
  setWindowWidth(width: number): boolean;
  setWindowLevel(level: number): boolean;
}

export default vtkMultiSliceRepresentationProxy;
