// ---------------------------------------------------------------------------
// processing/ — the processing slice (task discovery, inputs, job lifecycle,
// results) of the neutral VolView backend contract.
//
// The zod sources in this slice are the single normative definition of the
// task spec and the neutral wire shapes. The golden JSON fixtures under
// `../fixtures/` are the interchange format BOTH suites pin: the VolView
// client validates them with the zod schemas here; the girder_volview backend
// validates them against a JSON Schema generated from these same zod sources
// (see `schema-json.ts`). One definition, two validators.
// ---------------------------------------------------------------------------

export * from './task-spec';
export * from './wire';
