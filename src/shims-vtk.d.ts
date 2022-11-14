declare module '@kitware/vtk.js/vtk' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';

  const vtk = (obj: any): vtkObject => {};
  vtk.register = (vtkClassName: string, constructor: unknown): void => {};

  export default vtk;
}

declare module '@kitware/vtk.js/interfaces-additions' {
  import { EVENT_ABORT, VOID } from '@kitware/vtk.js/macros';
  export type EventHandler = (...any: args[]) => EVENT_ABORT | VOID | void;
}

// This is replicated in vtk-types. I'm keeping this here for the types in this shim file.
declare module '@kitware/vtk.js/types/ProxyObject' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';
  import vtkProxyManager from '@kitware/vtk.js/Proxy/Core/ProxyManager';

  export default interface vtkProxyObject extends vtkObject {
    getProxyId(): string;
    getProxyGroup(): string;
    getProxyName(): string;
    getProxyManager(): vtkProxyManager;
    setProxyManager(manager: vtkProxyManager): void;
  }
}
declare module '@kitware/vtk.js/Proxy/Core/SourceProxy' {
  import { vtkAlgorithm } from '@kitware/vtk.js/interfaces';
  import vtkProxyObject from '@kitware/vtk.js/types/ProxyObject';

  export interface vtkSourceProxy<T> extends vtkProxyObject {
    setInputProxy(source: vtkSourceProxy<T>): void;
    setInputData(dataset: T, type?: string): void;
    setInputAlgorithm(
      algo: vtkAlgorithm,
      type: string,
      autoUpdate: bool = true
    ): void;
    update(): void;

    getName(): string;
    setName(name: string): boolean;
    getType(): string;
    getDataset(): T | null;
    getAlgo(): vtkAlgorithm | null;
    getInputProxy(): vtkSourceProxy<T> | null;
  }

  export default vtkSourceProxy;
}

declare module '@kitware/vtk.js/Proxy/Core/ViewProxy' {
  import vtkProxyObject from '@kitware/vtk.js/types/ProxyObject';
  import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
  import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
  import { Vector3, Vector4 } from '@kitware/vtk.js/types';
  import vtkCamera from '@kitware/vtk.js/Rendering/Core/Camera';
  import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
  import vtkInteractorStyle from '@kitware/vtk.js/Rendering/Core/InteractorStyle';
  import { vtkSubscription } from '@kitware/vtk.js/interfaces';
  import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
  import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';

  export interface vtkViewProxy extends vtkProxyObject {
    setPresetToInteractor3D(nameOrDefinitions: string | Object): boolean;
    setPresetToInteractor2D(nameOrDefinitions: string | Object): boolean;

    setOrientationAxesType(type: string): void;
    setOrientationAxesVisibility(visible: boolean): boolean;
    registerOrientationAxis(name: string, actor: vtkActor): void;
    unregisterOrientationAxis(name: string): void;
    listOrientationAxis(): string[];
    setPresetToOrientationAxes(nameOrDefinitions: string | Object): boolean;

    setContainer(container: HTMLElement | null): void;
    resize(): void;
    renderLater(): void;
    render(blocking: boolean = true): void;
    resetCamera(): void;

    addRepresentation(representation: vtkAbstractRepresentationProxy): void;
    removeRepresentation(representation: vtkAbstractRepresentationProxy): void;

    // TODO correct?
    captureImage(
      opts: { format: string = 'image/png' } & Object = {}
    ): Array<Promise<string>>;
    openCaptureImage(target: string = '_blank'): void;

    // TODO corner annotations

    setBackground(color: Vector3 | Vector4): void;
    getBackground(): Vector3 | Vector4;

    setAnimation(enable: boolean, requester?: vtkObject);

    updateOrientation(
      axisIndex: 0 | 1 | 2,
      orientation: -1 | 1,
      viewUp: Vector3,
      animateSteps: number = 0
    ): Promise<void>;
    moveCamera(
      focalPoint: Vector3,
      position: Vector3,
      viewUp: Vector3,
      animateSteps: number = 0
    ): Promise<void>;

    resetOrientation(animateSteps: number = 0): void;
    rotate(angle): void;

