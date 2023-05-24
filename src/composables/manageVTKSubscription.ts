import { onUnmounted } from 'vue';
import { vtkSubscription } from '@kitware/vtk.js/interfaces';

export function manageVTKSubscription(subscription: vtkSubscription) {
  onUnmounted(() => subscription.unsubscribe());
}
