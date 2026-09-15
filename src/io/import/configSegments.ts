import { z } from 'zod';

// Every appearance field is optional and absent means the app default, so a
// configured segment states only what it changes.
const segment = z.object({
  color: z.string().optional(),
  fillOpacity: z.number().optional(),
  outlineOpacity: z.number().optional(),
  strokeWidth: z.number().optional(),
});

// Keyed by segment name.
export const segments = z.record(z.string(), segment).or(z.null()).optional();

export type ConfiguredSegments = NonNullable<z.output<typeof segments>>;

// Legacy per-tool label records all describe the one registry now.
const legacyLabel = z.object({
  color: z.string(),
  strokeWidth: z.number().optional(),
});

const legacyLabelRecord = z
  .record(z.string(), legacyLabel)
  .or(z.null())
  .optional();

export const labels = z
  .object({
    defaultLabels: legacyLabelRecord,
    rulerLabels: legacyLabelRecord,
    rectangleLabels: legacyLabelRecord,
    polygonLabels: legacyLabelRecord,
  })
  .optional();

type LegacyLabels = NonNullable<z.output<typeof labels>>;

// `defaultLabels` stood in for a tool that declared no record of its own, so
// it counts only while some tool lacks one, and is read last.
const legacyRecords = ({
  rulerLabels,
  rectangleLabels,
  polygonLabels,
  defaultLabels,
}: LegacyLabels) => {
  const toolRecords = [rulerLabels, rectangleLabels, polygonLabels];
  return toolRecords.includes(undefined)
    ? [...toolRecords, defaultLabels]
    : toolRecords;
};

// First declaration wins, as a migrated session resolves it; all-null records
// change nothing.
const segmentsFromLabels = (legacy: LegacyLabels = {}) => {
  const records = legacyRecords(legacy);
  if (records.every((record) => !record)) return undefined;
  return records.reduce<ConfiguredSegments>(
    (merged, record) => ({
      ...merged,
      ...Object.fromEntries(
        Object.entries(record ?? {}).filter(
          ([name]) => !Object.hasOwn(merged, name)
        )
      ),
    }),
    {}
  );
};

// A canonical section, including null or an empty record, outranks legacy
// labels.
export function normalizeSegmentConfig<
  T extends {
    segments?: z.output<typeof segments>;
    labels?: z.output<typeof labels>;
  },
>({ labels: legacy, ...config }: T) {
  return {
    ...config,
    segments:
      config.segments !== undefined
        ? config.segments
        : segmentsFromLabels(legacy),
  };
}