    focusTo(focalPoint: Vector3): void;

    getCamera(): vtkCamera;
    // getAnnotationOpacity
    getContainer(): HTMLElement | null;
    // getCornerAnnotation
    getInteractor(): vtkRenderWindowInteractor;
    getInteractorStyle2D(): vtkInteractorStyle;
    getInteractorStyle3D(): vtkInteractorStyle;
    getOpenglRenderWindow(): vtkObject;
    getOrientationAxesType(): string;
    getPresetToOrientationAxes(): any;
    getRenderer(): vtkRenderer;
    getRenderWindow(): vtkRenderWindow;
    getRepresentations(): vtkAbstractRepresentationProxy[];
    getUseParallelRendering(): boolean;
    getDisableAnimation(): boolean;
    setDisableAnimation(disabled: boolean): boolean;

    onResize(
      cb: (size: { width: number; height: number }) => void
    ): vtkSubscription;

    // TODO proxy property mappings
  }

  export default vtkViewProxy;
}

declare module '@kitware/vtk.js/Proxy/Core/View2DProxy' {
  import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';

  export interface vtkView2DProxy extends vtkViewProxy {
    getAxis(): number;
  }

  export default vtkView2DProxy;
}
declare module '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';
  import vtkProxyObject from '@kitware/vtk.js/types/ProxyObject';
  import vtkSourceProxy from '@kitware/vtk.js/Proxy/Core/SourceProxy';
  import vtkAbstractMapper from '@kitware/vtk.js/Rendering/Core/AbstractMapper';
  import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
  import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';

  export interface vtkAbstractRepresentationProxy extends vtkProxyObject {
    setInput(source: vtkSourceProxy): void;
    getInputDataSet(): vtkObject | null;
    setColorBy(
      arrayName: string | null,
      arrayLocation: string,
      componentIndex: number = -1
    );
    setRescaleOnColorBy(rescale: boolean): boolean;
    getRescaleOnColorBy(): boolean;
    getInput(): vtkProxyObject;
    getMapper(): vtkAbstractMapper;
    getActors(): vtkActor[];
    getVolumes(): vtkVolume[];
  }

  export default vtkAbstractRepresentationProxy;
}

declare module '@kitware/vtk.js/Proxy/Core/SliceRepresentationProxy' {
  import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';

  export interface vtkSliceRepresentationProxy
    extends vtkAbstractRepresentationProxy {
    /**
     * @param mode XYZIJK
     */
    setSlicingMode(mode: string): boolean;
    getSlicingMode(): string;
    getSliceIndex(): number;
    getAnnotations(): any;

    // proxy property mappings

    setVisibility(visible: boolean): boolean;
    getVisibility(): boolean;
    setWindowWidth(width: number): boolean;
    getWindowWidth(): number;
    setWindowLevel(level: number): boolean;
    getWindowLevel(): number;
    setInterpolationType(type: number): boolean;
    getInterpolationType(): number;
    setSlice(type: number): boolean;
    getSlice(): number;
  }

  export default vtkSliceRepresentationProxy;
}

declare module '@kitware/vtk.js/Proxy/Representations/VolumeRepresentationProxy' {
  import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
  import vtkImageCropFilter from '@kitware/vtk.js/Filters/General/ImageCropFilter';

  export interface vtkVolumeRepresentationProxy
    extends vtkAbstractRepresentationProxy {
    setIs2DVolume(is2D: boolean): void;
    getIs2DVolume(): boolean;
    isVisible(): boolean;
    setVisibility(visible: boolean): void;
    getVisibility(): boolean;
    setSliceVisibility(isVisible: boolean): void;
    getSliceVisibility(): boolean;
    setSampleDistance(samp: number): void;
    getSampleDistance(): number;
    setEdgeGradient(grad: number): void;
    getEdgeGradient(): number;
    getCropFilter(): vtkImageCropFilter;

    // proxy property mappings
    getXSlice(): number;
    setXSlice(slice: number): boolean;
    getYSlice(): number;
    setYSlice(slice: number): boolean;
    getZSlice(): number;
    setZSlice(slice: number): boolean;
    getVolumeVisibility(): boolean;
    setVolumeVisibility(visible: boolean): boolean;
    getXSliceVisibility(): boolean;
    setXSliceVisibility(visible: boolean): boolean;
    getYSliceVisibility(): boolean;
    setYSliceVisibility(visible: boolean): boolean;
    getZSliceVisibility(): boolean;
    setZSliceVisibility(visible: boolean): boolean;
    getWindowWidth(): number;
    setWindowWidth(width: number): boolean;
    getWindowLevel(): number;
    setWindowLevel(level: number): boolean;
    getUseShadow(): boolean;
    setUseShadow(useShadow: boolean): boolean;
    getCroppingPlanes(): number[];
    setCroppingPlanes(planes: number[]): boolean;
  }

