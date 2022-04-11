<script lang="ts">
import { useRulerToolStore } from '@/src/store/tools/rulers';
import { vtkRulerViewWidget } from '@/src/vtk/RulerWidget';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { IndexError } from '@/src/utils/errors';
import {
  defineComponent,
  onBeforeUnmount,
  PropType,
  toRefs,
  watchEffect,
} from '@vue/composition-api';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { getLPSAxisFromDir, LPSAxisDir } from '@/src/utils/lps';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { Vector3 } from '@kitware/vtk.js/types';

export default defineComponent({
  name: 'RulerWidget2D',
  props: {
    rulerId: {
      type: String,
      required: true,
    },
    widgetManager: {
      type: Object as PropType<vtkWidgetManager>,
      required: true,
    },
    viewId: {
      type: String,
      required: true,
    },
    viewDirection: {
      type: String as PropType<LPSAxisDir>,
      required: true,
    },
    viewUp: {
      type: String as PropType<LPSAxisDir>,
      required: true,
    },
    slice: {
      type: Number,
      required: true,
    },
    focused: Boolean,
    pickable: Boolean,
  },
  setup(props) {
    const {
      rulerId: rulerIDRef,
      widgetManager: widgetManagerRef,
      viewDirection,
      focused,
      slice,
    } = toRefs(props);
    const rulerStore = useRulerToolStore();

    const rulerID = rulerIDRef.value;
    const widgetManager = widgetManagerRef.value;
    const factory = rulerStore.$toolManagers.ruler.getFactory(rulerID);
    if (!factory) {
      throw new IndexError(`No factory found for ruler ID ${rulerID}`);
    }
    const widget = widgetManager.addWidget(factory) as vtkRulerViewWidget;

    // --- manipulator --- //

    const manipulator = vtkPlaneManipulator.newInstance();
    widget.setManipulator(manipulator);

    const { currentImageMetadata } = useCurrentImage();

    watchEffect(() => {
      const viewDir = viewDirection.value;
      const { lpsOrientation } = currentImageMetadata.value;
      const axis = lpsOrientation[getLPSAxisFromDir(viewDir)];

      const normal = lpsOrientation[viewDir];
      const origin = [0, 0, 0];
      origin[axis] = slice.value;

      manipulator.setNormal(normal as Vector3);
      manipulator.setOrigin(origin as Vector3);
    });

    // --- focus --- //

    watchEffect(() => {
      if (focused.value) {
        widgetManager.grabFocus(widget);
      } else {
        // TODO unfocus the specific widget; necessary?
      }
    });

    onBeforeUnmount(() => {
      widgetManager.removeWidget(widget);
    });

    return () => null;
  },
});
</script>
