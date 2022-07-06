<template>
  <div id="volume-rendering-module" class="mx-2 fill-height">
    <template v-if="hasPrimaryDataset">
      <div id="volume-transfer-func-editor" ref="editorContainerRef">
        <div ref="pwfEditorRef" />
      </div>
      <div id="preset-list">
        <item-group :value="colorTransferFunctionName" @change="selectPreset">
          <groupable-item
            v-for="preset in presetList"
            :key="preset.name"
            v-slot="{ active, select }"
            :value="preset.name"
          >
            <avatar-list-card
              :active="active"
              :image-size="size"
              :image-url="thumbnailCache[preset.thumbnailKey] || ''"
              :title="preset.name"
              @click="select"
            >
              <div class="text-truncate">
                {{ preset.name }}
              </div>
            </avatar-list-card>
          </groupable-item>
        </item-group>
      </div>
    </template>
    <template v-else>
      <div>No image selected</div>
    </template>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  ref,
  set,
  watch,
  watchEffect,
} from '@vue/composition-api';
import { PresetNameList } from '@/src/vtk/ColorMaps';
import vtkPiecewiseWidget from '@/src/vtk/PiecewiseWidget';
import { vtkSubscription } from '@kitware/vtk.js/interfaces';
import vtkColorMaps from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps';
import vtkPiecewiseFunctionProxy from '@kitware/vtk.js/Proxy/Core/PiecewiseFunctionProxy';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import AvatarListCard from '@/src/components/AvatarListCard.vue';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import { Vector3 } from '@kitware/vtk.js/types';
import { useResizeObserver } from '../composables/useResizeObserver';
import { manageVTKSubscription } from '../composables/manageVTKSubscription';
import { useView3DStore } from '../store/views-3D';
import { useProxyManager } from '../composables/proxyManager';
import { useDatasetStore } from '../store/datasets';
import { createVolumeThumbnailer } from '../core/thumbnailers/volume-thumbnailer';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useCameraOrientation } from '../composables/useCameraOrientation';
import { LPSAxisDir } from '../utils/lps';

const WIDGET_HEIGHT = 150;
const THUMBNAIL_SIZE = 80;

function makeCacheKey(presetName: string, imageID: string) {
  return `cache-${presetName}-${imageID}`;
}

function resetOpacityFunction(
  pwfProxy: vtkPiecewiseFunctionProxy,
  dataRange: [number, number],
  presetName: string
) {
  // reset pwf proxy range
  pwfProxy.setDataRange(...dataRange);

  const preset = vtkColorMaps.getPresetByName(presetName);
  if (preset.OpacityPoints) {
    const OpacityPoints = preset.OpacityPoints as number[];
    const points = [];
    let xmin = Infinity;
    let xmax = -Infinity;
    for (let i = 0; i < OpacityPoints.length; i += 2) {
      xmin = Math.min(xmin, OpacityPoints[i]);
      xmax = Math.max(xmax, OpacityPoints[i]);
      points.push([OpacityPoints[i], OpacityPoints[i + 1]]);
    }

    const width = xmax - xmin;
    const pointsNormalized = points.map(([x, y]) => [(x - xmin) / width, y]);

    pwfProxy.setMode(vtkPiecewiseFunctionProxy.Mode.Points);
    pwfProxy.setPoints(pointsNormalized);
    pwfProxy.setDataRange(xmin, xmax);
  } else {
    pwfProxy.setMode(vtkPiecewiseFunctionProxy.Mode.Gaussians);
    pwfProxy.setGaussians(vtkPiecewiseFunctionProxy.Defaults.Gaussians);
  }
}

