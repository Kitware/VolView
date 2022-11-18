module.exports = {
  baseUrl: '/VolView',
  work: './build-tmp',
  config: {
    title: 'VolView',
    description: '"The cinematic Web Viewer for your medical data"',
    subtitle: '"Enable cinematic volume rendering of DICOM data on any computer."',
    author: 'Kitware Inc.',
    timezone: 'UTC',
    url: 'https://kitwaremedical.github.io/VolView',
    root: '/VolView/',
    github: 'kitwaremedical/VolView',
    google_analytics: 'UA-90338862-10',
  },
  copy: [
    {
      src: '../dist/*',
      dest: './build-tmp/public/app',
    },
  ],
};
