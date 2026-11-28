# Development

## Prerequisites

Before you begin, make sure your environment matches the following versions:

- **Node.js**: >= 18.20.0 (20.x LTS recommended)
- **npm**: >= 9.x (npm 10+ works with Node 20)

Check your versions:

```bash
node --version
npm --version
```

> **Tip:** Use `nvm` or `volta` to manage and switch Node.js versions.

For reproducible installs, use:

```bash
npm ci
```

---

## Dependencies

Refer to `package.json` for the full list of dependencies and devDependencies.

---

## Setup

To prepare your environment after cloning the repo, run:

```bash
npm install
```

---

## Compiles and hot-reloads for development

```bash
npm run dev
```

---

## Compiles and minifies for production

```bash
npm run build
```

---

## Analyzing the production bundle

Generate a production bundle and produce a bundle size breakdown report:

```bash
npm run build:analyze
```

---

## Lints and fixes files

```bash
npm run lint
```

---

## Quality checks

The pre-commit hook and CI run `node scripts/checks/check.mjs`. It compares the files you changed with the base (`HEAD` locally, the target branch in CI), so existing code is left alone and only a change that makes a file worse fails.

- Complexity: in `src`, a function stays within cyclomatic complexity 10, nesting depth 3 and 4 parameters, and a file within 600 lines. A file already over a limit may not go further over, and a new file must be within all of them.
- Duplication: a change to the tests may not add a block of 60 or more tokens that repeats another test.
- Conventions: no new binary files outside the directories that already hold them, such as `tests/baseline`.

The limits are in `scripts/checks/config.mjs`. Stage your changes before running the script by hand, since it reads the index. `CHECKS_SKIP=1 git commit` skips it for one commit.

---

## Testing

```bash
# unit tests
npm run test

# e2e tests (Chromium, through Playwright)
npx playwright install chromium   # once
npm run test:e2e:chrome            # build with sample data, then run the suite
npm run test:e2e:chrome:skip-build # run the suite against the existing dist/

# one file, or tests whose title matches
npm run test:e2e:chrome:skip-build -- tests/specs/remote-manifest.e2e.ts
npm run test:e2e:chrome:skip-build -- -g "should load relative URI with no name property"

# against the vite dev server instead of dist/; add -- --ui for the UI mode
npm run test:e2e:dev -- tests/specs/remote-manifest.e2e.ts
```

Each invocation writes to `.tmp/runs/<port>/run-<id>`, where `<port>` is the static server port this checkout uses: `results/` holds failure screenshots, traces and the actual and diff images of a failed screenshot comparison, and `report/` holds the HTML report. Open it with `npx playwright show-report .tmp/runs/<port>/run-<id>/report`. Locally, a passing run deletes `.tmp/runs/<port>` on the way out, so the output stays around only after a failure. CI always keeps it and uploads it with the blob reports; the workflow merges those into one HTML report per OS.

CI records a trace for every failed test. Locally, add `--trace on` to record one for each test, then open it with `npx playwright show-trace .tmp/runs/<port>/run-<id>/results/<test>/trace.zip`.

Screenshot assertions compare against the images in `tests/baseline`. A missing baseline is written and passes locally, but fails on CI. Add `--update-snapshots` to rewrite baselines that changed. CI rendering is the reference, so take a new or changed baseline from the run directory artifact of a CI run, not from a local run.

Downloaded test datasets are cached in `.tmp/datasets` and shared by every run, so deleting a run directory does not force a re-download.

Two checkouts get different ports and different run directories, so their suites can run at the same time. Two suites out of one checkout cannot: they would share `dist/` and `tests/baseline`. Set `VOLVIEW_E2E_PORT` and `VOLVIEW_E2E_AUX_PORT` if something else already holds the ports a checkout picked.

#### Writing e2e tests

- Assert on what a user can perceive. Never read Pinia, the Vue app or vtk objects from the page.
- Wait for a visible outcome, never for time.
- No `timeout` options, pauses or `test.setTimeout`; lint rejects them. Mark a heavy test with `test.slow()`, and wait on large data with `expectWithinTest` from `tests/e2eRun.ts`.
- When elapsed time is what the test is about, drive it with `page.clock`.
- For a file whose tests build on one page, call `useSharedPage()` from `tests/fixtures.ts` at the top of the `describe` block.
- Flip an expected value once to see a new spec fail.

---

## Versioning

Merging to `main` automatically publishes prerelease packages to NPM:

1. Merge creates a prerelease tag (e.g. v4.4.0-dev.<sha>)
2. Tag triggers automatic NPM publish with `@dev` dist-tag

```bash
npm install volview          # Gets latest stable release (e.g., 4.4.0)
npm install volview@dev      # Gets latest dev package (most recent commit to main branch)
```

To publish a new release via CI/CD, manually create and push a tag, e.g.:

```bash
git tag v4.5.0  # must match format 'v[0-9]+.[0-9]+.[0-9]+'
git push origin --tags
```

---

## Developing with VTK.js

Follow these steps to develop against a custom development branch of VTK.js:

1. Build and package VTK.js:

```bash
path/to/vtk-js > npm run build:esm
```

2. Create a symbolic link to the VTK.js distribution folder on your local system:

```bash
cd path/to/vtk-js/dist/esm
npm link
```

3. Reference the symbolic link in your local VolView build:

```bash
cd path/to/VolView
npm link --no-save @kitware/vtk.js
```

4. Build and run VolView:

```bash
npm run dev
```