  export default vtkVolumeRepresentationProxy;
}

declare module '@kitware/vtk.js/Proxy/Core/ProxyManager' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';
  import vtkProxyObject from '@kitware/vtk.js/types/ProxyObject';
  import vtkSourceProxy from '@kitware/vtk.js/Proxy/Core/SourceProxy';
  import vtkViewProxy from '@kitware/vtk.js/Proxy/Core/ViewProxy';
  import vtkAbstractRepresentationProxy from '@kitware/vtk.js/Proxy/Core/AbstractRepresentationProxy';
  import vtkLookupTableProxy from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
  import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';

  export type ProxyConfiguration = Object;

  export interface ProxyRegistrationChangeInfo {
    action: 'register' | 'unregister';
    proxyId: string;
    proxyName: string;
    proxyGroup: string;
    proxy: vtkProxyObject;
  }

  export interface vtkProxyManager extends vtkObject {
    // core //

    setProxyConfiguration(config: ProxyConfiguration): boolean;
    getProxyConfiguration(): ProxyConfiguration;

    setActiveSource<T>(sourceProxy: vtkSourceProxy<T>): boolean;
    getActiveSource<T>(): vtkSourceProxy<T>;

    setActiveView(viewProxy: vtkViewProxy): boolean;
    getActiveView(): vtkViewProxy;

    onProxyRegistrationChange(
      callback: (changeInfo: ProxyRegistrationChangeInfo) => void
    );

    getProxyById<T extends vtkProxyObject>(id: string): T | undefined;
    getProxyGroups(): string[];
    getProxyInGroup(groupName: string): vtkProxyObject[];

    getSources(): vtkSourceProxy<any>[];
    getRepresentations(): vtkAbstractRepresentationProxy[];
    getViews(): vtkViewProxy[];

    createProxy<T extends vtkProxyObject>(
      group: string,
      name: string,
      options?: Object
    ): T;

    getRepresentation<T extends vtkAbstractRepresentationProxy>(
      source: vtkSourceProxy<any>,
      view: vtkViewProxy
    ): T | null;

    deleteProxy(proxy: vtkProxyObject): void;

    // view //

    render(view?: vtkViewProxy): void;
    renderAllViews(): void;
    setAnimationOnAllViews(): void;
    autoAnimateViews(debounceTimeout: number = 250): void;
    resizeAllViews(): void;
    resetCamera(view?: vtkViewProxy): void;
    createRepresentationInAllViews(source: vtkSourceProxy<any>): void;
    resetCameraInAllViews(): void;

    // properties //

    // these are specific to the proxy configuration...
    getLookupTable(arrayName: string, options?: any): vtkLookupTableProxy;
    getPiecewiseFunction(
      arrayName: string,
      options?: any
    ): vtkPiecewiseFunctionProxy;
    rescaleTransferFunctionToDataRange(
      arrayName: string,
      dataRange: [number, number]
    ): void;
  }

  export default vtkProxyManager;
}

declare module '@kitware/vtk.js/Proxy/Core/LookupTableProxy' {
  import vtkProxyObject from '@kitware/vtk.js/types/ProxyObject';
  import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';

  // [x, r/h, g/s, b/v, m=0.5, s=0.0]
  export type RGBHSVPoint = [number, number, number, number, number?, number?];

  export interface ILookupTableProxyMode {
    Preset: number = 0;
    RGBPoints: number = 1;
    HSVPoints: number = 2;
    Nodes: number = 3;
  }

