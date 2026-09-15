import {
  TYPE_TAG_ANNOTATIONS,
  TYPE_TAG_IMAGE,
  TYPE_TAG_LABELMAP,
} from '@/backend-contract';
import type { DataSource } from '@/src/io/import/dataSource';
import type { TaskFormModel } from '@/src/processing/engine/formModel';
import {
  bindMintedImageInputs,
  mintInputValue,
  type ImageBindingResult,
  type SourceRefBindingState,
  type SourceRefField,
} from '@/src/processing/engine/mintInput';
import {
  bindLabelmapInputs,
  type LabelmapBindingResult,
} from '@/src/processing/engine/mintLabelmap';
import {
  bindAnnotationsInputs,
  type AnnotationsBindingResult,
} from '@/src/processing/engine/mintAnnotations';

export type BoundSourceRefType =
  | typeof TYPE_TAG_IMAGE
  | typeof TYPE_TAG_LABELMAP
  | typeof TYPE_TAG_ANNOTATIONS;

export type SourceRefBindings = {
  image: ImageBindingResult;
  labelmap: LabelmapBindingResult;
  annotations: AnnotationsBindingResult;
  types: Record<string, BoundSourceRefType>;
  states: Record<string, SourceRefBindingState>;
  issues: ImageBindingResult['issues'];
};

export type SourceRefBindingContext = {
  activeDataSource: DataSource | undefined;
  // The current image's segmentation, when it holds a mask.
  segmentationId: string | undefined;
  // Whether the active image carries at least one finished annotation tool.
  hasFinishedAnnotations: boolean;
};

const BOUND_TYPES = new Set<string>([
  TYPE_TAG_IMAGE,
  TYPE_TAG_LABELMAP,
  TYPE_TAG_ANNOTATIONS,
]);

const acceptedTypes = (field: SourceRefField): BoundSourceRefType[] =>
  Array.from(
    new Set(
      field.accepts.filter((type): type is BoundSourceRefType =>
        BOUND_TYPES.has(type)
      )
    )
  );

const modelForType = (
  model: TaskFormModel,
  types: Record<string, BoundSourceRefType>,
  type: BoundSourceRefType
): TaskFormModel => ({
  ...model,
  fields: model.fields.filter(
    (field) => field.kind === 'sourceRef' && types[field.id] === type
  ),
});

export const bindSourceRefs = (
  model: TaskFormModel,
  context: SourceRefBindingContext
): SourceRefBindings => {
  const fields = model.fields.filter(
    (field): field is SourceRefField => field.kind === 'sourceRef'
  );
  // All supported source references share the current image provenance.
  const imageValue = fields.some((field) => acceptedTypes(field).length > 0)
    ? mintInputValue(context.activeDataSource, TYPE_TAG_IMAGE)
    : null;
  const { segmentationId } = context;
  const available = new Set<BoundSourceRefType>(
    imageValue
      ? [
          TYPE_TAG_IMAGE,
          ...(segmentationId ? ([TYPE_TAG_LABELMAP] as const) : []),
          ...(context.hasFinishedAnnotations
            ? ([TYPE_TAG_ANNOTATIONS] as const)
            : []),
        ]
      : []
  );

  const types: Record<string, BoundSourceRefType> = {};
  const dedicated = new Set<BoundSourceRefType>();
  fields.forEach((field) => {
    const accepts = acceptedTypes(field);
    if (accepts.length !== 1) return;
    types[field.id] = accepts[0];
    dedicated.add(accepts[0]);
  });
  fields.forEach((field) => {
    const accepts = acceptedTypes(field);
    if (accepts.length <= 1) return;
    const availableTypes = accepts.filter((type) => available.has(type));
    const selected =
      availableTypes.find((type) => !dedicated.has(type)) ??
      availableTypes[0] ??
      accepts.find((type) => !dedicated.has(type)) ??
      accepts[0];
    if (selected) types[field.id] = selected;
  });

  const image = bindMintedImageInputs(
    modelForType(model, types, TYPE_TAG_IMAGE),
    context.activeDataSource,
    imageValue
  );
  // The segmentation's reference image is the active image.
  const labelmap = bindLabelmapInputs(
    modelForType(model, types, TYPE_TAG_LABELMAP),
    segmentationId,
    Boolean(imageValue)
  );

  const annotations = bindAnnotationsInputs(
    modelForType(model, types, TYPE_TAG_ANNOTATIONS),
    context.hasFinishedAnnotations,
    Boolean(imageValue),
    // The persisted IMAGE input is what re-identifies the parent after a
    // reload; staged types (labelmap, annotations) are excluded there.
    Object.values(types).includes(TYPE_TAG_IMAGE)
  );

  return {
    image,
    labelmap,
    annotations,
    types,
    states: { ...image.states, ...labelmap.states, ...annotations.states },
    issues: [...image.issues, ...labelmap.issues, ...annotations.issues],
  };
};
