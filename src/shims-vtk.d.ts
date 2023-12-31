declare module '@kitware/vtk.js/vtk' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';

  const vtk = (obj: any): vtkObject => {};
  vtk.register = (vtkClassName: string, constructor: unknown): void => {};

  export default vtk;
}

declare module '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator/Presets' {
  export default any;
}

declare module '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps' {
  export declare const vtkColorMaps: {
    addPreset(preset: any): void;
    removePresetByName(name: string): void;
    getPresetByName(name: string): any;
    rgbPresetNames: string[];
  };
  export default vtkColorMaps;
}

declare module '@kitware/vtk.js/Widgets/Core/StateBuilder/boundsMixin' {
  export declare function extend(publicAPI: any, model: any): void;
}
declare module '@kitware/vtk.js/Widgets/Core/StateBuilder/visibleMixin' {
  export declare function extend(
    publicAPI: any,
    model: any,
    initialValue: any
  ): void;
}
declare module '@kitware/vtk.js/Widgets/Core/StateBuilder/scale1Mixin' {
  export declare function extend(
    publicAPI: any,
    model: any,
    initialValue: any
  ): void;
}

declare module '@kitware/vtk.js/Widgets/Core/WidgetManager' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';
  import vtkSelectionNode from '@kitware/vtk.js/Common/DataModel/SelectionNode';
  import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
  import vtkProp from '@kitware/vtk.js/Rendering/Core/Prop';
  import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
  import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
  import vtkWidgetRepresentation from '@kitware/vtk.js/Widgets/Representations/WidgetRepresentation';

  export enum RenderingTypes {
    PICKING_BUFFER = 0,
    FRONT_BUFFER = 1,
  }

  export enum CaptureOn {
    MOUSE_MOVE = 0,
    MOUSE_RELEASE = 1,
  }

  export enum ViewTypes {
    DEFAULT = 0,
    GEOMETRY = 1,
    SLICE = 2,
    VOLUME = 3,
    YZ_PLANE = 4, // Sagittal
    XZ_PLANE = 5, // Coronal
    XY_PLANE = 6, // Axial
  }

  export interface SelectedData {
    requestCount: number;
    propID: number;
    compositeID: number;
    prop: vtkProp;
    widget: vtkAbstractWidget;
    representation: vtkWidgetRepresentation;
    selectedState: vtkWidgetState;
  }

  export interface vtkWidgetManager extends vtkObject {
    setCaptureOn(cap: CaptureOn): boolean;
    getCaptureOn(): CaptureOn;
    setViewType(type: ViewTypes): boolean;
    getViewType(): ViewTypes;
    getSelections(): vtkSelectionNode[];
    getWidgets(): vtkAbstractWidget[];
    getViewId(): string;
    getPickingEnabled(): boolean;
    /**
     * @deprecated
     */
    getUseSvgLayer(): boolean;
    /**
     * @deprecated
     */
    setUseSvgLayer(use: boolean): boolean;

    enablePicking(): void;
    renderWidgets(): void;
    disablePicking(): void;
    setRenderer(ren: vtkRenderer): void;
    addWidget(
      widget: vtkAbstractWidgetFactory,
      viewType?: ViewTypes,
      initialValues?: object
    ): vtkAbstractWidget | null;
    removeWidgets(): void;
    removeWidget(widget: vtkAbstractWidget | vtkAbstractWidgetFactory): void;
    getSelectedDataForXY(x: number, y: number): Promise<SelectedData>;
    updateSelectionFromXY(x: number, y: number): void;
    updateSelectionFromMouseEvent(event: MouseEvent): void;
    getSelectedData(): SelectedData | {};
    grabFocus(widget: vtkAbstractWidget | vtkAbstractWidgetFactory): void;
    releaseFocus(): void;
  }

  export interface IWidgetManagerInitialValues {
    captureOn?: CaptureOn;
    viewType?: ViewTypes;
    pickingEnabled?: boolean;
    /**
     * @deprecated
     */
    useSvgLayer?: boolean;
  }

  export function extend(
    publicAPI: object,
    model: object,
    initialValues?: IWidgetManagerInitialValues
  ): vtkWidgetManager;

  export function newInstance(
    initialValues?: IWidgetManagerInitialValues
  ): vtkWidgetManager;

  export declare const vtkWidgetManager: {
    newInstance: typeof newInstance;
    extend: typeof extend;
  };
  export default vtkWidgetManager;
}

declare module '@kitware/vtk.js/Widgets/Core/StateBuilder' {
  import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';

