import { z } from 'zod';
import { isRecord, zodEnumFromObjKeys } from '@/src/utils';
import { ACTIONS } from '@/src/constants';

import { useRectangleStore } from '@/src/store/tools/rectangles';
import { useRulerStore } from '@/src/store/tools/rulers';
import { usePolygonStore } from '@/src/store/tools/polygons';
import { useViewStore } from '@/src/store/views';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import { actionToKey } from '@/src/composables/useKeyboardShortcuts';
import { useSegmentGroupStore } from '@/src/store/segmentGroups';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import useLoadDataStore from '@/src/store/load-data';
import { layoutConfig } from '@/src/utils/layoutParsing';

// --------------------------------------------------------------------------
// Layout

const layouts = z.record(z.string(), layoutConfig).optional();

// --------------------------------------------------------------------------
// Keyboard shortcuts

const shortcuts = z
  .partialRecord(zodEnumFromObjKeys(ACTIONS), z.string())
  .optional();

// --------------------------------------------------------------------------
// Labels

const color = z.string();

const label = z.object({
  color,
  strokeWidth: z.number().optional(),
});

const rulerLabel = label;
const polygonLabel = label;

const rectangleLabel = z.intersection(
  label,
  z.object({
    fillColor: color,
  })
);

const labels = z
  .object({
    defaultLabels: z.record(z.string(), label).or(z.null()).optional(),
    rulerLabels: z.record(z.string(), rulerLabel).or(z.null()).optional(),
    rectangleLabels: z
      .record(z.string(), rectangleLabel)
      .or(z.null())
      .optional(),
    polygonLabels: z.record(z.string(), polygonLabel).or(z.null()).optional(),
  })
  .optional();

// --------------------------------------------------------------------------
// IO

const io = z
  .object({
    segmentGroupSaveFormat: z.string().optional(),
    segmentGroupExtension: z.string().default(''),
    layerExtension: z.string().default(''),
  })
  .optional();

// --------------------------------------------------------------------------
// Window Level

const windowing = z
  .object({
    level: z.number(),
    width: z.number(),
  })
  .optional();

const disabledViewTypes = z.array(z.enum(['2D', '3D', 'Oblique'])).optional();

export const config = z.object({
  layouts,
  labels,
  shortcuts,
  io,
  windowing,
  disabledViewTypes,
});

export type Config = z.infer<typeof config>;

// ---------------------------------------------------------------------------
// Config-by-shape recognition
//
// Config can arrive via any channel (launch manifest, dropped file, or a
// `urls=` entry) — it's recognized purely by shape. Trust for the
// `processing` section attaches later, to the provider's origin (see
// io/originGate), not to how the config arrived.
//
// Unknown top-level keys are tolerated (stripped, reported via
// `ignoredKeys`) so a newer config still degrades gracefully on an older
// client. Known section values are always strictly validated — the trust
// boundary is on values, not top-level keys:
//   - no known keys        => data (plain import)
//   - known + unknown keys => config; ignoredKeys lists the stripped keys
//   - only known keys      => config; ignoredKeys empty

export type ConfigRecognition =
  // `ignoredKeys` lists the unknown top-level keys that were stripped (empty
  // when every top-level key was a known section).
  { kind: 'config'; config: Config; ignoredKeys: string[] } | { kind: 'data' };

// ---------------------------------------------------------------------------
// Config-section registry
//
// Feature modules contribute their own top-level config section (schema +
// apply) instead of this file naming each feature. A feature registers from
// its public entry point at module-evaluation time, which runs before any
// config file can be recognized (recognition is triggered by data import,
// after boot).

export type ConfigSection<S extends z.ZodType = z.ZodType> = {
  key: string;
  schema: S;
  apply: (value: z.output<S>) => void | Promise<void>;
};

// Keyed by section key so re-registration (e.g. a test's fresh module graph)
// stays idempotent.
const configSections = new Map<string, ConfigSection>();

export const registerConfigSection = <S extends z.ZodType>(
  section: ConfigSection<S>
) => {
  configSections.set(section.key, section as unknown as ConfigSection);
};

// Base sections + every registered section define the known top-level keys.
const fullConfigSchema = () =>
  config.extend(
    Object.fromEntries(
      [...configSections.values()].map((section) => [
        section.key,
        section.schema,
      ])
    )
  );

