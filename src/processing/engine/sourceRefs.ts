import {
  TYPE_TAG_ANNOTATIONS,
  TYPE_TAG_IMAGE,
  TYPE_TAG_LABELMAP,
} from '@/backend-contract';
import type { DataSource } from '@/src/io/import/dataSource';
import type { TaskFormModel } from './formModel';
import {
  bindMintedImageInputs,
  mintInputValue,
  type ImageBindingResult,
  type SourceRefBindingState,
  type SourceRefField,
} from './mintInput';
import {
  bindResolvedLabelmapInputs,
  mintLabelmapReferenceImage,
  resolveLabelmapGroups,
  type LabelmapBindingResult,
  type SegmentGroupView,
} from './mintLabelmap';
import {
  bindAnnotationsInputs,
  type AnnotationsBindingResult,
} from './mintAnnotations';

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
  backgroundImageId: string | undefined;
  activeSegmentGroupId: string | null | undefined;
  segmentGroups: SegmentGroupView;
  // Whether the active image carries at least one finished annotation tool.
  hasFinishedAnnotations: boolean;
  getDataSource: (imageId: string) => DataSource | undefined;
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
  const anyFieldAccepts = (type: BoundSourceRefType): boolean =>
    fields.some((field) => acceptedTypes(field).includes(type));

  const acceptsImage = anyFieldAccepts(TYPE_TAG_IMAGE);
  const acceptsLabelmap = anyFieldAccepts(TYPE_TAG_LABELMAP);
  // Annotations stage against the active image itself, so they need the same
  // minted value the image binder uses.
  const acceptsAnnotations = anyFieldAccepts(TYPE_TAG_ANNOTATIONS);
  const imageValue =
    acceptsImage || acceptsAnnotations
      ? mintInputValue(context.activeDataSource, TYPE_TAG_IMAGE)
      : null;
  // Plurality belongs to the field that binds as labelmap, which is only known
  // after type resolution — and type resolution needs to know what a field
  // could bind to. Both candidates are resolved up front so each step reads the
  // one matching the field it is asking about.
  const resolveFor = (multiple: boolean) =>
    acceptsLabelmap
      ? resolveLabelmapGroups(
          context.backgroundImageId,
          context.activeSegmentGroupId,
          multiple,
          context.segmentGroups
        )
      : { kind: 'unresolved' as const };
  const singularResolution = resolveFor(false);
  const pluralResolution = resolveFor(true);
  const resolutionFor = (field: SourceRefField) =>
    field.multiple === true ? pluralResolution : singularResolution;
  // Every resolvable group has the background image as its parent, so one
  // minted reference serves both pluralities; the plural resolution resolves
  // whenever the singular one does.
  const labelmapReference =
    pluralResolution.kind === 'resolved'
      ? mintLabelmapReferenceImage(
          pluralResolution.groupIds[0],
          context.segmentGroups,
          context.getDataSource
        )
      : null;
  const available = new Set<BoundSourceRefType>();
  if (imageValue) {
    available.add(TYPE_TAG_IMAGE);
  }
  if (context.hasFinishedAnnotations && imageValue) {
    available.add(TYPE_TAG_ANNOTATIONS);
  }
  const isAvailable = (
    field: SourceRefField,
    type: BoundSourceRefType
  ): boolean =>
    type === TYPE_TAG_LABELMAP
      ? resolutionFor(field).kind === 'resolved' && Boolean(labelmapReference)
      : available.has(type);

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
    const availableTypes = accepts.filter((type) => isAvailable(field, type));
    const selected =
      availableTypes.find((type) => !dedicated.has(type)) ??
      availableTypes[0] ??
      accepts.find((type) => !dedicated.has(type)) ??
      accepts[0];
    if (selected) types[field.id] = selected;
  });

  const boundLabelmapFields = fields.filter(
    (field) => types[field.id] === TYPE_TAG_LABELMAP
  );
  // More than one bound field binds ambiguously whatever the resolution is, so
  // the binder discards it there.
  const labelmapResolution =
    boundLabelmapFields.length === 1
      ? resolutionFor(boundLabelmapFields[0])
      : { kind: 'unresolved' as const };

  const image = bindMintedImageInputs(
    modelForType(model, types, TYPE_TAG_IMAGE),
    context.activeDataSource,
    imageValue
  );
  const labelmap = bindResolvedLabelmapInputs(
    modelForType(model, types, TYPE_TAG_LABELMAP),
    labelmapResolution
  );
  const labelmapIssues = [...labelmap.issues];
  // A param carries groups only when its resolution resolved, so a missing
  // reference here means the groups themselves cannot be staged.
  const boundLabelmapParams = Object.keys(labelmap.groups);
  if (boundLabelmapParams.length > 0 && !labelmapReference) {
    boundLabelmapParams.forEach((parameterId) => {
      labelmap.states[parameterId] = 'no-provenance';
      labelmapIssues.push({
        parameter: parameterId,
        message:
          'The segment group reference image was not loaded from the server, so it cannot be used as an input.',
      });
    });
  }

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
    issues: [...image.issues, ...labelmapIssues, ...annotations.issues],
  };
};
