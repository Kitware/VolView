import * as Sentry from '@sentry/vue';
import { App } from 'vue';

export const LOCAL_STORAGE_KEY = 'error-reporting-off';

export const errorReportingConfigured = !!process.env.VUE_APP_SENTRY_DSN;

export const init = (app: App<Element>) => {
  const sentryOff = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (sentryOff !== 'true' && errorReportingConfigured)
    Sentry.init({
      app,
      dsn: process.env.VUE_APP_SENTRY_DSN,
      integrations: [new Sentry.Replay()],
      // Performance Monitoring
      tracesSampleRate: 0.1, // Capture 10% of the transactions
      // Session Replay
      replaysSessionSampleRate: 0.1, // This sets the sample rate at 10%. You may want to change it to 100% while in development and then sample at a lower rate in production.
      replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.
    });
};

export const disable = () => {
  localStorage.setItem(LOCAL_STORAGE_KEY, 'true');
  Sentry.close(200);
};

// only turns Sentry back on after reload
export const enable = () => {
  localStorage.setItem(LOCAL_STORAGE_KEY, 'false');
};
