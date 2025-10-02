import {
  InjectionKey,
  MaybeRef,
  Ref,
  computed,
  hasInjectionContext,
  inject,
  unref,
} from 'vue';
import { Maybe } from '@/src/types';
import { defaultImageMetadata } from '@/src/core/progressiveImage';
import { useLayersStore } from '@/src/store/datasets-layers';
import { createLPSBounds, getAxisBounds } from '@/src/utils/lps';
import { storeToRefs } from 'pinia';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useViewStore } from '@/src/store/views';

export interface CurrentImageContext {
  imageID: Ref<Maybe<string>>;
}

export const CurrentImageInjectionKey = Symbol(
  'CurrentImage'
) as InjectionKey<CurrentImageContext>;

// Returns a spatially inflated image extent
export function getImageSpatialExtent(imageID: Maybe<string>) {
  const imageCacheStore = useImageCacheStore();
  const metadata = imageCacheStore.getImageMetadata(imageID);

  if (imageID && metadata) {
    const { lpsOrientation } = metadata;
    const image = imageCacheStore.getVtkImageData(imageID);
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
  return (
    useImageCacheStore().getImageMetadata(imageID) ?? defaultImageMetadata()
  );
}

export function getImageData(imageID: Maybe<string>) {
  return useImageCacheStore().getVtkImageData(imageID);
}

export function getIsImageLoading(imageID: Maybe<string>) {
  if (!imageID) return false;
  const image = useImageCacheStore().imageById[imageID];
  if (!image) return false;
  return image.loading.value;
}

export function getImageLayers(imageID: Maybe<string>) {
  if (!imageID) return [];
  const layersStore = useLayersStore();
  const imageCacheStore = useImageCacheStore();
  return layersStore
    .getLayers(imageID)
    .filter(({ id }) => imageCacheStore.imageById[id]?.isLoaded());
}

export function getImage(imageID: Maybe<string>) {
  if (!imageID) return null;
  const imageCacheStore = useImageCacheStore();
  return imageCacheStore.imageById[imageID];
}

export function useImage(imageID: MaybeRef<Maybe<string>>) {
  return {
    id: computed(() => unref(imageID)),
    imageData: computed(() => getImageData(unref(imageID))),
    metadata: computed(() => getImageMetadata(unref(imageID))),
    extent: computed(() => getImageSpatialExtent(unref(imageID))),
    isLoading: computed(() => getIsImageLoading(unref(imageID))),
    layers: computed(() => getImageLayers(unref(imageID))),
    image: computed(() => getImage(unref(imageID))),
  };
}

export function useCurrentImage(type: 'local' | 'global' = 'local') {
  const { activeView, viewByID } = storeToRefs(useViewStore());
  const viewInfo = computed(() =>
    activeView.value ? viewByID.value[activeView.value] : null
  );
  const defaultContext = { imageID: computed(() => viewInfo.value?.dataID) };
  const { imageID } =
    hasInjectionContext() && type === 'local'
      ? inject(CurrentImageInjectionKey, defaultContext)
      : defaultContext;

  const { id, imageData, metadata, extent, isLoading, layers, image } =
    useImage(imageID);
  return {
    currentImageID: id,
    currentImageMetadata: metadata,
    currentImageData: imageData,
    currentImageExtent: extent,
    isImageLoading: isLoading,
    currentLayers: layers,
    currentImage: image,
  };
}
