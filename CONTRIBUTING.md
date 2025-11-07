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

## Testing

```bash
# unit tests
npm run test

# e2e tests (Chrome)
npm run test:e2e:chrome
```

When running end-to-end tests, baseline images are saved to `tests/baseline`. Baseline diffs and actual snapshots are saved to `.tmp`.

When adding a new baseline image and test, the image should be pulled from GitHub Actions. Every test run will upload artifacts containing the snapshots taken, and those should be used when verifying and committing the baseline images.

#### Run one e2e spec file

```bash
npm run test:e2e:dev -- -- --spec ./tests/specs/remote-manifest.e2e.ts
```

---

## NPM Publishing

Merging to `main` automatically publishes to NPM:

1. Merge creates a patch version tag (v4.4.1, v4.4.2, etc.)
2. Tag triggers automatic NPM publish

For minor/major releases, manually create a tag:

```bash
git tag v4.5.0  # or v5.0.0
git push origin v4.5.0
```

To update https://volview.kitware.app/, merge to the `stable` branch.

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