  export interface vtkLookupTableProxy extends vtkProxyObject {
    setPresetName(name: string): void;
    getPresetName(): string;
    setRGBPoints(points: RGBHSVPoint[]): void;
    getRGBPoints(): RGBHSVPoint[];
    setHSVPoints(points: RGBHSVPoint[]): void;
    getHSVPoints(): RGBHSVPoint[];
    // Node: { x, y, midpoint, sharpness }
    setNodes(nodes: number[][]): void;
    getNodes(nodes): number[][];
    setMode(mode: number): void;
    getMode(): number;
    applyMode(): void;
    setDataRange(min: number, max: number): void;
    getDataRange(): [number, number];
    getLookupTable(): vtkColorTransferFunction;
  }

  export interface ILookupTableProxyInitialValues {
    lookupTable?: vtkColorTransferFunction;
  }

  export function newInstance(
    initialValues?: ILookupTableProxyInitialValues
  ): vtkLookupTableProxy;

  export declare const vtkLookupTableProxy: {
    newInstance: typeof newInstance;
    Mode: ILookupTableProxyMode;
  };

  export default vtkLookupTableProxy;
}

declare module '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy' {
  import vtkProxyObject from '@kitware/vtk.js/types/ProxyObject';
  import vtkLookupTableProxy from '@kitware/vtk.js/Proxy/Core/LookupTableProxy';
  import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';

  // [x, r/h, g/s, b/v, m=0.5, s=0.0]
  export interface PiecewiseGaussian {
    position: number;
    height: number;
    width: number;
    xBias: number;
    yBias: number;
  }

  export interface PiecewiseNode {
    x: number;
    y: number;
    midpoint: number;
    sharpness: number;
  }

  export enum IPiecewiseFunctionProxyMode {
    Gaussians = 0,
    Points = 1,
    Nodes = 2,
  }

  export interface IPiecewiseFunctionProxyDefaults {
    Gaussians: PiecewiseGaussian[];
    Points: number[][];
    Nodes: PiecewiseNode[];
  }

  export interface vtkPiecewiseFunctionProxy extends vtkProxyObject {
    setGaussians(gaussians: PiecewiseGaussian[]): void;
    getGaussians(): PiecewiseGaussian[];
    setPoints(points: number[][]): void;
    getPoints(): number[][];
    setNodes(nodes: PiecewiseNode[]): void;
    getNodes(): PiecewiseNode[];
    setMode(mode: number): void;
    getMode(): number;
    applyMode(): void;
    getLookupTableProxy(): vtkLookupTableProxy;
    setDataRange(min: number, max: number): void;
    getDataRange(): [number, number];
    getPiecewiseFunction(): vtkPiecewiseFunction;
  }

  export interface IPiecewiseFunctionProxyInitialValues {
    piecewiseFunction?: vtkPiecewiseFunction;
  }

  export function newInstance(
    initialValues?: IPiecewiseFunctionProxyInitialValues
  ): vtkPiecewiseFunctionProxy;

  export declare const vtkPiecewiseFunctionProxy: {
    newInstance: typeof newInstance;
    Mode: typeof IPiecewiseFunctionProxyMode;
    Defaults: IPiecewiseFunctionProxyDefaults;
  };
  export default vtkPiecewiseFunctionProxy;
}

declare module '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy' {}

