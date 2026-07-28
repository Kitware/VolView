<template>
  <div class="jobs-module">
    <div
      v-if="providers.configs.size === 0"
      class="text-caption text-medium-emphasis pa-3"
    >
      No processing providers are configured for this dataset.
    </div>

    <v-expansion-panels
      v-else
      v-model="openPanels"
      multiple
      variant="accordion"
    >
      <v-expansion-panel value="run">
        <v-expansion-panel-title>
          <v-icon class="mr-2">mdi-console-line</v-icon>
          <span>Run a job</span>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <v-select
            v-if="showProviderSelect"
            v-model="selectedProviderId"
            :items="providerItems"
            :disabled="submitting"
            item-title="label"
            item-value="id"
            label="Provider"
            variant="outlined"
            density="compact"
            hide-details
            class="mb-3"
          />

          <div v-if="loadingProvider" class="text-caption text-medium-emphasis">
            Loading provider…
          </div>
          <div
            v-else-if="providerError"
            class="text-error text-caption d-flex align-center"
          >
            <span>{{ providerError }}</span>
            <v-btn
              data-testid="retry-provider"
              size="x-small"
              variant="text"
              class="ml-1"
              @click="retryProvider"
            >
              Retry
            </v-btn>
          </div>

          <template v-if="provider">
            <TaskPicker
              v-if="tasks.length"
              v-model="selectedTaskId"
              :tasks="tasks"
              :disabled="submitting"
              class="mb-3"
            />
            <div v-else class="text-caption text-medium-emphasis mb-3">
              No tasks available.
            </div>

            <div v-if="loadingTask" class="text-caption">
              Loading task spec…
            </div>
            <div
              v-else-if="taskError"
              class="text-error text-caption d-flex align-center"
            >
              <span>{{ taskError }}</span>
              <v-btn
                data-testid="retry-task"
                size="x-small"
                variant="text"
                class="ml-1"
                @click="retryTask"
              >
                Retry
              </v-btn>
            </div>
            <TaskForm
              v-else-if="taskModel"
              :model="taskModel"
              :values="currentValues"
              :issues="issues"
              :source-ref-states="sourceRefStates"
              :source-ref-names="sourceRefNames"
              :source-ref-types="sourceRefTypes"
              :submitting="submitting"
              @update:values="onValuesUpdate"
              @submit="onSubmit"
            />
          </template>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <v-expansion-panel value="jobs">
        <v-expansion-panel-title>
          <v-icon class="mr-2">mdi-history</v-icon>
          <span>Job History</span>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <JobList />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import type { Ref } from 'vue';
import { watchDebounced } from '@vueuse/core';

import { getErrorDetail, ensureError } from '@/src/utils';

import { useProcessingJobsStore } from '@/src/processing/store';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDatasetStore } from '@/src/store/datasets';
import { useCropStore } from '@/src/store/tools/crop';
import type {
  ProcessingProvider,
  ProcessingValue,
  SubmittedJobDisplay,
  SubmittedJobParameterDisplay,
  TaskSummary,
} from '@/src/processing/types';
import {
  buildTaskFormModel,
  initialFormValues,
  validateFormValues,
  fieldLabel,
  type TaskFormModel,
  type FormValidationIssue,
} from '@/src/processing/engine/formModel';
import { type SourceRefBindingState } from '@/src/processing/engine/mintInput';
import {
  mintLabelmapValue,
  mintLabelmapReferenceImage,
  type SegmentGroupView,
} from '@/src/processing/engine/mintLabelmap';
import { mintInputValue } from '@/src/processing/engine/mintInput';
import { mintAnnotationsValue } from '@/src/processing/engine/mintAnnotations';
import {
  annotationToolsViewCount,
  annotationsFileCount,
  encodeAnnotationsFile,
  hasTwoPoints,
  isEncodablePolygon,
  type AnnotationKindView,
  type AnnotationToolsView,
  type PolygonToolView,
  type TwoPointToolView,
} from '@/src/processing/engine/annotationsWire';
import { annotationToolStore } from '@/src/processing/annotationKinds';
import {
  bindSourceRefs,
  type BoundSourceRefType,
  type SourceRefBindings,
} from '@/src/processing/engine/sourceRefs';
import { cropPlanesToWorldBounds } from '@/src/processing/engine/bounds';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useMessageStore } from '@/src/store/messages';
import { writeSegmentation } from '@/src/io/readWriteImage';
import { getDataSourceName } from '@/src/io/import/dataSource';
import type {
  AnnotationToolKind,
  AnnotationsFile,
  InputValue,
  VolViewTaskParameter,
} from '@/backend-contract';
import {
  ANNOTATIONS_FILE_EXTENSION,
  TYPE_TAG_ANNOTATIONS,
  TYPE_TAG_LABELMAP,
} from '@/backend-contract';
import type { AnnotationTool } from '@/src/types/annotation-tool';
import { stripExtension } from '@/src/utils/path';

