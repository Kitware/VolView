import { config as sharedConfig, TEMP_DIR } from './wdio.shared.conf';

const IS_CI = !!(process.env.CI || process.env.GITHUB_ACTIONS);
const IS_LINUX_CI = IS_CI && process.platform === 'linux';

// Chrome arguments for CI environments
const chromeArgs: string[] = [];
if (IS_CI) {
  chromeArgs.push(
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-infobars',
    '--enable-unsafe-swiftshader'
  );
}

if (IS_LINUX_CI) {
  chromeArgs.push('--use-gl=angle', '--use-angle=swiftshader-webgl');
}

if (IS_CI || !process.env.HEADED) {
  chromeArgs.push('--headless=new');
  if (!IS_CI) chromeArgs.push('--enable-unsafe-swiftshader');
}

export const config = {
  ...sharedConfig,
  ...(IS_LINUX_CI ? { autoXvfb: false } : {}),
  capabilities: [
    {
      browserName: 'chrome',
      browserVersion: '157.0.8103.26',
      // this overrides the default chrome download directory with our temporary one
      'goog:chromeOptions': {
        args: chromeArgs,
        prefs: {
          directory_upgrade: true,
          prompt_for_download: false,
          'download.default_directory': TEMP_DIR,
        },
      },
    },
  ],
};