export const recognizeConfig = async (
  raw: unknown
): Promise<ConfigRecognition> => {
  if (!isRecord(raw)) return { kind: 'data' };

  const fullConfig = fullConfigSchema();
  const knownKeys = new Set(Object.keys(fullConfig.shape));

  const presentKeys = Object.keys(raw);
  const knownPresent = presentKeys.filter((key) => knownKeys.has(key));
  // No config signal at all — a plain data JSON. Falls through silently so a
  // stray data file is not announced as config.
  if (knownPresent.length === 0) return { kind: 'data' };

  // `fullConfig.parse` relies on zod's default (non-strict) object behavior to
  // drop unknown keys; adding `.strict()` would silently break forward-compat.
  const ignoredKeys = presentKeys.filter((key) => !knownKeys.has(key));
  return { kind: 'config', config: fullConfig.parse(raw), ignoredKeys };
};

export const recognizeConfigFile = async (
  file: File
): Promise<ConfigRecognition> => {
  return recognizeConfig(JSON.parse(await file.text()));
};

const applyLabels = (manifest: Config) => {
  if (!manifest.labels) return;

  // pass through null labels, use fallback labels if undefined
  const defaultLabelsIfUndefined = <T>(toolLabels: T) => {
    if (toolLabels === undefined) return manifest.labels?.defaultLabels;
    return toolLabels;
  };

  const applyLabelsToStore = (
    store: AnnotationToolStore,
    maybeLabels: (typeof manifest.labels)[keyof typeof manifest.labels]
  ) => {
    const labelsOrFallback = defaultLabelsIfUndefined(maybeLabels);
    if (!labelsOrFallback) return;
    store.clearDefaultLabels();
    store.mergeLabels(labelsOrFallback);
  };

  const { rulerLabels, rectangleLabels, polygonLabels } = manifest.labels;
  applyLabelsToStore(useRulerStore(), rulerLabels);
  applyLabelsToStore(useRectangleStore(), rectangleLabels);
  applyLabelsToStore(usePolygonStore(), polygonLabels);
};

const applyLayout = (manifest: Config) => {
  if (!manifest.layouts) return;

  const viewStore = useViewStore();
  const layoutEntries = Object.entries(manifest.layouts);

  if (layoutEntries.length === 0) return;

  viewStore.setNamedLayoutsFromConfig(manifest.layouts);

  const firstLayoutName = layoutEntries[0][0];
  viewStore.switchToNamedLayout(firstLayoutName);
};

const applyShortcuts = (manifest: Config) => {
  if (!manifest.shortcuts) return;

  actionToKey.value = {
    ...actionToKey.value,
    ...manifest.shortcuts,
  };
};

const applyIo = (manifest: Config) => {
  if (!manifest.io) return;

  if (manifest.io.segmentGroupSaveFormat)
    useSegmentGroupStore().saveFormat = manifest.io.segmentGroupSaveFormat;
  const loadDataStore = useLoadDataStore();
  loadDataStore.segmentGroupExtension = manifest.io.segmentGroupExtension;
  loadDataStore.layerExtension = manifest.io.layerExtension;
};

const applyWindowing = (manifest: Config) => {
  if (!manifest.windowing) return;

  useWindowingStore().runtimeConfigWindowLevel = manifest.windowing;
};

const applyDisabledViewTypes = (manifest: Config) => {
  if (!manifest.disabledViewTypes) return;

  useViewStore().disabledViewTypes = manifest.disabledViewTypes;
};

// Registered sections are independent of one another, so apply concurrently.
const applyRegisteredSections = (manifest: Config) =>
  Promise.all(
    [...configSections.values()].map((section) =>
      section.apply((manifest as Record<string, unknown>)[section.key])
    )
  );

export const applyPreStateConfig = async (manifest: Config) => {
  applyDisabledViewTypes(manifest);
  applyLayout(manifest);
  applyShortcuts(manifest);
  applyIo(manifest);
  applyWindowing(manifest);
  await applyRegisteredSections(manifest);
};

export const applyPostStateConfig = (manifest: Config) => {
  applyLabels(manifest);
};