import TaskPicker from './TaskPicker.vue';
import TaskForm from './TaskForm.vue';
import JobList from './JobList.vue';

const providers = useProcessingJobsStore();
const { currentImageID } = useCurrentImage('global');
const imageCache = useImageCacheStore();
const datasetStore = useDatasetStore();
const cropStore = useCropStore();
const paintStore = usePaintToolStore();
const segmentGroupStore = useSegmentGroupStore();
const messageStore = useMessageStore();

const openPanels = ref<string[]>(['run', 'jobs']);

const providerItems = computed(() =>
  Array.from(providers.configs.values()).map((c) => ({
    id: c.id,
    label: c.label,
  }))
);
const showProviderSelect = computed(() => providerItems.value.length > 1);

// Seeded by the immediate providerItems watcher below.
const selectedProviderId = ref<string | null>(null);

const provider = ref<ProcessingProvider | null>(null);
const loadingProvider = ref(false);
const providerError = ref<string | null>(null);
const providerLoadVersion = ref(0);

const tasks = ref<TaskSummary[]>([]);
const selectedTaskId = ref<string | null>(null);

const taskModel = ref<TaskFormModel | null>(null);
const loadingTask = ref(false);
const taskError = ref<string | null>(null);
const taskLoadVersion = ref(0);
const currentValues = ref<Record<string, ProcessingValue>>({});
const issues = ref<FormValidationIssue[]>([]);
const sourceRefStates = ref<Record<string, SourceRefBindingState>>({});
const sourceRefTypes = ref<Record<string, BoundSourceRefType>>({});
const submitting = ref(false);

watch(
  providerItems,
  (items) => {
    if (items.length === 0) {
      selectedProviderId.value = null;
      return;
    }
    if (
      !selectedProviderId.value ||
      !items.some((item) => item.id === selectedProviderId.value)
    ) {
      selectedProviderId.value = items[0].id;
    }
  },
  { immediate: true }
);

// Shared supersede scaffolding for the two loader watchers: runs `body`,
// committing loading/error state only while `current()` holds, so a superseded
// request can neither clobber refs nor clear a successor's loading flag.
async function loadWhileCurrent(
  onCleanup: (fn: () => void) => void,
  stillWanted: () => boolean,
  state: { loading: Ref<boolean>; error: Ref<string | null> },
  fallbackError: string,
  body: (current: () => boolean) => Promise<void>
) {
  let active = true;
  onCleanup(() => {
    active = false;
  });
  const current = () => active && stillWanted();
  state.loading.value = true;
  state.error.value = null;
  try {
    await body(current);
  } catch (err) {
    if (!current()) return;
    state.error.value = getErrorDetail(err, fallbackError);
  } finally {
    if (current()) state.loading.value = false;
  }
}

watch(
  [selectedProviderId, providerLoadVersion],
  async ([id, version], _old, onCleanup) => {
    // Ungated reset: a superseded request's gated finally never runs.
    provider.value = null;
    tasks.value = [];
    taskModel.value = null;
    selectedTaskId.value = null;
    loadingProvider.value = false;
    providerError.value = null;
    if (!id) return;
    await loadWhileCurrent(
      onCleanup,
      () =>
        selectedProviderId.value === id &&
        providerLoadVersion.value === version,
      { loading: loadingProvider, error: providerError },
      'Failed to load provider',
      async (current) => {
        const p = await providers.getProvider(id);
        if (!current()) return;
        provider.value = p;
        const loaded = await p.listTasks();
        if (!current()) return;
        tasks.value = loaded;
        if (loaded.length > 0) {
          selectedTaskId.value = loaded[0].id;
        }
      }
    );
  },
  { immediate: true }
);

function retryProvider() {
  providerLoadVersion.value += 1;
}

