import * as Sentry from '@sentry/vue';
import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { App, ref, watch } from 'vue';

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

const disable = () => {
  Sentry.close(200);
};

export const useErrorReporting = defineStore('error-reporting', () => {
  const disableReportingStorage = useLocalStorage(LOCAL_STORAGE_KEY, 'false');

  const disableReporting = ref(disableReportingStorage.value === 'true');

  // sync boolean to local storage
  watch(disableReporting, () => {
    disableReportingStorage.value = String(disableReporting.value);
    if (disableReporting.value) disable();
  });

  return { disableReporting };
});
