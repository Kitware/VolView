module.exports = {
  baseUrl: '/VolView',
  work: './build-tmp',
  config: {
    title: 'VolView',
    subtitle: '"Cinematic volume rendering of DICOM data in your web browser."',
    description: '"An open-source and freely available radiological workstation that runs in your web browser and provide advanced, interactive 3D visualizations."',
    author: 'Kitware Inc.',
    timezone: 'UTC',
    url: 'https://kitware.github.io/VolView',
    root: '/VolView/',
    github: 'kitware/VolView',
    google_analytics: 'G-MH4N62W0Z9',
  },
  copy: [
    {
      src: '../dist/*',
      dest: './build-tmp/public/app',
    },
  ],
};
