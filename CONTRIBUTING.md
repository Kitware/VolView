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