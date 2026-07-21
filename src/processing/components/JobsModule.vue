<template>
  <div class="jobs-module">
    <div
      v-if="providers.providerCount === 0"
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
          <div v-else-if="providerError" class="text-error text-caption">
            {{ providerError }}
          </div>

          <template v-if="provider">
            <TaskPicker
              v-if="tasks.length"
              :tasks="tasks"
              :model-value="selectedTaskId"
              :disabled="submitting"
              @update:task-id="onTaskIdPicked"
              class="mb-3"
            />
            <div v-else class="text-caption text-medium-emphasis mb-3">
              No tasks available.
            </div>

            <div v-if="loadingTask" class="text-caption">
              Loading task spec…
            </div>
            <div v-else-if="taskError" class="text-error text-caption">
              {{ taskError }}
            </div>
            <TaskForm
              v-else-if="taskModel"
              :model="taskModel"
              :initial-values="initialValues"
              :issues="issues"
              :source-ref-states="sourceRefStates"
              :source-ref-names="sourceRefNames"
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
          <span>Jobs</span>
          <span
            v-if="historyCount > 0"
            class="text-caption text-medium-emphasis ml-2"
          >
            {{ historyCount }} in history
          </span>
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
import { watchDebounced } from '@vueuse/core';

import { useProcessingJobsStore } from '@/src/processing/store';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { useDatasetStore } from '@/src/store/datasets';
import { useCropStore } from '@/src/store/tools/crop';
import { autoLoadProcessingResults } from '@/src/processing/applyResults';
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
import {
  bindImageInputs,
  type ImageBindingResult,
  type SourceRefBindingState,
} from '@/src/processing/engine/mintInput';
import {
  bindLabelmapInputs,
  mintLabelmapValue,
  mintLabelmapReferenceImage,
  type SegmentGroupView,
} from '@/src/processing/engine/mintLabelmap';
import { cropPlanesToWorldBounds } from '@/src/processing/engine/bounds';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { useMessageStore } from '@/src/store/messages';
import { writeSegmentation } from '@/src/io/readWriteImage';
import { getDataSourceName } from '@/src/io/import/dataSource';
import type { InputValue, VolViewTaskParameter } from '@/backend-contract';
import { TYPE_TAG_LABELMAP } from '@/backend-contract';

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

const historyCount = computed(() => providers.jobHistoryRows.length);

const providerItems = computed(() =>
  Array.from(providers.configs.values()).map((c) => ({
    id: c.id,
    label: c.label,
  }))
);
const showProviderSelect = computed(() => providerItems.value.length > 1);

const selectedProviderId = ref<string | null>(
  providerItems.value[0]?.id ?? null
);

const provider = ref<ProcessingProvider | null>(null);
const loadingProvider = ref(false);
const providerError = ref<string | null>(null);

const tasks = ref<TaskSummary[]>([]);
const selectedTaskId = ref<string | null>(null);

const taskModel = ref<TaskFormModel | null>(null);
const loadingTask = ref(false);
const taskError = ref<string | null>(null);
const initialValues = ref<Record<string, ProcessingValue>>({});
const currentValues = ref<Record<string, ProcessingValue>>({});
const issues = ref<FormValidationIssue[]>([]);
const sourceRefStates = ref<Record<string, SourceRefBindingState>>({});
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

function onTaskIdPicked(id: string | null) {
  selectedTaskId.value = id;
}

watch(
  selectedProviderId,
  async (id, _old, onCleanup) => {
    // Ungated reset: a superseded request's gated finally never runs.
    provider.value = null;
    tasks.value = [];
    taskModel.value = null;
    selectedTaskId.value = null;
    loadingProvider.value = false;
    providerError.value = null;
    if (!id) return;
    let active = true;
    onCleanup(() => {
      active = false;
    });
    const current = () => active && selectedProviderId.value === id;
    loadingProvider.value = true;
    providerError.value = null;
    try {
      const p = await providers.getProvider(id);
      if (!current()) return;
      provider.value = p;
      const loaded = await p.listTasks();
      if (!current()) return;
      tasks.value = loaded;
      if (tasks.value.length > 0) {
        selectedTaskId.value = tasks.value[0].id;
      }
    } catch (err) {
      if (!current()) return;
      providerError.value = (err as Error).message;
    } finally {
      if (current()) loadingProvider.value = false;
    }
  },
  { immediate: true }
);

