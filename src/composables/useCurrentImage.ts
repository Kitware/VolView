import { InjectionKey, Ref, inject } from 'vue';
import { Maybe } from '@/src/types';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { ImageMetadata } from '@/src/types/image';
import { Vector2 } from '@kitware/vtk.js/types';
import { defaultImageMetadata, useImageStore } from '../store/datasets-images';
import { Layer, useLayersStore } from '../store/datasets-layers';
import { createLPSBounds, getAxisBounds } from '../utils/lps';

type SpatialExtent = {
  Sagittal: Vector2;
  Coronal: Vector2;
  Axial: Vector2;
};

export interface CurrentImageContext {
  id: Ref<Maybe<string>>;
  imageData: Ref<Maybe<vtkImageData>>;
  metadata: Ref<ImageMetadata>;
  extent: Ref<SpatialExtent>;
  isLoading: Ref<boolean>;
  layers: Ref<Layer[]>;
}

export const CurrentImageInjectionKey = Symbol(
  'CurrentImage'
) as InjectionKey<CurrentImageContext>;

// Returns a spatially inflated image extent
export function getImageSpatialExtent(imageID: Maybe<string>) {
  const imageStore = useImageStore();

  if (imageID && imageID in imageStore.metadata) {
    const { lpsOrientation } = imageStore.metadata[imageID];
    const image = imageStore.dataIndex[imageID];
    if (image) {
      const extent = image.getSpatialExtent();
      return {
        Sagittal: getAxisBounds(extent, 'Sagittal', lpsOrientation),
        Coronal: getAxisBounds(extent, 'Coronal', lpsOrientation),
        Axial: getAxisBounds(extent, 'Axial', lpsOrientation),
      };
    }
  }
  return createLPSBounds();
}

export function getImageMetadata(imageID: Maybe<string>) {
  const { metadata } = useImageStore();
  return imageID ? metadata[imageID] : defaultImageMetadata();
}

export function getImageData(imageID: Maybe<string>) {
  const { dataIndex } = useImageStore();
  return imageID ? dataIndex[imageID] : null;
}

export function getIsImageLoading(imageID: Maybe<string>) {
  // TODO imageID -> loading status
  return !imageID;
}

export function getImageLayers(imageID: Maybe<string>) {
  const layersStore = useLayersStore();
  return layersStore
    .getLayers(imageID ? { type: 'image', dataID: imageID } : null)
    .filter(({ id }) => id in layersStore.layerImages);
}

export function useCurrentImage() {
  const context = inject(CurrentImageInjectionKey);
  if (!context) throw new Error('useCurrentImage: no CurrentImageContext!');

  return {
    currentImageData: context.imageData,
    currentImageID: context.id,
    currentImageMetadata: context.metadata,
    currentImageExtent: context.extent,
    isImageLoading: context.isLoading,
    currentLayers: context.layers,
  };
}
