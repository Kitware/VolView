import { z } from 'zod';

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

export const segments = segmentRecord;

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

export const labels = z
  .object({
    defaultLabels: legacyLabelRecord,
    rulerLabels: legacyLabelRecord,
    rectangleLabels: legacyLabelRecord,
    polygonLabels: legacyLabelRecord,
  })
  .optional();

// One registry backs every tool, so a name in more than one record is one
// segment and the record that declares it first sets its appearance, as a
// migrated session resolves it. `defaultLabels` is read last because it stood
// in only for the tools that declared no record of their own.
const segmentsFromLabels = (legacy: NonNullable<z.output<typeof labels>>) =>
  [
    legacy.rulerLabels,
    legacy.rectangleLabels,
    legacy.polygonLabels,
    legacy.defaultLabels,
  ].reduce<NonNullable<z.output<typeof segments>>>(
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

// A canonical section, including null or an empty record, outranks legacy labels.
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
        : legacy === undefined
          ? undefined
          : segmentsFromLabels(legacy),
  };
}
