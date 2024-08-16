import { defineConfig } from 'vitepress';

const GA_ID = 'G-MH4N62W0Z9';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'VolView',
  base: '/VolView',
  description:
    'Open-source and freely available radiological viewer that runs in your web browser and provide photo-realistic, interactive, 3D visualizations.',

  ignoreDeadLinks: 'localhostLinks',

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    [
      'script',
      {
        async: 'true',
        src: `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`,
      },
    ],
    [
      'script',
      {},
      `window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\ngtag('config', '${GA_ID}');`,
    ],
  ],

  themeConfig: {
    logo: './logo.svg',
    nav: [{ text: 'Live Demo', link: 'https://volview.kitware.app' }],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is VolView?', link: '/' },
          { text: 'Quick Start Guide', link: '/quick_start_guide' },
          { text: 'Screenshots', link: '/gallery' },
        ],
      },
      {
        text: 'Features &amp; Operation',
        items: [
          { text: 'Welcome Screen', link: '/welcome_screen' },
          { text: 'Loading Data', link: '/loading_data' },
          { text: 'Toolbar', link: '/toolbar' },
          { text: 'Mouse/Keyboard Controls', link: '/mouse_controls' },
          { text: 'Cinematic Rendering', link: '/rendering' },
          { text: 'State Files', link: '/state_files' },
          { text: 'Remote Server Capabilities', link: '/server' },
          { text: 'Configuration File', link: '/configuration_file' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Kitware/VolView' },
    ],

    footer: {
      copyright: 'Copyright © 2020-PRESENT <strong>Kitware, Inc.</strong>',
    },
  },
});
