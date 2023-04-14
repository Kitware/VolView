import { computed } from 'vue';
import { useDatasetStore } from '../store/datasets';
import { useDICOMStore } from '../store/datasets-dicom';
import { defaultImageMetadata, useImageStore } from '../store/datasets-images';
import { useLayersStore } from '../store/datasets-layers';
import { createLPSBounds, getAxisBounds } from '../utils/lps';

// Returns a spatially inflated image extent
export function getImageSpatialExtent(imageID: string | null) {
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

export function useCurrentImage() {
  const dataStore = useDatasetStore();
  const dicomStore = useDICOMStore();
  const imageStore = useImageStore();
  const layersStore = useLayersStore();

  const currentImageID = computed(() => {
    const { primarySelection } = dataStore;
    const { volumeToImageID } = dicomStore;

    if (primarySelection?.type === 'image') {
      return primarySelection.dataID;
    }
    if (primarySelection?.type === 'dicom') {
      return volumeToImageID[primarySelection.volumeKey] || null;
    }
    return null;
  });

  const currentImageMetadata = computed(() => {
    const { metadata } = imageStore;
    const imageID = currentImageID.value;

    if (imageID) {
      return metadata[imageID];
    }
    return defaultImageMetadata();
  });

  const currentImageData = computed(() => {
    if (currentImageID.value)
      // assumed to be only images for now
      return imageStore.dataIndex[currentImageID.value];
    return undefined;
  });

  const currentImageExtent = computed(() =>
    getImageSpatialExtent(currentImageID.value)
  );

  const isImageLoading = computed(() => {
    return !!dataStore.primarySelection && !dataStore.primaryDataset;
  });

  const currentLayers = computed(() =>
    layersStore
      .getLayers(dataStore.primarySelection)
      .filter(({ id }) => id in layersStore.layerImages)
  );

  return {
    currentImageData,
    currentImageID,
    currentImageMetadata,
    currentImageExtent,
    isImageLoading,
    currentLayers,
  };
}
