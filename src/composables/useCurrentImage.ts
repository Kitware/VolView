import { computed } from '@vue/composition-api';
import { useDatasetStore } from '../store/datasets';
import { useDICOMStore } from '../store/datasets-dicom';
import { defaultImageMetadata, useImageStore } from '../store/datasets-images';

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

  const isImageLoading = computed(() => {
    return !!dataStore.primarySelection && !dataStore.primaryDataset;
  });

  return {
    currentImageData,
    currentImageID,
    currentImageMetadata,
    isImageLoading,
  };
}
