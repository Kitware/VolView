<script lang="ts">
import { useRulerStore } from '@/src/store/tools/rulers';
import { vtkRulerViewWidget } from '@/src/vtk/RulerWidget';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  onMounted,
  PropType,
  ref,
  toRefs,
  watch,
  watchEffect,
} from '@vue/composition-api';
import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { updatePlaneManipulatorFor2DView } from '@/src/utils/manipulators';
import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import { getCSSCoordinatesFromEvent } from '@/src/utils/vtk-helpers';
import { LPSAxisDir } from '@/src/types/lps';

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
    slice: {
      type: Number,
      required: true,
    },
    focused: Boolean,
  },
  setup(props, { emit }) {
    const {
      rulerId: rulerIDRef,
      widgetManager: widgetManagerRef,
      viewDirection,
      focused,
      slice,
    } = toRefs(props);
    const rulerStore = useRulerStore();
    const factoryRef = computed(() =>
      rulerStore.getVTKFactory(rulerIDRef.value)
    );
    const widgetRef = ref<vtkRulerViewWidget | null>(null);
    const rulerRef = computed(() => rulerStore.rulers[rulerIDRef.value]);

    onMounted(() => {
      if (!factoryRef.value) {
        throw new Error(
          `No widget exists for ruler with ID ${rulerIDRef.value}`
        );
      }
      const widgetManager = widgetManagerRef.value;
      const factory = factoryRef.value;

      widgetRef.value = widgetManager.addWidget(factory) as vtkRulerViewWidget;
    });

    // --- right click handling --- //

    let rightClickSub: vtkSubscription | null = null;

    onMounted(() => {
      rightClickSub = widgetRef.value!.onRightClickEvent((eventData) => {
        const coords = getCSSCoordinatesFromEvent(eventData);
        if (coords) {
          emit('contextmenu', coords);
        }
      });
    });

    onBeforeUnmount(() => {
      if (rightClickSub) {
        rightClickSub.unsubscribe();
        rightClickSub = null;
      }
    });

    // --- manipulator --- //

    const manipulator = vtkPlaneManipulator.newInstance();

    onMounted(() => {
      widgetRef.value!.setManipulator(manipulator);
    });

    const { currentImageMetadata } = useCurrentImage();

    watchEffect(() => {
      updatePlaneManipulatorFor2DView(
        manipulator,
        viewDirection.value,
        rulerRef.value.slice ?? slice.value,
        currentImageMetadata.value
      );
    });

    // --- focus --- //

    watchEffect(() => {
      const widgetManager = widgetManagerRef.value;
      const widget = widgetRef.value;
      if (focused.value) {
        widgetManager.grabFocus(widget!);
      } else {
        // TODO unfocus the specific widget; necessary?
      }
    });

    onBeforeUnmount(() => {
      const widgetManager = widgetManagerRef.value;
      const widget = widgetRef.value;
      widgetManager.removeWidget(widget!);
    });

    // --- visibility --- //

    watch(
      () => {
        const rulerSlice = rulerRef.value.slice;
        const curSlice = slice.value;
        return !Number.isInteger(rulerSlice) || rulerSlice === curSlice;
      },
      (visible) => {
        widgetRef.value!.setVisibility(visible);
      }
    );

    onMounted(() => {
      // hide handle visibility
      widgetRef.value!.setHandleVisibility(false);
      widgetManagerRef.value.renderWidgets();
    });

    return () => null;
  },
});
</script>
