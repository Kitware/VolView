declare module '@kitware/vtk.js/vtk' {
  import { vtkObject } from '@kitware/vtk.js/interfaces';

  export default (obj: any): vtkObject => {};
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
  import { Vector3 } from '@kitware/vtk.js/types';
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

    setBackground(color: Vector3): void;
    getBackground(): Vector3;

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
  export interface vtkAbstractRepresentationProxy extends vtkProxyObject {
    setInput(source: vtkSourceProxy): void;
    getInputDataSet(): vtkObject | null;
    setColorBy(
      arrayName: string | null,
      arrayLocation: string,
      componentIndex: number = -1
    );
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
    getPresetName(name): string;
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
    lookupTable: vtkColorTransferFunction;
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

  export interface IPiecewiseFunctionProxyMode {
    Gaussians: number = 0;
    Points: number = 1;
    Nodes: number = 2;
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
    piecewiseFunction: vtkPiecewiseFunction;
  }

  export function newInstance(
    initialValues?: IPiecewiseFunctionProxyInitialValues
  ): vtkPiecewiseFunctionProxy;

  export declare const vtkPiecewiseFunctionProxy: {
    newInstance: typeof newInstance;
    Mode: IPiecewiseFunctionProxyMode;
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
