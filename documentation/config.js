module.exports = {
  baseUrl: '/VolView',
  work: './build-tmp',
  config: {
    title: 'VolView',
    description: '"The cinematic Web Viewer for your medical data"',
    subtitle: '"Enable cinematic volume rendering of DICOM data on any computer."',
    author: 'Kitware Inc.',
    timezone: 'UTC',
    url: 'https://kitwaremedical.volview.io/VolView',
    root: '/VolView/',
    github: 'kitwaremedical/VolView',
    google_analytics: 'UA-90338862-10',
  },
  copy: [
    {
      src: '../dist/*',
      dest: './build-tmp/public/app',
    },
    {
      src: '../dist/redirect-app.html',
      dest: './build-tmp/public/nightly/index.html',
      destIsTarget: true,
    },
    // use analytics-enabled index.html
    {
      src: '../dist/index-ga.html',
      dest: './build-tmp/public/app/index.html',
      destIsTarget: true,
    },
  ],
};