export default defineComponent({
  name: 'VolumeRendering',
  components: {
    ItemGroup,
    GroupableItem,
    AvatarListCard,
  },
  setup() {
    const view3DStore = useView3DStore();
    const dataStore = useDatasetStore();
    const proxyManager = useProxyManager();
    const mapOpacityRangeToLutRangeRef = ref(false);
    const editorContainerRef = ref<HTMLElement | null>(null);
    const pwfEditorRef = ref<HTMLElement | null>(null);

    let recurseGuard = false;

    const { currentImageID } = useCurrentImage();
    const primaryDatasetRef = computed(() => dataStore.primaryDataset);
    const colorTransferFunctionRef = computed(
      () => view3DStore.coloringConfig.transferFunction
    );
    const colorByRef = computed(() => view3DStore.coloringConfig.colorBy);
    const pwfProxyRef = computed(() => {
      const { arrayName } = colorByRef.value;
      if (arrayName) {
        return proxyManager?.getPiecewiseFunction(arrayName);
      }
      return null;
    });
    const lutProxyRef = computed(() => {
      return pwfProxyRef.value?.getLookupTableProxy();
    });

    const pwfSubscriptions: vtkSubscription[] = [];

    onBeforeUnmount(() => {
      while (pwfSubscriptions.length) {
        pwfSubscriptions.pop()!.unsubscribe();
      }
    });

    const pwfWidget = vtkPiecewiseWidget.newInstance({
      numberOfBins: 256,
      size: [250, WIDGET_HEIGHT],
    });
    pwfWidget.updateStyle({
      backgroundColor: 'rgba(255, 255, 255, 0.6)',
      histogramColor: 'rgba(100, 100, 100, 0.5)',
      strokeColor: 'rgb(0, 0, 0)',
      activeColor: 'rgb(255, 255, 255)',
      handleColor: 'rgb(50, 150, 50)',
      buttonDisableFillColor: 'rgba(255, 255, 255, 0.5)',
      buttonDisableStrokeColor: 'rgba(0, 0, 0, 0.5)',
      buttonStrokeColor: 'rgba(0, 0, 0, 1)',
      buttonFillColor: 'rgba(255, 255, 255, 1)',
      strokeWidth: 2,
      activeStrokeWidth: 3,
      buttonStrokeWidth: 1.5,
      handleWidth: 3,
      iconSize: 0,
      padding: 10,
    });

    function onOpacityChange() {
      const pwfProxy = pwfProxyRef.value;
      if (pwfProxy) {
        if (recurseGuard) {
          return;
        }
        recurseGuard = true;

        if (pwfProxy.getMode() === vtkPiecewiseFunctionProxy.Mode.Gaussians) {
          pwfProxy.setGaussians(pwfWidget.getReferenceByName('gaussians'));
        } else if (
          pwfProxy.getMode() === vtkPiecewiseFunctionProxy.Mode.Points
        ) {
          pwfProxy.setPoints(pwfWidget.getEffectiveOpacityPoints());
        }
        if (mapOpacityRangeToLutRangeRef.value) {
          const newColorRange = pwfWidget.getOpacityRange() as [number, number];
          pwfProxy.getLookupTableProxy().setDataRange(...newColorRange);
        }
        pwfWidget.render();

        recurseGuard = false;
      }
    }

    function resetPwfWidget() {
      while (pwfSubscriptions.length) {
        pwfSubscriptions.pop()!.unsubscribe();
      }

      const pwfProxy = pwfProxyRef.value;
      const lutProxy = lutProxyRef.value;
      const image = primaryDatasetRef.value;
      const colorTFName = colorTransferFunctionRef.value;

      if (image && pwfProxy && lutProxy) {
        const scalars = image.getPointData().getScalars();
        const dataRange = scalars.getRange();

        resetOpacityFunction(pwfProxy, dataRange, colorTFName);
        lutProxy.setDataRange(...dataRange);

        if (pwfProxy.getMode() === vtkPiecewiseFunctionProxy.Mode.Points) {
          pwfWidget.setPointsMode();
          pwfWidget.setOpacityPoints(pwfProxy.getPoints());
        } else if (
          pwfProxy.getMode() === vtkPiecewiseFunctionProxy.Mode.Gaussians
        ) {
          pwfWidget.setGaussiansMode();
          pwfWidget.setGaussians(pwfProxy.getGaussians());
        }

        const pwf = pwfProxy.getPiecewiseFunction();
        const lut = lutProxy.getLookupTable();

        pwfWidget.setColorTransferFunction(lut);
        pwfWidget.setDataArray(scalars.getData());

        pwfSubscriptions.push(
          pwf.onModified(() => {
            onOpacityChange();
          })
        );

        pwfSubscriptions.push(
          lut.onModified(() => {
            onOpacityChange();
          })
        );
      }

      pwfWidget.render();
    }

    useResizeObserver(editorContainerRef, (entry) => {
      const { width } = entry.contentRect;
      if (width > 0) {
        pwfWidget.setSize(width, WIDGET_HEIGHT);
      }
      onOpacityChange();
    });

    manageVTKSubscription(pwfWidget.onOpacityChange(onOpacityChange));

    // mounted the pwf widget container
    watchEffect(() => {
      if (pwfEditorRef.value) {
        pwfWidget.setContainer(pwfEditorRef.value);
        pwfWidget.bindMouseListeners();
      }
    });

    onBeforeUnmount(() => {
      pwfWidget.unbindMouseListeners();
      pwfWidget.setContainer(null);
    });

    // update pwf widget on selection change
    watch(
      [primaryDatasetRef, colorByRef, colorTransferFunctionRef],
      ([primaryDataset], [oldPrimaryDataset]) => {
        if (primaryDataset && primaryDataset !== oldPrimaryDataset) {
          resetPwfWidget();
          onOpacityChange();
        }
      },
      { deep: true }
    );

    // -- thumbnailing -- //

    const thumbnailCacheRef = ref<Record<string, string>>({});
    const thumbnailer = createVolumeThumbnailer(THUMBNAIL_SIZE);
    const { currentImageMetadata } = useCurrentImage();

    // same as 3D view
    const viewDirection = ref<LPSAxisDir>('Inferior');
    const viewUp = ref<LPSAxisDir>('Anterior');
    const { cameraDirVec, cameraUpVec } = useCameraOrientation(
      viewDirection,
      viewUp,
      currentImageMetadata
    );

    // used to interrupt a thumbnailing cycle if
    // doThumbnailing is called again
    let interruptSentinel = Symbol('interrupt');

    async function doThumbnailing(imageID: string, image: vtkImageData) {
      const localSentinel = Symbol('interrupt');
      interruptSentinel = localSentinel;

      thumbnailer.setInputImage(image);
      const dataRange = image.getPointData().getScalars().getRange();

      async function helper(presetName: string) {
        // bail if a new thumbnail process has started
        if (interruptSentinel !== localSentinel) {
          return;
        }

        // sanity check; did the current image change
        if (imageID !== currentImageID.value) {
          return;
        }

        const thumbnailCache = thumbnailCacheRef.value;
        const cacheKey = makeCacheKey(presetName, imageID);
        // don't thumbnail something that has been thumbnailed
        // FIXME (?) doesn't account for if the dataset changes
        if (cacheKey in thumbnailCache) {
          return;
        }

        const preset = vtkColorMaps.getPresetByName(presetName);
        resetOpacityFunction(
          thumbnailer.opacityFuncProxy,
          dataRange,
          presetName
        );
        thumbnailer.colorTransferFuncProxy
          .getLookupTable()
          .applyColorMap(preset);
        thumbnailer.colorTransferFuncProxy.setDataRange(...dataRange);
        thumbnailer.resetCameraWithOrientation(
          cameraDirVec.value as Vector3,
          cameraUpVec.value as Vector3
        );

        const renWin = thumbnailer.scene.getRenderWindow();
        renWin.render();
        const imageURL = await renWin.captureImages()[0];
        if (imageURL) {
          set(thumbnailCache, cacheKey, imageURL);
        }
      }

      PresetNameList.reduce(
        (promise, presetName) => promise.then(() => helper(presetName)),
        Promise.resolve()
      );
    }

    // force thumbnailing to stop
    onBeforeUnmount(() => {
      interruptSentinel = Symbol('unmount');
    });

    // trigger thumbnailing
    watch(currentImageID, (imageID) => {
      if (imageID) {
        // set the thumbnailer's camera
        // set ofun via pwfWidget, since it should have been
        // reset prior to this code
        // trigger thumbnailing
        doThumbnailing(imageID, primaryDatasetRef.value!);
      }
    });

    const hasPrimaryDataset = computed(() => !!primaryDatasetRef.value);
    const presetList = computed(() => {
      const id = currentImageID.value || '';
      return PresetNameList.map((name) => ({
        name,
        thumbnailKey: makeCacheKey(name, id),
      }));
    });

    return {
      editorContainerRef,
      pwfEditorRef,
      thumbnailCache: thumbnailCacheRef,
      hasPrimaryDataset,
      colorTransferFunctionName: colorTransferFunctionRef,
      presetList,
      selectPreset: (name: string) => {
        view3DStore.setColorTransferFunction(name);
      },
      size: THUMBNAIL_SIZE,
    };
  },
});
</script>