watch(
  [selectedTaskId, taskLoadVersion],
  async ([id, version], _old, onCleanup) => {
    taskModel.value = null;
    loadingTask.value = false;
    taskError.value = null;
    if (!id || !provider.value) return;
    // A later provider change clears selectedTaskId and invalidates the guard.
    const activeProvider = provider.value;
    await loadWhileCurrent(
      onCleanup,
      () =>
        selectedTaskId.value === id &&
        taskLoadVersion.value === version &&
        provider.value === activeProvider,
      { loading: loadingTask, error: taskError },
      'Failed to load task spec',
      async (current) => {
        const envelope = await activeProvider.getTaskSpec(id);
        if (!current()) return;
        const model = buildTaskFormModel(envelope);
        taskModel.value = model;
        const bindings = activeSourceBindings(model);
        const initial = applyActiveBindings(
          model,
          initialFormValues(model),
          bindings
        );
        currentValues.value = initial;
        refreshValidation(model, initial, bindings);
      }
    );
  }
);

function retryTask() {
  taskLoadVersion.value += 1;
}

function onValuesUpdate(values: Record<string, ProcessingValue>) {
  currentValues.value = values;
  if (!taskModel.value) return;
  refreshValidation(taskModel.value, values);
}

async function onSubmit(values: Record<string, ProcessingValue>) {
  // Snapshot the submission context before the first await so a provider, task,
  // or image change mid-staging cannot splice into this submission.
  const submitProvider = provider.value;
  const providerId = selectedProviderId.value;
  const taskId = selectedTaskId.value;
  const model = taskModel.value;
  if (!submitProvider || !providerId || !taskId || !model) return;
  const activeDatasetId = currentImageID.value ?? undefined;

  const bindings = activeSourceBindings(model);
  const finalValues = applyActiveBindings(model, values, bindings);
  const finalIssues = refreshValidation(model, finalValues, bindings);
  if (finalIssues.length > 0) {
    currentValues.value = finalValues;
    return;
  }
  // Display formatting reads live active image and segment-group state, so it
  // must render before the staging await.
  const display = buildJobDisplay(model, finalValues);
  // Same reason, and it also outlives the staging awaits below: the annotations
  // file, its name, and its reference image all come from the active image,
  // which the user may switch while an upload is in flight. Only encoded when
  // something is actually bound to it.
  const annotations =
    bindings.annotations.parameters.length > 0
      ? captureAnnotationsPayload()
      : null;

  submitting.value = true;

  // The store does not surface staging failures, so report them here, each
  // under its own message.
  const stage = async (
    message: string,
    run: () => Promise<Record<string, ProcessingValue>>
  ): Promise<Record<string, ProcessingValue>> => {
    try {
      return await run();
    } catch (err) {
      messageStore.addError(message, { error: ensureError(err) });
      throw err;
    }
  };

  // Concurrent: the two stages write disjoint parameter keys, and the
  // annotations payload was snapshotted above.
  let staged: Record<string, ProcessingValue>[];
  try {
    staged = await Promise.all([
      stage('Failed to stage segment group input', () =>
        stageLabelmapInputs(submitProvider, model, bindings)
      ),
      stage('Failed to stage annotations input', () =>
        stageAnnotationInputs(submitProvider, bindings, annotations)
      ),
    ]);
  } catch {
    submitting.value = false;
    return;
  }
  const stagedValues = { ...finalValues, ...staged[0], ...staged[1] };

  try {
    await providers.submitJob(providerId, taskId, stagedValues, {
      activeDatasetId,
      display,
    });
  } catch {
    // The store already surfaces the failure; caught only to reset `submitting`.
  } finally {
    submitting.value = false;
  }
}

function worldBoundsForActive() {
  const id = currentImageID.value;
  if (!id) return null;
  const planes = cropStore.croppingByImageID[id];
  if (!planes) return null;
  const meta = imageCache.getImageMetadata(id);
  if (!meta) return null;
  return cropPlanesToWorldBounds(
    planes,
    meta.indexToWorld,
    meta.lpsOrientation
  );
}

function applyBoundsBindings(
  model: TaskFormModel,
  values: Record<string, ProcessingValue>
): Record<string, ProcessingValue> {
  const world = worldBoundsForActive();
  // Every bounds field is rewritten on each rebind so an uncropped image resets
  // to the spec default instead of keeping the previous image's bounds.
  const defaults = world ? null : initialFormValues(model);
  const next = { ...values };
  model.fields.forEach((f) => {
    if (f.kind !== 'bounds') return;
    next[f.id] = world ? [...world] : (defaults?.[f.id] ?? null);
  });
  return next;
}

