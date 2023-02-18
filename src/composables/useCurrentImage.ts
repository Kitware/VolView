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
    const { volumeToImageIDs } = dicomStore;

    if (primarySelection?.type === 'image') {
      return primarySelection.dataID;
    }
    if (primarySelection?.type === 'dicom') {
      return volumeToImageIDs[primarySelection.volumeKey]?.[0] || null;
    }
    return null;
  });

  const currentLayerImageIDs = computed(() => {
    const { imageIDToVolumeKey, volumeToImageIDs } = dicomStore;
    const currentID = currentImageID.value;
    if (currentID) {
      // plain imageStore images don't have layers yet, so just checking dicomStore.volumeToImageIDs
      const [, ...layerImageIDs] =
        volumeToImageIDs[imageIDToVolumeKey[currentID]] ?? [];
      return layerImageIDs;
    }
    return [];
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

  return {
    currentImageData,
    currentImageID,
    currentImageMetadata,
    currentImageExtent,
    isImageLoading,
    currentLayerImageIDs,
  };
}
