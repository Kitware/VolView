import { beforeEach, describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';

import { useImageCacheStore } from '@/src/store/image-cache';
import { collectManifestRefs } from '@/src/core/manifestRefs';
import {
  ManifestSchema,
  type Manifest,
  type StateFile,
} from '@/src/io/state-file/schema';
import { useCropStore } from '@/src/store/tools/crop';

// ---------------------------------------------------------------------------
// Regression: the same unguarded dataIDMap lookup de729cfa fixed for
// annotations. A dataset that could not be loaded is absent from the restore
// map, so its saved crop planes used to be seated under the key `undefined`.
// Nothing ever deletes that image, so the crop store's onImageDeleted cascade
// cannot drop the entry and every later save carries it: a `tools.crop` key no
// dataset in the file describes, which the save-time reference backstop reports
// as dangling.
// ---------------------------------------------------------------------------

const LOADED = 'img-loaded';
const MISSING = 'img-missing';

/** A unit-spacing cube wide enough that the planes below need no clamping. */
const seat = (id: string) => {
  const image = vtkImageData.newInstance();
  image.setDimensions(8, 8, 8);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({
      name: 'scalars',
      numberOfComponents: 1,
      values: new Uint8Array(8 ** 3),
    })
  );
  return useImageCacheStore().addVTKImageData(image, id, { id });
};

const planes = (lower: number, upper: number) => ({
  Sagittal: [lower, upper] as [number, number],
  Coronal: [lower, upper] as [number, number],
  Axial: [lower, upper] as [number, number],
});

/** Crop planes on two images, shaped the way a save writes them. */
const savedCrop = (): Manifest => ({
  version: '1.0.0',
  dataSources: [],
  tools: { crop: { [LOADED]: planes(1, 4), [MISSING]: planes(2, 5) } },
});

/** Serialize the store the way `serialize` does, into a bare manifest. */
const resave = () => {
  const stateFile = { manifest: { tools: {} } } as unknown as StateFile;
  useCropStore().serialize(stateFile);
  return stateFile.manifest;
};

describe('restoring crop planes whose image did not load', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('skips the planes of the image that is missing', () => {
    seat(LOADED);
    useCropStore().deserialize(savedCrop(), { [LOADED]: LOADED });

    const cropping = useCropStore().croppingByImageID;
    expect(Object.keys(cropping)).toEqual([LOADED]);
    expect(cropping[LOADED]).toEqual(planes(1, 4));
  });

  it('keeps the surviving planes saveable and free of dangling references', () => {
    seat(LOADED);
    useCropStore().deserialize(savedCrop(), { [LOADED]: LOADED });

    const manifest = resave();
    expect(Object.keys(manifest.tools!.crop!)).toEqual([LOADED]);
    expect(ManifestSchema.shape.tools.safeParse(manifest.tools).success).toBe(
      true
    );
    expect(
      collectManifestRefs(manifest as unknown as Record<string, unknown>).map(
        (ref) => ref.where
      )
    ).toEqual([`tools.crop[${LOADED}]`]);
  });

  it('follows the image the planes were remapped onto', () => {
    seat('new-id');
    useCropStore().deserialize(savedCrop(), { [LOADED]: 'new-id' });

    expect(Object.keys(useCropStore().croppingByImageID)).toEqual(['new-id']);
  });

  it('restores nothing when no image came back', () => {
    useCropStore().deserialize(savedCrop(), {});

    expect(useCropStore().croppingByImageID).toEqual({});
    expect(resave().tools!.crop).toEqual({});
  });
});
