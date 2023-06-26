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
npm run test:e2e
```

`npm run test:e2e` always runs a testing build prior to running the tests. If
you are not changing any application code, you can save time by manually running
each stage of the pipeline.

```
# produce a testing build
npm run build:testing

# run e2e tests
npm run test:e2e:skip-build
```