declare module '@kitware/vtk.js/Interaction/Manipulators/CompositeMouseManipulator' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';
  import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
  import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
  import { Vector3 } from '@kitware/vtk.js/types';

  export interface ICompositeMouseManipulatorInitialValues {
    button?: number;
    shift?: boolean;
    control?: boolean;
    alt?: boolean;
    dragEnabled?: boolean;
    scrollEnabled?: boolean;
  }

  export interface vtkCompositeMouseManipulator extends vtkObject {
    startInteraction();
    endInteraction();
    onButtonDown(
      interactor: vtkRenderWindowInteractor,
      renderer: vtkRenderer,
      position: Vector3
    );
    onButtonUp(interactor: vtkRenderWindowInteractor);
    onMouseMove(
      interactor: vtkRenderWindowInteractor,
      renderer: vtkRenderer,
      position: Vector3
    );
    onStartScroll(
      interactor: vtkRenderWindowInteractor,
      renderer: vtkRenderer,
      delta: number
    );
    onScroll(
      interactor: vtkRenderWindowInteractor,
      renderer: vtkRenderer,
      delta: number
    );
    onEndScroll(interactor: vtkRenderWindowInteractor);

    isDragEnabled(): boolean;
    isScrollEnabled(): boolean;

    getButton(): number;
    setShift(shift: boolean): boolean;
    getShift(): boolean;
    setControl(control: boolean): boolean;
    getControl(): boolean;
    setAlt(alt: boolean): boolean;
    getAlt(): boolean;
    setDragEnabled(drag: boolean): boolean;
    setScrollEnabled(scroll: boolean): boolean;
  }

  export function extend(
    publicAPI: object,
    model: object,
    initialValues?: ICompositeMouseManipulatorInitialValues
  ): void;

  export declare const vtkCompositeMouseManipulator: {
    extend: typeof extend;
  };

  export default vtkCompositeMouseManipulator;
}

declare module '@kitware/vtk.js/Interaction/Manipulators/MouseRangeManipulator' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';
  import vtkCompositeMouseManipulator, {
    ICompositeMouseManipulatorInitialValues,
  } from '@kitware/vtk.js/Interaction/Manipulators/CompositeMouseManipulator';

  export interface IMouseRangeManipulatorInitialValues
    extends ICompositeMouseManipulatorInitialValues {}

  export interface vtkMouseRangeManipulator
    extends vtkCompositeMouseManipulator {
    setHorizontalListener(
      min: number,
      max: number,
      step: number,
      getValue: () => number,
      setValue: (v: number) => void,
      scale?: number = 1
    );
    setVerticalListener(
      min: number,
      max: number,
      step: number,
      getValue: () => number,
      setValue: (v: number) => void,
      scale?: number = 1
    );
    setScrollListener(
      min: number,
      max: number,
      step: number,
      getValue: () => number,
      setValue: (v: number) => void,
      scale?: number = 1
    );
    removeHorizontalListener();
    removeVerticalListener();
    removeScrollListener();
    removeAllListeners();
  }

  export function extend(
    publicAPI: object,
    model: object,
    initialValues?: IMouseRangeManipulatorInitialValues
  ): void;
  export function newInstance(
    initialValues?: IMouseRangeManipulatorInitialValues
  ): vtkMouseRangeManipulator;

  export declare const vtkMouseRangeManipulator: {
    newInstance: typeof newInstance;
    extend: typeof extend;
  };

  export default vtkMouseRangeManipulator;
}

declare module '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';
  import vtkCompositeMouseManipulator, {
    ICompositeMouseManipulatorInitialValues,
  } from '@kitware/vtk.js/Interaction/Manipulators/CompositeMouseManipulator';

  export interface IMouseCameraTrackballPanManipulatorInitialValues
    extends ICompositeMouseManipulatorInitialValues {}

  export interface vtkMouseCameraTrackballPanManipulator
    extends vtkCompositeMouseManipulator {}

  export function extend(
    publicAPI: object,
    model: object,
    initialValues?: IMouseCameraTrackballPanManipulatorInitialValues
  ): void;
  export function newInstance(
    initialValues?: IMouseCameraTrackballPanManipulatorInitialValues
  ): vtkMouseCameraTrackballPanManipulator;

  export declare const vtkMouseCameraTrackballPanManipulator: {
    newInstance: typeof newInstance;
    extend: typeof extend;
  };

  export default vtkMouseCameraTrackballPanManipulator;
}

declare module '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';
  import vtkCompositeMouseManipulator, {
    ICompositeMouseManipulatorInitialValues,
  } from '@kitware/vtk.js/Interaction/Manipulators/CompositeMouseManipulator';

  export interface IMouseCameraTrackballZoomManipulatorInitialValues
    extends ICompositeMouseManipulatorInitialValues {}

  export interface vtkMouseCameraTrackballZoomManipulator
    extends vtkCompositeMouseManipulator {}

  export function extend(
    publicAPI: object,
    model: object,
    initialValues?: IMouseCameraTrackballZoomManipulatorInitialValues
  ): void;
  export function newInstance(
    initialValues?: IMouseCameraTrackballZoomManipulatorInitialValues
  ): vtkMouseCameraTrackballZoomManipulator;

  export declare const vtkMouseCameraTrackballZoomManipulator: {
    newInstance: typeof newInstance;
    extend: typeof extend;
  };

  export default vtkMouseCameraTrackballZoomManipulator;
}