watch(selectedTaskId, async (id, _old, onCleanup) => {
  taskModel.value = null;
  loadingTask.value = false;
  taskError.value = null;
  if (!id || !provider.value) return;
  let active = true;
  onCleanup(() => {
    active = false;
  });
  // A later provider change clears selectedTaskId and invalidates `active`.
  const activeProvider = provider.value;
  const current = () => active && selectedTaskId.value === id;
  loadingTask.value = true;
  taskError.value = null;
  try {
    const envelope = await activeProvider.getTaskSpec(id);
    if (!current()) return;
    const model = buildTaskFormModel(envelope);
    taskModel.value = model;
    const image = activeImageBinding(model);
    const initial = applyActiveBindings(model, initialFormValues(model), image);
    initialValues.value = initial;
    currentValues.value = { ...initial };
    issues.value = computeIssues(model, initial, image);
  } catch (err) {
    if (!current()) return;
    taskError.value = (err as Error).message;
  } finally {
    if (current()) loadingTask.value = false;
  }
});

function onValuesUpdate(values: Record<string, ProcessingValue>) {
  currentValues.value = values;
  if (!taskModel.value) return;
  issues.value = computeIssues(taskModel.value, values);
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

  const image = activeImageBinding(model);
  const finalValues = applyActiveBindings(model, values, image);
  const finalIssues = computeIssues(model, finalValues, image);
  if (finalIssues.length > 0) {
    currentValues.value = finalValues;
    issues.value = finalIssues;
    return;
  }
  // Display formatting reads live active image and segment-group state, so it
  // must render before the staging await.
  const display = buildJobDisplay(model, finalValues);

  submitting.value = true;

  // The store does not surface staging failures, so report them here.
  let stagedValues: Record<string, ProcessingValue>;
  try {
    stagedValues = await stageLabelmapInputs(
      submitProvider,
      model,
      finalValues
    );
  } catch (err) {
    messageStore.addError('Failed to stage segment group input', {
      error: err instanceof Error ? err : undefined,
    });
    submitting.value = false;
    return;
  }

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

function bindLabelmaps(model: TaskFormModel) {
  return bindLabelmapInputs(
    model,
    currentImageID.value ?? undefined,
    paintStore.activeSegmentGroupID,
    segmentGroupView()
  );
}

function labelmapReferenceImage(segmentGroupId: string): InputValue | null {
  return mintLabelmapReferenceImage(
    segmentGroupId,
    segmentGroupView(),
    (imageId) => datasetStore.getDataSource(imageId)
  );
}

// Callable once per handler so `applyActiveBindings` and `computeIssues` can
// share one provenance walk; crop-drag frames call both.
function activeImageBinding(model: TaskFormModel): ImageBindingResult {
  return bindImageInputs(model, activeDataSource());
}

// The labelmap value is not set here: a segment group has no server provenance,
// so it earns URIs only at Run via `stageLabelmapInputs`.
function applyActiveBindings(
  model: TaskFormModel,
  base: Record<string, ProcessingValue>,
  image: ImageBindingResult = activeImageBinding(model)
): Record<string, ProcessingValue> {
  const withBounds = applyBoundsBindings(model, base);
  return { ...withBounds, ...image.values };
}

// Binder-owned sourceRef params are excluded from the generic check so they do
// not also report a duplicate "required" message.
function computeIssues(
  model: TaskFormModel,
  values: Record<string, ProcessingValue>,
  image: ImageBindingResult = activeImageBinding(model)
): FormValidationIssue[] {
  const labelmap = bindLabelmaps(model);
  const labelmapIssues = [...labelmap.issues];
  for (const [parameterId, segmentGroupId] of Object.entries(labelmap.groups)) {
    if (!labelmapReferenceImage(segmentGroupId)) {
      labelmap.states[parameterId] = 'no-provenance';
      labelmapIssues.push({
        parameter: parameterId,
        message:
          'The segment group reference image was not loaded from the server, so it cannot be used as an input.',
      });
    }
  }
  sourceRefStates.value = { ...image.states, ...labelmap.states };
  const boundParams = new Set([
    ...Object.keys(image.states),
    ...Object.keys(labelmap.states),
  ]);
  const generic = validateFormValues(model, values).filter(
    (i) => !boundParams.has(i.parameter)
  );
  return [...image.issues, ...labelmapIssues, ...generic];
}

// The literal 'seg.nrrd' name is required for segment names and colors to be
// embedded in the serialized output.
async function stageLabelmapInputs(
  p: ProcessingProvider,
  model: TaskFormModel,
  values: Record<string, ProcessingValue>
): Promise<Record<string, ProcessingValue>> {
  const targets = Object.entries(bindLabelmaps(model).groups);
  if (targets.length === 0) return values;

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
  return { ...values, ...Object.fromEntries(staged) };
}

// Binding can fall back to the current image's sole group, so reading
// `paintStore.activeSegmentGroupID` directly would mislabel the job.
function boundLabelmapName(
  model: TaskFormModel,
  parameterId: string
): string | undefined {
  const groupId = bindLabelmaps(model).groups[parameterId];
  return groupId ? segmentGroupStore.metadataByID[groupId]?.name : undefined;
}

const sourceRefNames = computed(() => {
  const model = taskModel.value;
  if (!model) return {};
  const names: Record<string, string> = {};
  model.fields.forEach((field) => {
    if (field.kind !== 'sourceRef') return;
    if (field.accepts.includes(TYPE_TAG_LABELMAP)) {
      const name = boundLabelmapName(model, field.id);
      if (name) names[field.id] = name;
    } else {
      const name = activeImageName();
      if (name) names[field.id] = name;
    }
  });
  return names;
});

function formatProcessingValue(
  model: TaskFormModel,
  field: VolViewTaskParameter,
  value: ProcessingValue
): string {
  if (field.kind === 'sourceRef') {
    if (field.accepts.includes(TYPE_TAG_LABELMAP)) {
      return boundLabelmapName(model, field.id) ?? 'bound segment group';
    }
    return activeImageName() ?? 'active dataset';
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
  let summaryCount = 0;
  const parameters: SubmittedJobParameterDisplay[] = model.fields.map(
    (field) => {
      const value = values[field.id];
      const summary = summaryCount < 2 && isSummaryParameter(field, value);
      if (summary) summaryCount += 1;
      return {
        id: field.id,
        label: fieldLabel(field),
        value: formatProcessingValue(model, field, value),
        ...(summary ? { summary } : {}),
      };
    }
  );
  const inputName = activeImageName();
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
    };
  },
  () => {
    const model = taskModel.value;
    if (!model) return;
    const image = activeImageBinding(model);
    const rebound = applyActiveBindings(model, currentValues.value, image);
    initialValues.value = rebound;
    currentValues.value = { ...rebound };
    issues.value = computeIssues(model, rebound, image);
  },
  { deep: true, debounce: 150 }
);

// The dedup seen-set lives in the store, so a job finishing while this tab is
// unmounted replays into a fresh subscription exactly once on remount.
let unsubscribe: (() => void) | null = null;

onMounted(() => {
  unsubscribe = providers.onJobComplete(
    ({ status, results, context, baseImageMissing }) => {
      if (status.state === 'success') {
        const autoContext =
          baseImageMissing && context
            ? { ...context, activeDatasetId: undefined }
            : context;
        autoLoadProcessingResults(results, autoContext).catch((err) => {
          console.error('Failed to auto-load results', err);
        });
      }
    }
  );
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