function activeDataSource() {
  return datasetStore.getDataSource(currentImageID.value);
}

function activeImageName(): string | undefined {
  const id = currentImageID.value;
  return (
    imageCache.getImageMetadata(id)?.name ??
    getDataSourceName(activeDataSource()) ??
    undefined
  );
}

function segmentGroupView(): SegmentGroupView {
  return {
    orderByParent: segmentGroupStore.orderByParent,
    metadataByID: segmentGroupStore.metadataByID,
  };
}

function labelmapReferenceImage(segmentGroupId: string): InputValue | null {
  return mintLabelmapReferenceImage(
    segmentGroupId,
    segmentGroupView(),
    (imageId) => datasetStore.getDataSource(imageId)
  );
}

// Tool lists are per image, and so is the staged annotations file: only the
// active image's finished tools are ever an input.
function onActiveImage<T extends { imageID: string }>(
  tools: readonly T[]
): T[] {
  const id = currentImageID.value;
  return id ? tools.filter((tool) => tool.imageID === id) : [];
}

// The three stores are independent, so each keeps its own label namespace; the
// encoder prunes and re-keys them by name.
const annotationToolsView = computed<AnnotationToolsView>(() => {
  const kindView = <T extends object>(
    kind: AnnotationToolKind,
    hasGeometry: <U extends AnnotationTool>(tool: U) => tool is U & T
  ): AnnotationKindView<AnnotationTool & T> => {
    const store = annotationToolStore(kind);
    return {
      tools: onActiveImage(store.finishedTools).filter(hasGeometry),
      labels: store.labels,
    };
  };
  return {
    rulers: kindView<TwoPointToolView>('rulers', hasTwoPoints),
    rectangles: kindView<TwoPointToolView>('rectangles', hasTwoPoints),
    polygons: kindView<PolygonToolView>('polygons', isEncodablePolygon),
  };
});

// Computed, not a function call: placing a tool churns the stores every drag
// frame, and an unchanged count stops the invalidation there.
const finishedAnnotationCount = computed(() =>
  annotationToolsViewCount(annotationToolsView.value)
);

function activeSourceBindings(model: TaskFormModel): SourceRefBindings {
  return bindSourceRefs(model, {
    activeDataSource: activeDataSource(),
    backgroundImageId: currentImageID.value ?? undefined,
    activeSegmentGroupId: paintStore.activeSegmentGroupID,
    segmentGroups: segmentGroupView(),
    hasFinishedAnnotations: finishedAnnotationCount.value > 0,
    getDataSource: (imageId) => datasetStore.getDataSource(imageId),
  });
}

// Neither the labelmap nor the annotations value is set here: neither has
// server provenance of its own, so both earn URIs only at Run via the staging
// helpers below.
function applyActiveBindings(
  model: TaskFormModel,
  base: Record<string, ProcessingValue>,
  bindings: SourceRefBindings = activeSourceBindings(model)
): Record<string, ProcessingValue> {
  const withBounds = applyBoundsBindings(model, base);
  const clearedSourceRefs = Object.fromEntries(
    model.fields
      .filter((field) => field.kind === 'sourceRef')
      .map((field) => [field.id, null])
  );
  return { ...withBounds, ...clearedSourceRefs, ...bindings.image.values };
}

// Binder-owned sourceRef params are excluded from the generic check so they do
// not also report a duplicate "required" message.
function validateValues(
  model: TaskFormModel,
  values: Record<string, ProcessingValue>,
  bindings: SourceRefBindings
) {
  const boundParams = new Set(Object.keys(bindings.states));
  const generic = validateFormValues(model, values).filter(
    (i) => !boundParams.has(i.parameter)
  );
  return {
    issues: [...bindings.issues, ...generic],
    states: bindings.states,
    types: bindings.types,
  };
}

// Sole writer of `issues` and `sourceRefStates`: FileWidget's `binding` prop
// feeds from the states, so the two refs must move in lockstep.
function refreshValidation(
  model: TaskFormModel,
  values: Record<string, ProcessingValue>,
  bindings: SourceRefBindings = activeSourceBindings(model)
): FormValidationIssue[] {
  const validation = validateValues(model, values, bindings);
  sourceRefStates.value = validation.states;
  sourceRefTypes.value = validation.types;
  issues.value = validation.issues;
  return validation.issues;
}

