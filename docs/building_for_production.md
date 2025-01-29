# Building for Production

To build VolView, ensure you have the latest `node.js` and `npm` tools installed. `git` is optional for fetching the VolView sources.

To build, run the following commands.

```bash
git clone https://github.com/Kitware/VolView.git
cd VolView/
npm install
npm run build
```

If all goes well, the build artifacts will be located in `dist/`. This directory should consist of a bunch of static HTML, CSS, JS, font files, and images. These files can be copied to any static site hosting root for immediate deployment.
