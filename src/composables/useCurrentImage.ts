import { computed } from '@vue/composition-api';
import { useDatasetStore } from '../storex/datasets';
import { useDICOMStore } from '../storex/datasets-dicom';
import { defaultImageMetadata, useImageStore } from '../storex/datasets-images';

export function useCurrentImage() {
  const currentImageID = computed(() => {
    const dataStore = useDatasetStore();
    const dicomStore = useDICOMStore();
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
    const imageStore = useImageStore();
    const { metadata } = imageStore;
    const imageID = currentImageID.value;

    if (imageID) {
      return metadata[imageID];
    }
    return defaultImageMetadata();
  });

  const currentImageData = computed(() => {
    const dataStore = useDatasetStore();
    // assumed to be only images for now
    return dataStore.primaryDataset;
  });

  return {
    currentImageData,
    currentImageID,
    currentImageMetadata,
  };
}