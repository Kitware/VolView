import { defineStore } from 'pinia';
import { readonly, shallowReactive } from 'vue';
import type { RGBAColor } from '@kitware/vtk.js/types';

import { CATEGORICAL_COLORS } from '@/src/config';
import { useSegmentationEditsStore } from '@/src/segmentation/editing/coordinator';
import {
  decodeLabelmapSegments,
  importLabelmapImage,
  splitLabelmap,
  type DecodeOptions,
  type LabelmapImportHooks,
} from '@/src/segmentation/io/import';
import { unsupportedLabelsReason } from '@/src/segmentation/io/labelmap';
import {
  makeDefaultSegmentName,
  maskScalars,
  type LabelmapSegment,
} from '@/src/segmentation/model';
import { useSegmentStore } from '@/src/segmentation/segments';
import type { SeatOptions } from '@/src/segmentation/segmentRegistry';
import { useSegmentationStore } from '@/src/segmentation/store';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useMessageStore } from '@/src/store/messages';
import type { ProcessingResultSource } from '@/src/types';
import { cleanUndefined, cycle, ensureError } from '@/src/utils';
import {
  type DataSelection,
  getSelectionStem,
} from '@/src/utils/dataSelection';
import vtkLabelMap from '@/src/vtk/LabelMap';

/**
 * What a caller says about one source label value. Only `value` identifies the
 * bin; everything else overrides what the labelmap's own metadata decoded.
 */
type SourceDescription = Pick<LabelmapSegment, 'value'> &
  Partial<Omit<LabelmapSegment, 'value'>>;

type LabelmapConversionOptions = {
  source?: ProcessingResultSource;
  descriptions?: SourceDescription[];
  resample?: LabelmapImportHooks['resample'];
};

