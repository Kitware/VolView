# VolView

[![DOI](https://zenodo.org/badge/248073292.svg)](https://zenodo.org/badge/latestdoi/248073292)

![A screenshot of a sample ParaView Medical session](./public/pvm-sample.png)

VolView is a medical image viewer for the web!
Built on [vtk.js](https://github.com/Kitware/vtk-js) and [itk.js](https://github.com/InsightSoftwareConsortium/itk-js/), it is a self-contained single-page web application with the following features:

- DICOM loading: load your studies and series directly into the app! No PACS needed
- DICOM browsing: browse your DICOM data in a a quick patient-study-series view
- Annotations (WIP): support for 2D paint and measurements
- Volume rendering: Support for changing of colormaps and opacities
- Models: Load in geometry and view them in 2D or 3D
- ...and more to come!

This project is still a work in progress, so suggestions and contributions are welcome in the issue tracker!

You can also play with the online demo: https://volview.netlify.app/

## Development

Below lists a few commands for building and running a local copy of VolView.

To prepare your environment after cloning the repo, run:

```
npm install
```

### Compiles and hot-reloads for development
```
npm run serve
```

### Compiles and minifies for production
```
npm run build
```

### Lints and fixes files
```
npm run lint
```

### Unit Tests
```
npm run test:unit
```