// Returns only the parameters it staged, so the caller owns the merge.
//
// The literal 'seg.nrrd' name is required for segment names and colors to be
// embedded in the serialized output.
async function stageLabelmapInputs(
  p: ProcessingProvider,
  model: TaskFormModel,
  bindings: SourceRefBindings = activeSourceBindings(model)
): Promise<Record<string, ProcessingValue>> {
  const targets = Object.entries(bindings.labelmap.groups);
  if (targets.length === 0) return {};

  const staged = await Promise.all(
    targets.map(async ([parameterId, segmentGroupId]) => {
      const metadata = segmentGroupStore.metadataByID[segmentGroupId];
      const labelmap = segmentGroupStore.dataIndex[segmentGroupId];
      const referenceImage = labelmapReferenceImage(segmentGroupId);
      if (!referenceImage) {
        throw new Error(
          'Segment group reference image has no server provenance'
        );
      }
      const serialized = await writeSegmentation(
        'seg.nrrd',
        labelmap,
        metadata
      );
      const name = `${metadata.name}.seg.nrrd`;
      const uris = await p.stageInput({
        file: new Blob([serialized]),
        descriptor: {
          type: TYPE_TAG_LABELMAP,
          name,
          referenceImage: {
            ...referenceImage,
            type: 'image',
          },
        },
      });
      return [parameterId, mintLabelmapValue(uris)] as const;
    })
  );
  return Object.fromEntries(staged);
}

// The extension is what the CLI spec and the backend both match on, so the base
// name is the active image's without its own — compound extensions included, so
// `scan.nii.gz` stages as `scan.annotations.json`.
function annotationsFileName(): string {
  const name = activeImageName() ?? 'image';
  return `${stripExtension(name)}${ANNOTATIONS_FILE_EXTENSION}`;
}

// Everything the annotations file is made of, read off the stores in one
// synchronous pass so staging never mixes two images' state.
type AnnotationsPayload = {
  file: AnnotationsFile;
  name: string;
  referenceImage: InputValue | null;
};

function captureAnnotationsPayload(): AnnotationsPayload {
  return {
    file: encodeAnnotationsFile(annotationToolsView.value),
    name: annotationsFileName(),
    referenceImage: mintInputValue(activeDataSource()),
  };
}

// One file per bound parameter, holding every finished tool the active image
// had at Run. The image is its own reference image, so a volume without server
// provenance never gets here — the binder already refused it.
async function stageAnnotationInputs(
  p: ProcessingProvider,
  bindings: SourceRefBindings,
  payload: AnnotationsPayload | null
): Promise<Record<string, ProcessingValue>> {
  const [parameterId] = bindings.annotations.parameters;
  if (!parameterId || !payload) return {};
  const { file, name, referenceImage } = payload;

  if (!referenceImage) {
    throw new Error('The active image has no server provenance');
  }
  // The binder validated a live count; this is the encoded file's own count, so
  // a tool deleted between validation and Run cannot stage an empty file.
  if (annotationsFileCount(file) === 0) {
    throw new Error('The active image has no finished annotations');
  }

  const uris = await p.stageInput({
    file: new Blob([JSON.stringify(file)], { type: 'application/json' }),
    descriptor: {
      type: TYPE_TAG_ANNOTATIONS,
      name,
      referenceImage: {
        ...referenceImage,
        type: 'image',
      },
    },
  });
  return {
    [parameterId]: mintAnnotationsValue(uris),
  };
}

// Binding can fall back to the current image's sole group, so reading
// `paintStore.activeSegmentGroupID` directly would mislabel the job.
type SourceRefContext = {
  labelmapGroups: Record<string, string>;
  types: Record<string, BoundSourceRefType>;
  imageName: string | undefined;
  annotationCount: number;
};

// Resolved once per display pass: each binding re-runs a full field scan and
// group resolution, so per-field resolution would redo identical work.
function sourceRefContext(model: TaskFormModel): SourceRefContext {
  const bindings = activeSourceBindings(model);
  return {
    labelmapGroups: bindings.labelmap.groups,
    types: bindings.types,
    imageName: activeImageName(),
    annotationCount: finishedAnnotationCount.value,
  };
}

function boundLabelmapName(
  refs: SourceRefContext,
  parameterId: string
): string | undefined {
  const groupId = refs.labelmapGroups[parameterId];
  return groupId ? segmentGroupStore.metadataByID[groupId]?.name : undefined;
}

