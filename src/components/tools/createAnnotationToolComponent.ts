import { LPSAxisDir } from '@/src/types/lps';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import { computed, defineComponent, h, toRefs } from 'vue';
import type { Component, ComputedRef, PropType } from 'vue';
import AnnotationContextMenu from '@/src/components/tools/AnnotationContextMenu.vue';
import { useToolStore as useToolMetaStore } from '@/src/store/tools';
import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { Tools } from '@/src/store/tools/types';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { getLPSAxisFromDir } from '@/src/utils/lps';
import { useCurrentFrameOfReference } from '@/src/composables/useCurrentFrameOfReference';
import {
  useContextMenu,
  useCurrentTools,
} from '@/src/composables/annotationTool';
import { Maybe } from '@/src/types';
import { ContextMenuEvent } from '@/src/types/annotation-tool';

export interface AnnotationToolComponentMeta<
  ToolID extends string,
  ToolStore extends AnnotationToolStore<ToolID>
> {
  type: Tools;
  name: string;
  useToolStore: () => ToolStore;
  Widget2DComponent: Component;
  PlacingWidget2DComponent: Component;
}

export function createAnnotationToolComponent<
  ToolID extends string,
  ToolStore extends AnnotationToolStore<ToolID>
>(meta: AnnotationToolComponentMeta<ToolID, ToolStore>) {
  return defineComponent({
    name: meta.name,
    props: {
      viewId: {
        type: String,
        required: true,
      },
      currentSlice: {
        type: Number,
        required: true,
      },
      viewDirection: {
        type: String as PropType<LPSAxisDir>,
        required: true,
      },
      widgetManager: {
        type: Object as PropType<vtkWidgetManager>,
        required: true,
      },
    },
    setup(props) {
      type LabelProps = ToolStore['labels'][string];

      const { viewId, widgetManager, viewDirection, currentSlice } =
        toRefs(props);
      const toolMetaStore = useToolMetaStore();
      const toolStore = meta.useToolStore();
      const activeLabel = computed(() => toolStore.activeLabel);

      const { currentImageID } = useCurrentImage();
      const isToolActive = computed(
        () => toolMetaStore.currentTool === meta.type
      );
      const viewAxis = computed(() => getLPSAxisFromDir(viewDirection.value));

      const currentFrameOfReference = useCurrentFrameOfReference(
        viewDirection,
        currentSlice
      );

      const onToolPlaced = (initState: object) => {
        if (!currentImageID.value) return;
        // TODO drop color property
        const { color } = activeLabel.value
          ? (toolStore.labels[activeLabel.value] as any)
          : { color: undefined };
        toolStore.addTool({
          imageID: currentImageID.value,
          frameOfReference: currentFrameOfReference.value,
          slice: currentSlice.value,
          label: activeLabel.value,
          color,
          ...initState,
        });
      };

      // --- right-click menu --- //

      const { contextMenu, openContextMenu } = useContextMenu();

      // --- template data --- //

      const currentTools = useCurrentTools(toolStore, viewAxis);

      const activeLabelProps: ComputedRef<Maybe<LabelProps>> = computed(() => {
        return activeLabel.value
          ? (toolStore.labels[activeLabel.value] as LabelProps)
          : null;
      });

      const render = () =>
        h('div', { class: 'overlay-no-events' }, [
          h('svg', { class: 'overlay-no-events' }, [
            isToolActive.value
              ? h(meta.PlacingWidget2DComponent, {
                  currentSlice: currentSlice.value,
                  viewDirection: viewDirection.value,
                  widgetManager: widgetManager.value,
                  viewId: viewId.value,
                  labelProps: activeLabelProps.value,
                  onPlaced: onToolPlaced,
                })
              : null,
            ...currentTools.value.map((tool) =>
              h(meta.Widget2DComponent, {
                key: tool.id,
                toolId: tool.id,
                currentSlice: currentSlice.value,
                viewId: viewId.value,
                viewDirection: viewDirection.value,
                widgetManager: widgetManager.value,
                onContextmenu: (event: ContextMenuEvent) =>
                  openContextMenu(tool.id, event),
              })
            ),
          ]),
          h(AnnotationContextMenu<ToolID>, { ref: contextMenu, toolStore }),
        ]);

      return render;
    },
  });
}