export const useLabelmapImportStore = defineStore('labelmapImport', () => {
  const segmentationStore = useSegmentationStore();

  // The conversions running for each child image, by parent, so a second
  // caller for the same pair joins it instead of splitting the same labelmap
  // twice. The parent belongs in the key: the same child going onto another
  // parent is other work, and joining it would hand that caller masks made on
  // an image it never named. Shallow: readers only ask whether a child has one.
  const conversions = shallowReactive(
    new Map<
      DataSelection,
      Map<DataSelection, ReturnType<typeof importLabelmapImage>>
    >()
  );

  /**
   * Seats one segment per descriptor, each with a mask cropped to its value's
   * voxels and holding SEGMENT_VALUE when it has any. Returns the segments.
   */
  function splitLabelmapIntoMasks(
    parentImageId: string,
    labelmap: vtkLabelMap,
    descriptors: LabelmapSegment[],
    options: {
      source?: ProcessingResultSource;
      // A migrated group's own display wins over a match.
      appearance?: SeatOptions['appearance'];
    } = {}
  ) {
    // Identity is committed before storage: the registry segment precedes the
    // allocation that would be the first to notice the parent has gone. Refuse
    // up front, so a conversion whose parent was removed while it ran mints
    // nothing at all.
    if (!useImageCacheStore().getVtkImageData(parentImageId))
      throw new Error('No such parent image');
    useSegmentationEditsStore().beforeEdit();
    const created: string[] = [];

    splitLabelmap(labelmap, descriptors, (descriptor, extent) => {
      const id = useSegmentStore().segments.seatSegment(
        parentImageId,
        {
          name: descriptor.name,
          color: [...descriptor.color] as RGBAColor,
          visible: descriptor.visible,
          locked: descriptor.locked,
          fillOpacity: descriptor.fillOpacity,
          outlineOpacity: descriptor.outlineOpacity,
        },
        { withMask: !!extent, appearance: options.appearance }
      );
      created.push(id);
      if (!extent) return undefined;
      const binding = segmentationStore.allocateSegmentMask(
        id,
        extent,
        options.source
      );
      return maskScalars(binding.image);
    });

    return created;
  }

  // Separate from the registry's mint cursor: a descriptor-less labelmap
  // decodes to the same catalog however many segments were minted by hand.
  const nextCategoricalColor = cycle(CATEGORICAL_COLORS);
  const getNextDecodeColor = () =>
    [...nextCategoricalColor(), 255] as RGBAColor;

  function decodeSegments(
    imageId: DataSelection | undefined,
    image: vtkLabelMap,
    options: Pick<
      DecodeOptions,
      'component' | 'headerMetadata' | 'declared' | 'baseName'
    > = {}
  ) {
    return decodeLabelmapSegments(imageId, image, {
      ...options,
      // A descriptor-less labelmap reads as the file it arrived in, not as
      // 'Segment N'; the cold restore decodes through here too, so the two
      // paths keep naming one labelmap alike. A caller reading bytes no loaded
      // image holds says what they arrived as, since there is no selection
      // here to take a name from.
      baseName:
        options.baseName ??
        (imageId === undefined ? undefined : getSelectionStem(imageId)),
      nextColor: getNextDecodeColor,
    });
  }

  // A declared value no component carried becomes a segment without a mask, so
  // a result that found nothing reads differently from one that never looked.
  function withDeclaredEmpties(
    decoded: LabelmapSegment[],
    bySourceValue: Map<number, Partial<SourceDescription>>,
    covered: Set<number>
  ) {
    const empties = [...bySourceValue]
      .filter(([value]) => value !== 0 && !covered.has(value))
      .map(([value, description]) => ({
        ...description,
        value,
        name: description.name ?? makeDefaultSegmentName(value),
        color: [...(description.color ?? getNextDecodeColor())] as RGBAColor,
        visible: description.visible ?? true,
      }));
    return [...decoded, ...empties];
  }

  async function convertImageToLabelmap(
    imageID: DataSelection,
    parentID: DataSelection,
    { source, descriptions = [], resample }: LabelmapConversionOptions = {}
  ) {
    // A second conversion of an image already converting onto the same parent
    // would split it again and mint a suffixed duplicate of every segment, and
    // the first call's cleanup would clear the pending flag while the second
    // still ran. Both callers share the one conversion and see it end when it
    // really ends; the joining caller's source and descriptions go unused.
    const running = conversions.get(imageID)?.get(parentID);
    if (running) return running;

    const bySourceValue = new Map(
      descriptions.map((descriptor) => [
        descriptor.value,
        cleanUndefined(descriptor),
      ])
    );
    // Every source value any component of this image carries voxels for. A
    // declaration is empty only when none of them did.
    const coveredValues = new Set<number>();
    const conversion = importLabelmapImage(imageID, parentID, {
      resample,
      // The empties join the descriptor list here, not at the split: the
      // import pairs the masks the split returns with these descriptors by
      // position, so the two lists have to be the same one. They wait for the
      // last component, once every component has said which values it carries.
      decode: async (labelmap, component, last) => {
        const decoded = await decodeSegments(imageID, labelmap, {
          component,
          // The file header's own declarations wait for the last component the
          // same way, through the same covered values.
          declared: { covered: coveredValues, last },
        });
        decoded.forEach((descriptor) => coveredValues.add(descriptor.value));
        if (!last) return decoded;
        return withDeclaredEmpties(decoded, bySourceValue, coveredValues);
      },
      split: (labelmap, descriptors) => {
        const created = splitLabelmapIntoMasks(
          parentID,
          labelmap,
          // Identity is chosen by name, so explicit descriptions must precede
          // binding to a segment on the destination image.
          descriptors.map((descriptor) => ({
            ...descriptor,
            ...bySourceValue.get(descriptor.value),
          }))
        );
        return created;
      },
      excluded: (voxels) =>
        useMessageStore().addWarning(
          'Some labels could not be imported',
          `${unsupportedLabelsReason(voxels)}; they were left empty.`
        ),
    }).then((created) => {
      // A receipt only on a finished import, so a failed one is retried whole.
      created.flat().forEach(({ segmentId }) => {
        const binding = segmentationStore.maskOf(segmentId);
        if (binding && source) binding.source = source;
      });
      return created;
    });
    const ontoParents =
      conversions.get(imageID) ?? new Map<DataSelection, typeof conversion>();
    conversions.set(imageID, ontoParents.set(parentID, conversion));
    try {
      return await conversion;
    } finally {
      ontoParents.delete(parentID);
      // The child is still converting while it goes onto another parent.
      if (ontoParents.size === 0) conversions.delete(imageID);
    }
  }

  /**
   * Starts a conversion and reports its failure. A conversion can outlive
   * the load or the click that started it, and the parent image can
   * be removed while the resample runs, so the rejection needs somewhere to
   * land instead of going unhandled.
   */
  function startLabelmapConversion(
    imageID: DataSelection,
    parentID: DataSelection,
    options: LabelmapConversionOptions = {}
  ) {
    return convertImageToLabelmap(imageID, parentID, options).catch((error) => {
      useMessageStore().addError('Failed to convert image to a labelmap', {
        error: ensureError(error),
      });
    });
  }

  return {
    convertingLabelmaps: readonly(conversions),
    splitLabelmapIntoMasks,
    decodeSegments,
    convertImageToLabelmap,
    startLabelmapConversion,
  };
});
