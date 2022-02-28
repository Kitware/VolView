import { onUnmounted } from '@vue/composition-api';
import { vtkSubscription } from '@kitware/vtk.js/interfaces';

export function manageVTKSubscription(subscription: vtkSubscription) {
  onUnmounted(() => subscription.unsubscribe());
}