declare module '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomToMouseManipulator' {
  import vtkMouseCameraTrackballZoomManipulator, {
    IMouseCameraTrackballZoomManipulatorInitialValues,
  } from '@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator';
  export interface IMouseCameraTrackballZoomToMouseManipulator
    extends IMouseCameraTrackballZoomManipulatorInitialValues {}

  export interface vtkMouseCameraTrackballZoomToMouseManipulator
    extends vtkMouseCameraTrackballZoomManipulator {}

  export function extend(
    publicAPI: object,
    model: object,
    initialValues?: IMouseCameraTrackballZoomToMouseManipulatorInitialValues
  ): void;
  export function newInstance(
    initialValues?: IMouseCameraTrackballZoomToMouseManipulatorInitialValues
  ): vtkMouseCameraTrackballZoomToMouseManipulator;

  export declare const vtkMouseCameraTrackballZoomToMouseManipulator: {
    newInstance: typeof newInstance;
    extend: typeof extend;
  };

  export default vtkMouseCameraTrackballZoomToMouseManipulator;
}

declare module '@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator/Presets' {
  export default any;
}

declare module '@kitware/vtk.js/Common/DataModel/ITKHelper';

declare module '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps' {
  export declare const vtkColorMaps: {
    addPreset(preset: any): void;
    removePresetByName(name: string): void;
    getPresetByName(name: string): any;
    rgbPresetNames: string[];
  };
  export default vtkColorMaps;
}

declare module '@kitware/vtk.js/Widgets/Core/WidgetState' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';

  export interface vtkWidgetState extends vtkObject {
    setActive(active: boolean): boolean;
    getActive(): boolean;
    bindState(subState: vtkWidgetState, labels?: string | string[]): void;
    unbindState(subState: vtkWidgetState): void;
    unbindAll(): void;
    activate(): void;
    deactivate(excludingState?: vtkWidgetState): void;
    activateOnly(subState: vtkWidgetState): void;
    getStatesWithLabel(label: string): vtkWidgetState[];
    getAllNestedStates(): vtkWidgetState[];
  }

  export default vtkWidgetState;
}

declare module '@kitware/vtk.js/Rendering/Core/InteractorObserver' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';
  import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
  import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
  import { Vector3 } from '@kitware/vtk.js/types';
  import { EventHandler } from '@kitware/vtk.js/interfaces-additions';
  import { vtkSubscription } from '@kitware/vtk.js/interfaces';

  export interface vtkInteractorObserver extends vtkObject {
    invokeInteractionEvent(...args: any[]): void;
    onInteractionEvent(cb: EventHandler, priority?: number): vtkSubscription;
    invokeStartInteractionEvent(...args: any[]): void;
    onStartInteractionEvent(
      cb: EventHandler,
      priority?: number
    ): vtkSubscription;
    invokeEndInteractionEvent(...args: any[]): void;
    onEndInteractionEvent(cb: EventHandler, priority?: number): vtkSubscription;

    getInteractor(): vtkRenderWindowInteractor;
    getEnabled(): boolean;
    setPriority(priority: number): void;
    getPriority(): number;
    setProcessEvents(processEvents: boolean): boolean;
    getProcessEvents(): boolean;

    setInteractor(int: vtkRenderWindowInteractor): void;
    setEnabled(enable: boolean): void;
    computeWorldToDisplay(
      renderer: vtkRenderer,
      x: number,
      y: number,
      z: number
    ): Vector3;
    computeDisplayToWorld(
      renderer: vtkRenderer,
      x: number,
      y: number,
      z: number
    ): Vector3;
  }

  export default vtkInteractorObserver;
}