  export interface StateBuilder {
    addDynamicMixinState(buildInfo: {
      labels: string[];
      mixins: string[];
      name: string;
      initialValues?: object;
    }): StateBuilder;
    addStateFromMixin(buildInfo: {
      labels: string[];
      mixins: string[];
      name: string;
      initialValues?: object;
    }): StateBuilder;
    addStateFromInstance(stateInfo: {
      labels: string[];
      name: string;
      instance: vtkWidgetState;
    });
    addField(field: { name: string; initialValue: any });
    build(...mixins: string[]): vtkWidgetState;
  }

  export function createBuilder(): StateBuilder;

  export declare const vtkStateBuilder: {
    createBuilder: typeof createBuilder;
  };
}

declare module '@kitware/vtk.js/IO/XML/XMLImageDataWriter' {
  export declare const vtkXMLImageDataWriter: {
    newInstance: typeof newInstance;
    extend: typeof extend;
  };

  export default vtkXMLImageDataWriter;
}

declare module '@kitware/vtk.js/Widgets/Widgets3D/ImageCroppingWidget' {
  import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
  import vtkAbstractWidgetFactory from '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory';
  import vtkPlaneManipulator from '@kitware/vtk.js/Widgets/Manipulators/PlaneManipulator';
  import vtkLineManipulator from '@kitware/vtk.js/Widgets/Manipulators/LineManipulator';
  import { mat4, vec3 } from 'gl-matrix';
  import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
  import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
  import { Bounds } from '@kitware/vtk.js/types';

  export interface ImageCroppingPlanesState extends vtkWidgetState {
    getPlanes(): [number, number, number, number, number, number];
    setPlanes(
      planes: [number, number, number, number, number, number]
    ): boolean;
  }

  export interface ImageCroppingWidgetState extends vtkWidgetState {
    getIndexToWorldT(): mat4;
    setIndexToWorldT(transform: mat4): boolean;
    getWorldToIndexT(): mat4;
    setWorldToIndexT(transform: mat4): boolean;
    getCroppingPlanes(): ImageCroppingPlanesState;
    placeWidget(bounds: Bounds): void;
  }

  export interface vtkImageCroppingViewWidget extends vtkAbstractWidget {
    setManipulator(manipulator: vtkPlaneManipulator): boolean;
    getManipulator(): vtkPlaneManipulator;
  }

  export interface vtkImageCroppingWidget extends vtkAbstractWidgetFactory {
    getWidgetState(): ImageCroppingWidgetState;
    getCornerManipulator(): vtkPlaneManipulator;
    getEdgeManipulator(): vtkPlaneManipulator;
    getFaceManipulator(): vtkLineManipulator;
    setCornerManipulator(manip: vtkPlaneManipulator): boolean;
    setEdgeManipulator(manip: vtkPlaneManipulator): boolean;
    setFaceManipulator(manip: vtkLineManipulator): boolean;
    copyImageDataDescription(image: vtkImageData);
    setFaceHandlesEnabled(enabled: boolean): void;
    setCornerHandlesEnabled(enabled: boolean): void;
    setEdgeHandlesEnabled(enabled: boolean): void;
  }

  export function newInstance(): vtkImageCroppingWidget;

  export declare const vtkImageCroppingWidget: {
    newInstance: typeof newInstance;
  };
  export default vtkImageCroppingWidget;
}

declare module '@kitware/vtk.js/Widgets/Core/AbstractWidget/Constants' {
  export declare const WIDGET_PRIORITY: number;
}

declare module '@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget' {
  import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
  import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
  import type { Vector3, RGBColor } from '@kitware/vtk.js/types';
  import vtkResliceCursorWidget from '@kitware/vtk.js/Widgets/Widgets3D/ResliceCursorWidget';

  export interface vtkResliceCursorViewWidget extends vtkAbstractWidget {
    setManipulator(manipulator: vtkPlaneManipulator): boolean;
    getManipulator(): vtkPlaneManipulator;
    setImage(image: vtkImageData): void;
    setKeepOrthogonality(keepOrthogonality: boolean): void;
    setScaleInPixels(scaleInPixels: boolean): void;
    setCursorStyles(styles: {
      translateCenter: string;
      rotateLine: string;
      translateAxis: string;
    }): boolean;
  }

  export interface ResliceCursorWidgetState extends vtkWidgetState {
    placeWidget(bounds: Bounds): void;
    setColor3(color: RGBColor): boolean;
    setScale1(scale: number): boolean;
    setScale3(scaleX: number, scaleY: number, scaleZ: number): boolean;
    getPlanes(): Record<number, { normal: Vector3; viewUp: Vector3 }>;
    setPlanes(
      planes: Record<number, { normal: Vector3; viewUp: Vector3 }>
    ): void;
    getCenter(): Vector3;
    setScrollingMethod(mode: number): boolean;
    setOpacity(opacity: number): boolean;
  }

  // Just forwarding vtk-js's definition as default export:
  export default vtkResliceCursorWidget;
}
