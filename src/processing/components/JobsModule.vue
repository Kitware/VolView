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
          <v-icon class="mr-2">mdi-play-circle-outline</v-icon>
          <span>Run a Task</span>
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
  labelmapStageTargets,
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

// Both top-level sections start expanded; each collapses independently.
const openPanels = ref<string[]>(['run', 'jobs']);

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
// Per-`sourceRef`-param bind state, surfaced inline by FileWidget (input mint).
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

// UI event handlers only ASSIGN selectedProviderId / selectedTaskId; the two
// watchers below own all request lifecycle. Each watcher (a) clears state
// derived from the previous selection immediately, (b) takes a request-local
// `active` flag, (c) is invalidated through Vue watcher cleanup, and (d) commits
// provider/task/model/loading/error state only while still active AND while the
// selected id still matches — so a slower stale request can never clobber a
// newer selection's state (not even via its `finally`).

// One-line handler for the TaskPicker: assign only, never start a request.
function onTaskIdPicked(id: string | null) {
  selectedTaskId.value = id;
}

watch(
  selectedProviderId,
  async (id, _old, onCleanup) => {
    // Clear everything derived from the previous provider immediately
    // (ungated) — including the request lifecycle flags: a pending request's
    // gated `finally` never fires for a superseded selection, so without this
    // reset a cleared/failed selection leaks "loading" or a stale error.
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
        // Assign only — the selectedTaskId watcher loads the spec.
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

// ---------------------------------------------------------------------------
// Task spec → form model
//
// Fetch the server-emitted, zod-validated task spec and render the form from
// it. No XML is parsed at runtime; the engine hides any param it cannot type
// and refuses submit if a required one was hidden (fail closed).
// ---------------------------------------------------------------------------

watch(selectedTaskId, async (id, _old, onCleanup) => {
  // Clear the previous task's model AND its request lifecycle flags
  // immediately (ungated): a superseded request's gated `finally` never
  // resets them, so a cleared selection (or one whose provider has no tasks)
  // must not leave "Loading task spec…" or a previous error on screen.
  taskModel.value = null;
  loadingTask.value = false;
  taskError.value = null;
  if (!id || !provider.value) return;
  let active = true;
  onCleanup(() => {
    active = false;
  });
  // Pin the provider from this selection generation; a later provider change
  // clears selectedTaskId (re-running this watcher) and invalidates `active`.
  const activeProvider = provider.value;
  const current = () => active && selectedTaskId.value === id;
  loadingTask.value = true;
  taskError.value = null;
  try {
    const envelope = await activeProvider.getTaskSpec(id);
    if (!current()) return;
    const model = buildTaskFormModel(envelope);
    taskModel.value = model;
    // One provenance walk shared by both consumers below.
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
  // Snapshot the WHOLE submission context SYNCHRONOUSLY, before the first
  // await. Everything below — staging and submit alike — runs against these
  // locals only, so switching the provider, task, or active image while the
  // labelmap upload is pending can never splice a URI minted for provider A
  // into a submission against provider B (or attach the wrong image context).
  const submitProvider = provider.value;
  const providerId = selectedProviderId.value;
  const taskId = selectedTaskId.value;
  const model = taskModel.value;
  if (!submitProvider || !providerId || !taskId || !model) return;
  const activeDatasetId = currentImageID.value ?? undefined;

  // Mint the bound input value from the active
  // volume's OWN provenance at submit, then fail closed if anything is
  // unbindable or invalid — never submit a volume with no server URIs.
  const image = activeImageBinding(model);
  const finalValues = applyActiveBindings(model, values, image);
  const finalIssues = computeIssues(model, finalValues, image);
  if (finalIssues.length > 0) {
    currentValues.value = finalValues;
    issues.value = finalIssues;
    return;
  }
  // Part of the snapshot: display formatting reads the live active image and
  // segment-group selection, so it must render before the staging await too.
  const display = buildJobDisplay(model, finalValues);

  submitting.value = true;

  // Stage the bound segment group(s) for
  // backend-minted URIs BEFORE submit. A staging failure is not surfaced by the
  // store, so surface it here (fail loud) and abort before running the job.
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
    // Item 4: the failure is already surfaced by the store (message center);
    // swallow here only to reset `submitting` and avoid an unhandled rejection.
  } finally {
    submitting.value = false;
  }
}

// ---------------------------------------------------------------------------
// `bounds` binds from the crop tool
//
// A `bounds` parameter takes its value from the crop box of the active image,
// converted to a world-space LPS 6-tuple. It tracks the crop tool: re-binding
// whenever the active image or its crop box changes.
// ---------------------------------------------------------------------------

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
  // The binder authors EVERY bounds field on EVERY rebind: an active image
  // with no crop state resets to the task-spec default rather than silently
  // keeping the previous image's bounds.
  const defaults = world ? null : initialFormValues(model);
  const next = { ...values };
  model.fields.forEach((f) => {
    if (f.kind !== 'bounds') return;
    next[f.id] = world ? [...world] : (defaults?.[f.id] ?? null);
  });
  return next;
}

// ---------------------------------------------------------------------------
// Input binding
//
// The background image input auto-binds to the ACTIVE dataset: its value is
// minted from that volume's OWN provenance (its verbatim server URIs), never a
// backend-advertised source. A volume with no URI provenance (local drop /
// archive / restored state) is not bindable — the widget says so inline and
// submit is refused. Bounds and image inputs both track the active image, so
// they rebind together whenever it (or its crop box) changes.
// ---------------------------------------------------------------------------

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

// A pure read-only view of the segment-group store for the labelmap binder.
// The bound background is the active
// image, so the fallback chain + `parentImage` guard resolve against it.
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

// Mint the active dataset's image-input binding. Deliberately callable once per
// handler so `applyActiveBindings` and `computeIssues` can share ONE provenance
// walk instead of each re-authoring the value set (crop-drag frames call both).
function activeImageBinding(model: TaskFormModel): ImageBindingResult {
  return bindImageInputs(model, activeDataSource());
}

// Apply every active-image-derived binding (crop bounds + the minted image
// input) onto a base value set, overwriting only the bound params. The labelmap
// value is NOT set here: a segment group has no server provenance, so it earns
// URIs only at Run via the async staging POST (`stageLabelmapInputs`).
function applyActiveBindings(
  model: TaskFormModel,
  base: Record<string, ProcessingValue>,
  image: ImageBindingResult = activeImageBinding(model)
): Record<string, ProcessingValue> {
  const withBounds = applyBoundsBindings(model, base);
  return { ...withBounds, ...image.values };
}

// Recompute the submit-gating issues and refresh the per-widget bind state. The
// image and labelmap sourceRef params are gated by their binders (fail closed on
// no-provenance / no segment group / >1 input), which own them fully, so the
// generic per-param check is suppressed for them to avoid a duplicate "required"
// message. A no-provenance background blocks submit via the image binder even
// when a labelmap is resolvable — the labelmap flow is blocked "for free".
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

// The labelmap staging half, the ASYNC step. After the fail-closed gate
// passes, serialize each bound segment group to a compressed `seg.nrrd` (the
// literal 'seg.nrrd' token is required so `maybeBuildSegNrrdMetadata` embeds
// segment names/colors; gzip is automatic), POST it to the backend staging
// endpoint together with the parent image's opaque provenance, and mint
// `{ type:"labelmap", uris }` from the backend response. Two HTTP calls (stage,
// then run) sit behind one Run click; staging is automatic.
async function stageLabelmapInputs(
  p: ProcessingProvider,
  model: TaskFormModel,
  values: Record<string, ProcessingValue>
): Promise<Record<string, ProcessingValue>> {
  const targets = labelmapStageTargets(bindLabelmaps(model));
  if (targets.length === 0) return values;

  const staged = await Promise.all(
    targets.map(async ({ parameterId, segmentGroupId }) => {
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

// The segment group a labelmap sourceRef will ACTUALLY stage, from the same
// binder snapshot staging uses (including its sole-group fallback). Display
// must never read `paintStore.activeSegmentGroupID` directly: the active group
// can belong to another image while binding correctly falls back to the
// current image's sole group — naming the active group would mislabel the job.
function boundLabelmapName(
  model: TaskFormModel,
  parameterId: string
): string | undefined {
  const groupId = bindLabelmaps(model).groups[parameterId];
  return groupId ? segmentGroupStore.metadataByID[groupId]?.name : undefined;
}

// Display names for bound sourceRef inputs (param id → dataset / segment-group
// name), shown inline by FileWidget in place of a generic "bound" notice.
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
      // Same binder snapshot staging uses — never the raw active group id.
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

watch(
  () => {
    const id = currentImageID.value;
    return {
      id,
      crop: id ? cropStore.croppingByImageID[id] : undefined,
      // Refresh the labelmap widget state as the user paints / selects a group.
      activeSegmentGroup: paintStore.activeSegmentGroupID,
      groupCount: id ? (segmentGroupStore.orderByParent[id]?.length ?? 0) : 0,
    };
  },
  () => {
    const model = taskModel.value;
    if (!model) return;
    // One provenance walk shared by both consumers below.
    const image = activeImageBinding(model);
    const rebound = applyActiveBindings(model, currentValues.value, image);
    initialValues.value = rebound;
    currentValues.value = { ...rebound };
    issues.value = computeIssues(model, rebound, image);
  },
  { deep: true }
);

// ---------------------------------------------------------------------------
// Result loading + completion messages
//
// The dedup seen-set lives in the store: a job that finishes
// while this tab is unmounted replays into a fresh subscription exactly once on
// remount, so no completion handling is lost across a tab switch.
// ---------------------------------------------------------------------------

let unsubscribe: (() => void) | null = null;

onMounted(() => {
  unsubscribe = providers.onJobComplete(
    ({ status, results, context, baseImageMissing }) => {
      if (status.state === 'success') {
        // Auto-load supported result intents: plain images become new Data
        // entries, and labelmaps attach to the submitted parent image. If that
        // parent was closed mid-job, strip it from the context so labelmaps skip
        // while plain images can still open.
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
