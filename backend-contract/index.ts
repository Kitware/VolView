// ---------------------------------------------------------------------------
// backend-contract — the neutral VolView backend contract, published as an
// artifact.
//
// The zod sources in this package are the single normative definition of the
// wire shapes. The golden JSON fixtures under `fixtures/` are the interchange
// format BOTH suites pin: the VolView client validates them with the zod
// schemas here; the girder_volview backend validates them against JSON Schemas
// generated from these same zod sources. One definition, two validators.
// ---------------------------------------------------------------------------

export * from './processing';
