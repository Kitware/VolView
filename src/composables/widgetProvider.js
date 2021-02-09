import { inject } from '@vue/composition-api';

const defaultKey = 'widgetProvider';

export function useWidgetProvider(key = defaultKey) {
  return inject(key ?? defaultKey);
}
