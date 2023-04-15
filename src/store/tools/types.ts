export enum Tools {
  WindowLevel = 'WindowLevel',
  Pan = 'Pan',
  Zoom = 'Zoom',
  Ruler = 'Ruler',
  Paint = 'Paint',
  Crosshairs = 'Crosshairs',
  Crop = 'Crop',
}

export type LPSCroppingPlanes = {
  Sagittal: [number, number];
  Coronal: [number, number];
  Axial: [number, number];
};
