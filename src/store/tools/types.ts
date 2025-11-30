import type { Manifest, StateFile } from '@/src/io/state-file/schema';
import { Store } from 'pinia';

export enum AnnotationToolType {
  Rectangle = 'Rectangle',
  Ruler = 'Ruler',
  Polygon = 'Polygon',
}

export enum Tools {
  WindowLevel = 'WindowLevel',
  Pan = 'Pan',
  Zoom = 'Zoom',
  Crop = 'Crop',
  Paint = 'Paint',
  Select = 'Select',
  Crosshairs = 'Crosshairs',
  Rectangle = 'Rectangle',
  Ruler = 'Ruler',
  Polygon = 'Polygon',
}

export interface IActivatableTool {
  activateTool: () => boolean;
  deactivateTool: () => void;
}

export interface ISerializableTool {
  serialize: (state: StateFile) => void;
  deserialize: (manifest: Manifest, dataIDMap: Record<string, string>) => void;
}

export interface IToolStore
  extends Partial<IActivatableTool>, Partial<ISerializableTool>, Store {}
