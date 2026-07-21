# Deferred review cleanups (just-jobs branch)

A review pass of `git diff main...HEAD` fixed the correctness findings and easy cleanups
(commit `27d9dcfe`). Five refactor findings were deferred as riskier; they are cleanups,
not bug fixes — behavior must not change. Evaluate each, apply the worthwhile ones, drop
the rest with a stated reason.

## Deferred findings

1. **TaskForm keeps a third copy of the form values** — `src/processing/components/TaskForm.vue`
   (~line 109). `values` is a local ref seeded from `props.initialValues` and re-synced by a
   `{ deep: true }` watch, alongside JobsModule's `initialValues` and `currentValues`
   (`src/processing/components/JobsModule.vue` ~line 180). Three synced copies of the same
   state. The clean fix is probably making TaskForm fully controlled (v-model on a single
   source of truth in JobsModule) — but that changes the update flow both directions, so
   trace who writes `currentValues` (the crop-box/bounds binding authors its value at
   submit) before touching it.

2. **Dev-only dangling-reference audit hand-walks every store's manifest shape** —
   `src/io/state-file/serialize.ts` (~line 191). It special-cases views, three tool types,
   crop, paint, selections, and layout — a fragile list layered on the remove-cascade
   invariant. A redesign would derive the audit from the manifest schema instead of
   enumerating shapes. Dev-only code: low risk, low payoff — judge whether it's worth it.

3. **`computeIssues` mutates component state as a hidden side effect** —
   `src/processing/components/JobsModule.vue` (~line 438). It writes `sourceRefStates.value`
   while being named and used as a pure computation. Split the state write out of the
   computation or restructure so the side effect is explicit. Check every caller — the
   write is load-bearing for FileWidget's `binding` prop.

4. **`boundLabelmapName` re-runs full labelmap binding resolution repeatedly** —
   `src/processing/components/JobsModule.vue` (~line 498). It re-invokes `bindLabelmaps`
   once per sourceRef field, per render of `sourceRefNames`, and per `buildJobDisplay`
   parameter. Memoize (a `computed` keyed on the inputs) if the resolution is genuinely
   hot; eyeball the call graph first.

5. **Parent-image-gone fallback implemented three times** — the "clear `activeDatasetId`
   when the base image left the scene" check lives in `JobList.loadResults`
   (`src/processing/components/JobList.vue` ~line 405), `JobsModule.onJobComplete`, and
   `store.baseImageMissing` (`src/processing/store.ts` ~line 400). Extract one helper
   (probably on the store, next to `baseImageMissing`) and use it at all three sites.
   Likely the best value of the five.

Considered and rejected: replacing the store's local `errorMessage` helper
(`src/processing/store.ts` ~line 56) with `getErrorDetail`/`ensureError` from
`src/utils/index.ts` — their fallback semantics differ (`String(err)` vs. required
fallback), so it isn't a drop-in and the helper is two lines.

## Notes

- Prefer inferred types (`computed(() => ...)`, not `computed<T>(() => ...)`) and a
  functional style, matching the surrounding code.
- The ungated `?save=` URL param and `$fetch` attaching the bearer to every request are
  intentional; do not "fix" them.
- `fetchAndRecordResults` and `expireSessionIf` were just added to
  `src/processing/store.ts` — build on them, don't duplicate.

## Verification

- `npx vue-tsc --noEmit`
- `npx vitest run` (green at baseline: 579 passed, 9 skipped)
- `npx eslint "src/**/*.{js,ts,vue}"`
