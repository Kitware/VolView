# Development

Below lists a few commands for building and running a local copy of VolView.

To prepare your environment after cloning the repo, run:

```
npm install
```

## Compiles and hot-reloads for development
```
npm run serve
```

## Compiles and minifies for production
By default, VolView will expect assets to be available at the root folder.
To support hosting VolView in a subdirectory, create a `.env` file at the root of this project with the following contents:

```
VUE_APP_PUBLIC_PATH=/sub/directory/for/volview
```

To build:

```
npm run build
```

## Lints and fixes files
```
npm run lint
```

## Unit Tests
```
npm run test:unit
```