declare module '@kitware/vtk.js/Widgets/Core/AbstractWidget' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';
  import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
  import vtkProp from '@kitware/vtk.js/Rendering/Core/Prop';
  import vtkWidgetRepresentation from '@kitware/vtk.js/Widgets/Representations/WidgetRepresentation';
  import vtkInteractorObserver from '@kitware/vtk.js/Rendering/Core/InteractorObserver';
  import vtkWidgetManager, {
    RenderingTypes,
  } from '@kitware/vtk.js/Widgets/Core/WidgetManager';
  import { EventHandler } from '@kitware/vtk.js/interfaces-additions';
  import { Bounds } from '@kitware/vtk.js/types';

  export interface vtkAbstractWidget extends vtkProp, vtkInteractorObserver {
    getBounds(): Bounds;
    getNestedProps(): vtkWidgetRepresentation[];
    activateHandle(locator: {
      selectedState: vtkWidgetState;
      representation: vtkWidgetRepresentation;
    }): void;
    deactivateAllHandles(): void;
    hasActor(actor: vtkProp): boolean;
    grabFocus(): void;
    loseFocus(): void;
    hasFocus(): boolean;
    placeWidget(bounds: Bounds): void;
    getPlaceFactor(): number;
    setPlaceFactor(factor: number): void;
    getRepresentationFromActor(actor: vtkProp): vtkWidgetRepresentation;
    updateRepresentationForRender(renderingType: RenderingTypes): void;
    getViewWidgets(): vtkAbstractWidget[];
    setContextVisibility(visible: boolean): boolean;
    getContextVisibility(): boolean;
    setHandleVisibility(visible: boolean): boolean;
    getHandleVisibility(): boolean;
    setWidgetManager(wm: vtkWidgetManager): boolean;
    getWidgetManager(): vtkWidgetManager;
    getRepresentations(): vtkWidgetRepresentation[];
    getWidgetState(): vtkWidgetState;
    onActivateHandle(cb: EventHandler, priority?: number): void;
    invokeActivateHandle(...args: any[]): void;
  }

  export default vtkAbstractWidget;
}

declare module '@kitware/vtk.js/Widgets/Core/AbstractWidgetFactory' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';
  import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
  import vtkAbstractWidget from '@kitware/vtk.js/Widgets/Core/AbstractWidget';
  import { ViewTypes } from '@kitware/vtk.js/Widgets/Core/WidgetManager';
  import vtkWidgetState from '@kitware/vtk.js/Widgets/Core/WidgetState';
  import { Bounds } from '@kitware/vtk.js/types';

  export interface vtkAbstractWidgetFactory extends vtkObject {
    getWidgetForView(locator: {
      viewId: string;
      renderer: vtkRenderer;
      viewType: ViewTypes;
      initialValues?: object;
    }): vtkAbstractWidget | null;
    getViewIds(): string[];
    setVisibility(visible: boolean): void;
    setPickable(pickable: boolean): void;
    setDragable(dragable: boolean): void;
    setContextVisibility(visible: boolean): void;
    setHandleVisibility(visible: boolean): void;
    placeWidget(bounds: Bounds);
    getPlaceFactor(): number;
    setPlaceFactor(factor: number): void;
    getWidgetState(): vtkWidgetState;
    invokeWidgetChangeEvent(...args: any[]): void;
    onWidgetChangeEvent(cb: EventHandler, priority?: number): void;
  }

  export interface IAbstractWidgetFactoryInitialValues {
    widgetState?: vtkWidgetState;
  }

  export function extend(
    publicAPI: object,
    model: object,
    initialValues?: IAbstractWidgetFactoryInitialValues
  );

  export function newInstance(
    initialValues?: IAbstractWidgetFactoryInitialValues
  ): vtkAbstractWidgetFactory;

  export declare const vtkAbstractWidgetFactory: {
    extend: typeof extend;
  };
  export default vtkAbstractWidgetFactory;
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

declare module '@kitware/vtk.js/Common/DataModel/BoundingBox' {
  import { Bounds } from '@kitware/vtk.js/types';
  export function inflate(bounds: Bounds, delta: number);
  export function getDiagonalLength(bounds: Bounds): number;
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
