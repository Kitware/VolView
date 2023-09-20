import { ToolSelectEvent } from '@/src/store/tools/types';
import {
  event as registerEvent,
  VOID,
  EVENT_ABORT,
} from '@kitware/vtk.js/macros';
import vtkProp from '@kitware/vtk.js/Rendering/Core/Prop';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import vtkWidgetRepresentation from '@kitware/vtk.js/Widgets/Representations/WidgetRepresentation';

interface Model {
  representations: vtkWidgetRepresentation[];
  _widgetManager: vtkWidgetManager;
}

interface PublicAPI {
  getSelectableRepresentations(): vtkWidgetRepresentation[];
  getSelectableProps(): vtkProp[];
  detectSelection(ev: any): void;
  // toolID is filled in by event consumer
  invokeSelectEvent(ev: ToolSelectEvent): void;
  [other: string]: any;
}

export function applySelectionAPIMixin(
  publicAPI: PublicAPI,
  model: Model,
  selectableRepresentationLabels: string[]
) {
  const originalAPI = { ...publicAPI };
  const selectableRepresentationLabelsSet = new Set(
    selectableRepresentationLabels
  );

  registerEvent(publicAPI, model, 'SelectEvent');

  publicAPI.getSelectableRepresentations = () => {
    return model.representations.filter((rep) =>
      rep
        .getLabels()
        .some((label) => selectableRepresentationLabelsSet.has(label))
    );
  };

  publicAPI.getSelectableProps = () => {
    return publicAPI
      .getSelectableRepresentations()
      .flatMap((rep: vtkWidgetRepresentation) => rep.getActors());
  };

  publicAPI.detectSelection = (ev: any) => {
    const props = new Set(publicAPI.getSelectableProps());
    const selected = model._widgetManager
      .getSelections()
      .map((sel) => sel.getProperties().prop)
      .filter((prop): prop is vtkProp => !!prop)
      .some((prop) => props.has(prop));

    publicAPI.invokeSelectEvent({
      selected,
      updateBehavior: ev.shiftKey ? 'preserve' : 'single',
    });
  };

  publicAPI.handleLeftButtonPress = (ev: any) => {
    if (originalAPI.handleLeftButtonPress(ev) === EVENT_ABORT) {
      publicAPI.invokeSelectEvent({
        selected: false,
        updateBehavior: 'deselectOthers',
      });
      return EVENT_ABORT;
    }
    publicAPI.detectSelection(ev);
    return VOID;
  };

  publicAPI.handleRightButtonPress = (ev: any) => {
    if (originalAPI.handleRightButtonPress(ev) === EVENT_ABORT) {
      publicAPI.invokeSelectEvent({
        selected: true,
        updateBehavior: 'deselectOthers',
      });
      return EVENT_ABORT;
    }
    publicAPI.detectSelection(ev);
    return VOID;
  };
}
