import { defineStore } from 'pinia';

/** Coordinates temporary mask previews with competing edits and durable reads. */
export const useSegmentationEditsStore = defineStore(
  'segmentationEdits',
  () => {
    let cancelPreview: (() => void) | undefined;

    function beforeEdit() {
      const cancel = cancelPreview;
      cancelPreview = undefined;
      cancel?.();
    }

    function hold(cancel: () => void) {
      beforeEdit();
      cancelPreview = cancel;
    }

    function release(cancel: () => void) {
      if (cancelPreview === cancel) cancelPreview = undefined;
    }

    // Save and export read committed voxels, resolving an unconfirmed preview.
    const beforeRead = beforeEdit;

    return { beforeEdit, beforeRead, hold, release };
  }
);
