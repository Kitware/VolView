import { onUnmounted } from 'vue';
import type { vtkSubscription } from '@kitware/vtk.js/interfaces';

export function manageVTKSubscription(subscription: vtkSubscription) {
  onUnmounted(() => subscription.unsubscribe());
}
