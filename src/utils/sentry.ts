import * as Sentry from '@sentry/vue';
import { App } from 'vue';

export const SENTRY_OFF_KEY = 'SENTRY_OFF';

export const init = (app: App<Element>) => {
  const sentryOff = localStorage.getItem(SENTRY_OFF_KEY);
  console.log(sentryOff);
  if (sentryOff !== 'true')
    Sentry.init({
      app,
      dsn: 'https://330d4ca81b9c48cfac837d395966e6ee@o4505347877765120.ingest.sentry.io/4505347880779776',
      allowUrls: [
        'https://volview.netlify.app',
        'https://dicomweb.netlify.app',
      ],
      integrations: [new Sentry.Replay()],
      // Performance Monitoring
      tracesSampleRate: 0.1, // Capture 100% of the transactions, reduce in production!
      // Session Replay
      replaysSessionSampleRate: 0.1, // This sets the sample rate at 10%. You may want to change it to 100% while in development and then sample at a lower rate in production.
      replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.
    });
};

export const disable = () => {
  localStorage.setItem(SENTRY_OFF_KEY, 'true');
  Sentry.close(200);
};

// only turns Sentry back on after reload
export const enable = () => {
  localStorage.setItem(SENTRY_OFF_KEY, 'false');
};