// The bound value is a whole set of tools rather than one named resource, so
// the count is the identifying part.
function boundAnnotationsName(refs: SourceRefContext): string {
  const noun = refs.annotationCount === 1 ? 'annotation' : 'annotations';
  const count = `${refs.annotationCount} ${noun}`;
  return refs.imageName ? `${count} on ${refs.imageName}` : count;
}

function boundSourceRefName(
  refs: SourceRefContext,
  parameterId: string
): string | undefined {
  const type = refs.types[parameterId];
  if (type === TYPE_TAG_LABELMAP) return boundLabelmapName(refs, parameterId);
  if (type === TYPE_TAG_ANNOTATIONS) return boundAnnotationsName(refs);
  return refs.imageName;
}

const sourceRefNames = computed(() => {
  const model = taskModel.value;
  if (!model) return {};
  const refs = sourceRefContext(model);
  const names: Record<string, string> = {};
  model.fields.forEach((field) => {
    if (field.kind !== 'sourceRef') return;
    const name = boundSourceRefName(refs, field.id);
    if (name) names[field.id] = name;
  });
  return names;
});

function formatProcessingValue(
  refs: SourceRefContext,
  field: VolViewTaskParameter,
  value: ProcessingValue
): string {
  if (field.kind === 'sourceRef') {
    if (refs.types[field.id] === TYPE_TAG_LABELMAP) {
      return boundLabelmapName(refs, field.id) ?? 'bound segment group';
    }
    if (refs.types[field.id] === TYPE_TAG_ANNOTATIONS) {
      return boundAnnotationsName(refs);
    }
    return refs.imageName ?? 'active dataset';
  }
  if (field.kind === 'bounds') {
    return Array.isArray(value) && value.length > 0
      ? value.map((n) => (typeof n === 'number' ? n.toFixed(1) : n)).join(', ')
      : 'not set';
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') {
    const input = value as InputValue;
    return input.type;
  }
  if (value === null || value === undefined || value === '') return 'not set';
  return String(value);
}

function isSummaryParameter(
  field: VolViewTaskParameter,
  value: ProcessingValue
): boolean {
  if (field.kind === 'sourceRef' || field.kind === 'bounds') return false;
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function buildJobDisplay(
  model: TaskFormModel,
  values: Record<string, ProcessingValue>
): SubmittedJobDisplay {
  const refs = sourceRefContext(model);
  let summaryCount = 0;
  const parameters: SubmittedJobParameterDisplay[] = model.fields.map(
    (field) => {
      const value = values[field.id];
      const summary = summaryCount < 2 && isSummaryParameter(field, value);
      if (summary) summaryCount += 1;
      return {
        id: field.id,
        label: fieldLabel(field),
        value: formatProcessingValue(refs, field, value),
        ...(summary ? { summary } : {}),
      };
    }
  );
  const inputName = refs.imageName;
  return {
    taskTitle: model.title,
    ...(inputName ? { inputName } : {}),
    parameters,
  };
}

// Debounced: dragging a crop handle mutates the crop planes every frame, and
// each rebind walks provenance and re-validates the whole form.
watchDebounced(
  () => {
    const id = currentImageID.value;
    return {
      id,
      crop: id ? cropStore.croppingByImageID[id] : undefined,
      activeSegmentGroup: paintStore.activeSegmentGroupID,
      groupCount: id ? (segmentGroupStore.orderByParent[id]?.length ?? 0) : 0,
      // Placing the first (or removing the last) tool flips the annotations
      // binding, so the form must revalidate.
      annotationCount: finishedAnnotationCount.value,
    };
  },
  () => {
    const model = taskModel.value;
    if (!model) return;
    const bindings = activeSourceBindings(model);
    const rebound = applyActiveBindings(model, currentValues.value, bindings);
    currentValues.value = rebound;
    refreshValidation(model, rebound, bindings);
  },
  { deep: true, debounce: 150 }
);

// The dedup seen-set lives in the store, so a job finishing while this tab is
// unmounted replays into a fresh subscription exactly once on remount.
let unsubscribe: (() => void) | null = null;

onMounted(() => {
  unsubscribe = providers.onJobComplete(({ status, context }) => {
    if (status.state === 'success' && context) {
      providers
        .applyJobResults({
          providerId: context.providerId,
          jobId: status.jobId,
        })
        .catch((err) => {
          console.error('Failed to auto-load results', err);
        });
    }
  });
});

onBeforeUnmount(() => {
  unsubscribe?.();
});
</script>

<style scoped>
.jobs-module {
  height: 100%;
  overflow: auto;
}
</style>
