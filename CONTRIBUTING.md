# Development

Below lists a few commands for building and running a local copy of VolView.

To prepare your environment after cloning the repo, run:

```
npm install
```

## Compiles and hot-reloads for development
```
npm run dev
```

## Compiles and minifies for production
```
npm run build
```

## Analyzing the production bundle

You can generate a production bundle and produce a bundle size breakdown report:

```
npm run build:analyze
```

## Lints and fixes files
```
npm run lint
```

## Testing

```
# unit tests
npm run test:unit

# e2e tests
npm run test:e2e:chrome
```

When running end-to-end tests, baseline images are saved to `tests/baseline`. Baseline diffs and actual snapshots are saved to `.tmp`.

When adding a new baseline image and test, the image should be pulled from GitHub Actions. Every test run will upload artifacts containing the snapshots taken, and those should be used when verifying and committing the baseline images.

## Developing with VTK.js

Follow these steps to develop against a custom development branch of VTK.js:

1. Build and package VTK.js:
```sh
path/to/vtk-js > npm run build:esm
```

2. Create a symbolic link to the VTK.js distribution folder on your local system:
```sh
> cd path/to/vtk-js/dist/esm
path/to/vtk-js/dist/esm > npm link
```

3. Reference the symbolic link in your local VolView build:
```sh
> cd path/to/VolView
path/to/VolView > npm link --no-save @kitware/vtk.js
```

4. Build and run VolView:
```sh
path/to/VolView > npm run dev
```
