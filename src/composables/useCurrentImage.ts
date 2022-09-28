import { computed } from '@vue/composition-api';
import { useDatasetStore } from '../store/datasets';
import { useDICOMStore } from '../store/datasets-dicom';
import { defaultImageMetadata, useImageStore } from '../store/datasets-images';
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
    // assumed to be only images for now
    return dataStore.primaryDataset;
  });

  const currentImageExtent = computed(() =>
    getImageSpatialExtent(currentImageID.value)
  );

  const isImageLoading = computed(() => {
    return !!dataStore.primarySelection && !dataStore.primaryDataset;
  });

  return {
    currentImageData,
    currentImageID,
    currentImageMetadata,
    currentImageExtent,
    isImageLoading,
  };
}
