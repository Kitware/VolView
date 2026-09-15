import { computed } from 'vue';
import { PaintMode } from '@/src/core/tools/paint';
import { usePaintToolStore } from '@/src/store/tools/paint';
import { useActionHeld } from '@/src/composables/useKeyboardShortcuts';

export function usePaintInteractionMode() {
  const paint = usePaintToolStore();
  const held = useActionHeld('paintEyedropper');
  return computed(() =>
    paint.isActive && paint.isPaintingModeActive && held.value
      ? PaintMode.Eyedropper
      : paint.activePaintMode
  );
}
