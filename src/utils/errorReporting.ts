import * as Sentry from '@sentry/vue';
import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { App, ref, watch } from 'vue';

const { VITE_SENTRY_DSN } = import.meta.env;

export const LOCAL_STORAGE_KEY = 'error-reporting-off';

export const errorReportingConfigured = !!VITE_SENTRY_DSN;

export const init = (app: App<Element>) => {
  const sentryOff = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (sentryOff !== 'true' && errorReportingConfigured)
    Sentry.init({
      app,
      dsn: VITE_SENTRY_DSN,
    });
};

const setEnabled = (enabled: boolean) => {
  const options = Sentry.getCurrentHub().getClient()?.getOptions();
  if (!options) return;
  options.enabled = enabled;
};

export const useErrorReporting = defineStore('error-reporting', () => {
  const disableReportingStorage = useLocalStorage(LOCAL_STORAGE_KEY, 'false');

  const disableReporting = ref(disableReportingStorage.value === 'true');

  // sync boolean to local storage
  watch(disableReporting, () => {
    disableReportingStorage.value = String(disableReporting.value);
    setEnabled(!disableReporting.value);
  });

  return { disableReporting };
});
