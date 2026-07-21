import { TYPE_TAG_IMAGE, TYPE_TAG_LABELMAP } from '@/backend-contract';
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
  resolveLabelmapGroup,
  type LabelmapBindingResult,
  type SegmentGroupView,
} from './mintLabelmap';

export type BoundSourceRefType =
  | typeof TYPE_TAG_IMAGE
  | typeof TYPE_TAG_LABELMAP;

export type SourceRefBindings = {
  image: ImageBindingResult;
  labelmap: LabelmapBindingResult;
  types: Record<string, BoundSourceRefType>;
  states: Record<string, SourceRefBindingState>;
  issues: ImageBindingResult['issues'];
};

export type SourceRefBindingContext = {
  activeDataSource: DataSource | undefined;
  backgroundImageId: string | undefined;
  activeSegmentGroupId: string | null | undefined;
  segmentGroups: SegmentGroupView;
  getDataSource: (imageId: string) => DataSource | undefined;
};

const acceptedTypes = (field: SourceRefField): BoundSourceRefType[] =>
  Array.from(
    new Set(
      field.accepts.filter(
        (type): type is BoundSourceRefType =>
          type === TYPE_TAG_IMAGE || type === TYPE_TAG_LABELMAP
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
  const acceptsImage = fields.some((field) =>
    acceptedTypes(field).includes(TYPE_TAG_IMAGE)
  );
  const acceptsLabelmap = fields.some((field) =>
    acceptedTypes(field).includes(TYPE_TAG_LABELMAP)
  );
  const imageValue = acceptsImage
    ? mintInputValue(context.activeDataSource, TYPE_TAG_IMAGE)
    : null;
  const labelmapResolution = acceptsLabelmap
    ? resolveLabelmapGroup(
        context.backgroundImageId,
        context.activeSegmentGroupId,
        context.segmentGroups
      )
    : { kind: 'unresolved' as const };
  const labelmapReference =
    labelmapResolution.kind === 'resolved'
      ? mintLabelmapReferenceImage(
          labelmapResolution.groupId,
          context.segmentGroups,
          context.getDataSource
        )
      : null;
  const available = new Set<BoundSourceRefType>();
  if (imageValue) {
    available.add(TYPE_TAG_IMAGE);
  }
  if (labelmapResolution.kind === 'resolved' && labelmapReference) {
    available.add(TYPE_TAG_LABELMAP);
  }

  const types: Record<string, BoundSourceRefType> = {};
  const dedicated = new Set<BoundSourceRefType>();
  fields.forEach((field) => {
    const accepted = acceptedTypes(field);
    if (accepted.length !== 1) return;
    types[field.id] = accepted[0];
    dedicated.add(accepted[0]);
  });
  fields.forEach((field) => {
    const accepted = acceptedTypes(field);
    if (accepted.length <= 1) return;
    const availableTypes = accepted.filter((type) => available.has(type));
    const selected =
      availableTypes.find((type) => !dedicated.has(type)) ??
      availableTypes[0] ??
      accepted.find((type) => !dedicated.has(type)) ??
      accepted[0];
    if (selected) types[field.id] = selected;
  });

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
  Object.entries(labelmap.groups).forEach(([parameterId, groupId]) => {
    const reference =
      labelmapResolution.kind === 'resolved' &&
      labelmapResolution.groupId === groupId
        ? labelmapReference
        : null;
    if (reference) return;
    labelmap.states[parameterId] = 'no-provenance';
    labelmapIssues.push({
      parameter: parameterId,
      message:
        'The segment group reference image was not loaded from the server, so it cannot be used as an input.',
    });
  });

  return {
    image,
    labelmap,
    types,
    states: { ...image.states, ...labelmap.states },
    issues: [...image.issues, ...labelmapIssues],
  };
};
