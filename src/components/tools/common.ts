import { AnnotationToolStore } from '@/src/store/tools/useAnnotationTool';
import { Maybe } from '@/src/types';
import { AnnotationTool } from '@/src/types/annotation-tool';
import { vtkAnnotationToolWidget } from '@/src/vtk/ToolWidgetUtils/utils';
import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
import { VNode } from 'vue';

export interface WidgetComponentMeta<
  ToolID extends string,
  ToolStore extends AnnotationToolStore<ToolID>,
  WidgetState extends vtkWidgetState,
  WidgetFactory extends vtkAbstractWidgetFactory,
  ViewWidget extends vtkAnnotationToolWidget,
  SyncedState,
  InitState
> {
  /**
   * The name of the component.
   */
  name: string;

  /**
   * The associated tool store.
   */
  useToolStore: () => ToolStore;

  /**
   * Construct a new standalone widget state.
   * Used by the placing widget component.
   */
  createStandaloneState: () => WidgetState;

  /**
   * Construct a new store-backed state.
   */
  createStoreBackedState: (id: ToolID, store: ToolStore) => WidgetState;

  /**
   * Construct a widget factory.
   */
  createWidgetFactory: (widgetState: WidgetState) => WidgetFactory;

  /**
   * A composable that syncs the widget factory's state to a reactive object.
   */
  useSyncedState: (widgetFactory: WidgetFactory) => SyncedState;

  /**
   * Resets the placing widget.
   */
  resetPlacingWidget: (widget: ViewWidget) => void;

  /**
   * Widget has been placed, so construct the init state object.
   *
   * The init state object is used to construct the actual store tool.
   */
  constructInitState: (state: SyncedState) => InitState;

  /**
   * An optional render function
   *
   * @param viewId the view ID
   * @param syncedState the synced state from the widget
   * @param labelProps the label props associated with the tool
   * @param tool an optional tool. Not available for the placing widget.
   */
  render?: (
    viewId: string,
    syncedState: SyncedState,
    labelProps: Maybe<ToolStore['labels'][string]>,
    tool?: AnnotationTool<ToolID>
  ) => VNode;
}
