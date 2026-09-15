import { z } from 'zod';
import { configIo } from '@/src/io/import/configIo';
import {
  getEntries,
  isRecord,
  partition,
  plural,
  zodEnumFromObjKeys,
} from '@/src/utils';
import { ACTIONS } from '@/src/constants';
import type { Action, Binding } from '@/src/constants';

import { useMessageStore } from '@/src/store/messages';
import { useSegmentStore } from '@/src/segmentation/segments';
import { tryCssColorToRGBA } from '@/src/segmentation/color';
import { useViewStore } from '@/src/store/views';
import { useWindowingStore } from '@/src/store/view-configs/windowing';
import {
  actionToKey,
  bindingsOf,
  isDispatchable,
} from '@/src/composables/useKeyboardShortcuts';
import { surfaceWarning } from '@/src/store/messages';
import { useSegmentationStore } from '@/src/segmentation/store';
import useLoadDataStore from '@/src/store/load-data';
import { layoutConfig } from '@/src/utils/layoutParsing';

// --------------------------------------------------------------------------
// Layout

const layouts = z.record(z.string(), layoutConfig).optional();

// --------------------------------------------------------------------------
// Keyboard shortcuts

const bindingSchema = z.union([z.string(), z.array(z.string())]);

const shortcuts = z
  .partialRecord(zodEnumFromObjKeys(ACTIONS), bindingSchema)
  .optional();

// --------------------------------------------------------------------------
// SegmentMask types

// Every appearance field is optional and absent means the app default, so a
// configured segment states only what it changes.
const segment = z.object({
  color: z.string().optional(),
  fillOpacity: z.number().optional(),
  outlineOpacity: z.number().optional(),
  strokeWidth: z.number().optional(),
});

// Keyed by name. Omitted leaves the registry alone; an empty record or null
// clears what an earlier config contributed.
const segmentRecord = z.record(z.string(), segment).or(z.null()).optional();

const segments = segmentRecord;

// Pre-7.0 configs named one label record per tool, plus a fallback record.
// The four describe the one registry now, so they read as `segments`. A
// rectangle label's `fillColor` belongs to the rectangle rather than to the
// segment and is dropped.
const legacyLabel = z.object({
  color: z.string(),
  strokeWidth: z.number().optional(),
});

const legacyLabelRecord = z
  .record(z.string(), legacyLabel)
  .or(z.null())
  .optional();

const labels = z
  .object({
    defaultLabels: legacyLabelRecord,
    rulerLabels: legacyLabelRecord,
    rectangleLabels: legacyLabelRecord,
    polygonLabels: legacyLabelRecord,
  })
  .optional();

// --------------------------------------------------------------------------
// IO

const io = configIo.optional();

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
  segments,
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
  | {
      kind: 'config';
      config: Config;
      ignoredKeys: string[];
      deprecatedKeys: string[];
    }
  | { kind: 'data' };

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
  const deprecatedKeys =
    isRecord(raw.io) && raw.io.segmentGroupExtension !== undefined
      ? ['io.segmentGroupExtension']
      : [];
  return {
    kind: 'config',
    config: fullConfig.parse(raw),
    ignoredKeys,
    deprecatedKeys,
  };
};

export const recognizeConfigFile = async (
  file: File
): Promise<ConfigRecognition> => {
  return recognizeConfig(JSON.parse(await file.text()));
};

// One registry backs every tool, so a name in more than one record is one
// segment and the record that declares it first sets its appearance, as a
// migrated session resolves it. `defaultLabels` is read last because it stood
// in only for the tools that declared no record of their own.
const segmentsFromLabels = (legacy: NonNullable<Config['labels']>) =>
  [
    legacy.rulerLabels,
    legacy.rectangleLabels,
    legacy.polygonLabels,
    legacy.defaultLabels,
  ].reduce<NonNullable<Config['segments']>>(
    (merged, record) => ({
      ...merged,
      ...Object.fromEntries(
        Object.entries(record ?? {}).filter(([name]) => !(name in merged))
      ),
    }),
    {}
  );

// `segments` states the whole registry, so a config carrying both has been
// converted and the legacy section is spent.
const configuredSegments = (manifest: Config) => {
  if (manifest.segments !== undefined) return manifest.segments;
  if (manifest.labels === undefined) return undefined;
  return segmentsFromLabels(manifest.labels);
};

// A colour the parser does not know would otherwise resolve to opaque black,
// which reads as a deliberate choice. Reported here, at the boundary that owns
// the file, naming the segment and what it said.
const reportUnparseableColors = (
  configured: NonNullable<Config['segments']>
) => {
  const bad = Object.entries(configured).flatMap(([name, props]) =>
    props.color && tryCssColorToRGBA(props.color) === undefined
      ? [`${name} (${props.color})`]
      : []
  );
  if (bad.length === 0) return;
  useMessageStore().addError(
    `Unrecognized ${plural(bad.length, 'color')} in config: ${bad.join(', ')}. ` +
      'Use a hex value such as #d60000, or a CSS color keyword.'
  );
};

// An omitted section leaves the registry alone; an empty record or null
// clears what an earlier config contributed to it.
const applySegments = (manifest: Config) => {
  const configured = configuredSegments(manifest);
  if (configured === undefined) return;
  if (configured) reportUnparseableColors(configured);
  useSegmentStore().segments.replaceConfigSegments(configured);
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

/**
 * Drops the bindings that could never fire, keeping the rest of the config.
 * A shortcut that does nothing is worth a warning, not a rejected file.
 */
const dispatchableShortcuts = (
  configured: NonNullable<Config['shortcuts']>
) => {
  const perAction = getEntries(configured).flatMap(([action, binding]) =>
    binding
      ? [[action, partition(isDispatchable, bindingsOf(binding))] as const]
      : []
  );

  const undispatchable = perAction.flatMap(([, [, rejected]]) => rejected);
  if (undispatchable.length) {
    const noun = plural(undispatchable.length, 'shortcut');
    surfaceWarning(
      'Unbindable shortcut',
      `Ignored unbindable ${noun}: ${undispatchable.join(', ')}. ` +
        'The characters + - and _ separate the keys of a chord.'
    );
  }

  return Object.fromEntries(
    perAction
      .filter(([, [usable]]) => usable.length)
      .map(([action, [usable]]) => [action, usable])
  ) as Partial<Record<Action, Binding>>;
};

const applyShortcuts = (manifest: Config) => {
  if (!manifest.shortcuts) return;

  actionToKey.value = {
    ...actionToKey.value,
    ...dispatchableShortcuts(manifest.shortcuts),
  };
};

const applyIo = (manifest: Config) => {
  if (!manifest.io) return;

  if (manifest.io.segmentGroupSaveFormat)
    useSegmentationStore().saveFormat = manifest.io.segmentGroupSaveFormat;
  const loadDataStore = useLoadDataStore();
  loadDataStore.segmentationExtension = manifest.io.segmentationExtension;
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
  applySegments(manifest);
};
