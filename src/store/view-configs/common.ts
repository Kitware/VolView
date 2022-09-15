import { useDoubleRecord } from '@/src/composables/useDoubleRecord';

class ReturnTypeOfDoubleRecord<T> {
  Return = useDoubleRecord<T>();
}
type ConfigMap = ReturnTypeOfDoubleRecord<any>['Return'];

export const removeViewFromConfig = (config: ConfigMap) => (viewID: string) =>
  config.deleteFirstKey(viewID);

export const removeDataFromConfig =
  (config: ConfigMap) => (dataID: string, viewID?: string) => {
    if (viewID) {
      config.delete(viewID, dataID);
    } else {
      config.deleteSecondKey(dataID);
    }
  };
