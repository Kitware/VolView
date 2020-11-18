<template>
  <div>
    <div
      v-show="hasBaseImage"
      id="volume-rendering-module"
      class="mx-2 height-100"
    >
      <div id="volume-transfer-func-editor" ref="editorContainer">
        <div ref="pwfEditor" />
      </div>
      <div id="preset-list">
        <item-group :value="baseImageColorPreset" @change="selectPreset">
          <groupable-item
            v-for="name in PresetNames"
            :key="name"
            v-slot="{ active, select }"
            :value="name"
          >
            <avatar-list-card
              :active="active"
              :image-size="size"
              :image-url="thumbnailCache[thumbKey(baseImage, name)]"
              :title="name"
              @click="select"
            >
              <div class="text-truncate">
                {{ name }}
              </div>
            </avatar-list-card>
          </groupable-item>
        </item-group>
      </div>
    </div>
    <div v-show="!hasBaseImage">
      No image selected
    </div>
  </div>
</template>

<script>
import { mapState, mapGetters, mapActions } from 'vuex';
import vtkGenericRenderWindow from 'vtk.js/Sources/Rendering/Misc/GenericRenderWindow';
import vtkVolume from 'vtk.js/Sources/Rendering/Core/Volume';
import vtkVolumeMapper from 'vtk.js/Sources/Rendering/Core/VolumeMapper';
import vtkColorTransferFunction from 'vtk.js/Sources/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from 'vtk.js/Sources/Common/DataModel/PiecewiseFunction';
import vtkColorMaps from 'vtk.js/Sources/Rendering/Core/ColorTransferFunction/ColorMaps';
import PwfProxyConstants from 'vtk.js/Sources/Proxy/Core/PiecewiseFunctionProxy/Constants';

import vtkPiecewiseWidget from '@/src/vtk/PiecewiseWidget';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import AvatarListCard from '@/src/components/AvatarListCard.vue';
import { PresetNameList } from '@/src/vtk/ColorMaps';
import { NO_SELECTION } from '@/src/constants';
import { unsubscribeVtkList } from '@/src/utils/common';

const { Defaults, Mode } = PwfProxyConstants;
const WIDGET_HEIGHT = 150;

export function createThumbnailPipeline() {
  const actor = vtkVolume.newInstance();
  const mapper = vtkVolumeMapper.newInstance();
  const property = actor.getProperty();
  const cfun = vtkColorTransferFunction.newInstance();
  const ofun = vtkPiecewiseFunction.newInstance();
  property.setRGBTransferFunction(0, cfun);
  property.setScalarOpacity(0, ofun);
  property.setUseGradientOpacity(0, true);
  property.setScalarOpacityUnitDistance(0, 3);
  property.setInterpolationTypeToLinear();
  property.setGradientOpacityMinimumValue(0, 2);
  property.setGradientOpacityMaximumValue(0, 20);
  property.setGradientOpacityMinimumOpacity(0, 0);
  property.setGradientOpacityMaximumOpacity(0, 1);
  mapper.setSampleDistance(1);
  actor.setMapper(mapper);
  return {
    actor,
    mapper,
    property,
    cfun,
    ofun,
  };
}

export function resetCameraToZ(renderer) {
  // mimics ViewProxy.updateOrientation to get a
  // similar looking default position thumbnail
  const camera = renderer.getActiveCamera();
  const pos = camera.getFocalPoint();
  pos[2] -= 1;
  camera.setPosition(...pos);
  camera.setViewUp(0, -1, 0);
  renderer.resetCamera();
}

export function thumbKey(imageID, presetName) {
  return `${imageID}:${presetName}`;
}

export default {
  name: 'VolumeRendering',

  components: {
    AvatarListCard,
    ItemGroup,
    GroupableItem,
  },

  data() {
    return {
      size: 80,
      thumbnailCache: {}, // TODO how to remove entries from cache
      mapOpacityRangeToLutRange: false,
      PresetNames: PresetNameList,
    };
  },

  computed: {
    ...mapState({ baseImage: 'selectedBaseImage' }),
    ...mapState('visualization', ['colorBy']),
    ...mapGetters(['baseImagePipeline', 'baseImageColorPreset']),
    baseColorBy() {
      return this.colorBy[this.baseImage] || {};
    },
    hasBaseImage() {
      return this.baseImage !== NO_SELECTION;
    },
    pwfProxy() {
      const { array } = this.baseColorBy;
      if (array) {
        return this.$proxyManager.getPiecewiseFunction(array);
      }
      return null;
    },
    lutProxy() {
      if (this.pwfProxy) {
        return this.pwfProxy.getLookupTableProxy();
      }
      return null;
    },
  },

  watch: {
    baseImage() {
      if (this.hasBaseImage) {
        this.resetPwfWidget();
        this.onOpacityChange();
      }
    },

    baseImagePipeline(pipeline) {
      if (pipeline) {
        const { source } = pipeline;
        const volume = source.getDataset();
        const { actor, mapper } = this.volumePipeline;
        mapper.setInputData(volume);
        this.scene.getRenderer().addVolume(actor);
        this.doThumbnailing(volume);
      } else {
        const { actor } = this.volumePipeline;
        this.scene.getRenderer().removeVolume(actor);
      }
    },

    baseImageColorPreset() {
      this.resetPwfWidget();
      this.onOpacityChange();
    },

    baseColorBy() {
      this.resetPwfWidget();
      this.onOpacityChange();
    },
  },

  created() {
    this.container = document.createElement('div');
    this.container.style.width = `${this.size}px`;
    this.container.style.height = `${this.size}px`;

    this.scene = vtkGenericRenderWindow.newInstance({
      listenWindowResize: false,
    });
    this.scene.setContainer(this.container);

    this.volumePipeline = createThumbnailPipeline();

    this.pwfWidget = vtkPiecewiseWidget.newInstance({
      numberOfBins: 256,
      size: [250, WIDGET_HEIGHT],
    });
    this.pwfWidget.updateStyle({
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

    this.lifeSubscriptions = [];
    this.pwfSubscriptions = [];

    this.recurseGuard = false;
  },

  mounted() {
    this.resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 1) {
        const { width } = entries[0].contentRect;
        this.setPwfWidgetWidth(width);
        this.onOpacityChange();
      }
    });
    this.resizeObserver.observe(this.$refs.editorContainer);

    this.lifeSubscriptions.push(
      this.pwfWidget.onOpacityChange(() => this.onOpacityChange())
    );

    this.pwfWidget.setContainer(this.$refs.pwfEditor);
    this.pwfWidget.bindMouseListeners();

    this.resetPwfWidget();
    this.onOpacityChange();
  },

  beforeDestroy() {
    this.resizeObserver.unobserve(this.$refs.editorContainer);
    unsubscribeVtkList(this.lifeSubscriptions);
    unsubscribeVtkList(this.pwfSubscriptions);
    this.pwfWidget.unbindMouseListeners();
    this.pwfWidget.setContainer(null);
  },

  methods: {
    thumbKey,

    async selectPreset(name) {
      await this.setBaseImageColorPreset(name);

      const lut = this.lutProxy.getLookupTable();
      this.pwfWidget.setColorTransferFunction(lut);
    },

    doThumbnailing(volume) {
      const dataRange = volume.getPointData().getScalars().getRange();
      this.thumbnailHelper(this.baseImage, 0, dataRange);
    },

    thumbnailHelper(currentImageId, currentIndex, mappingRange) {
      if (
        this.baseImage === currentImageId &&
        currentIndex < PresetNameList.length
      ) {
        const presetName = PresetNameList[currentIndex];
        const key = thumbKey(currentImageId, presetName);
        if (key in this.thumbnailCache) {
          this.thumbnailHelper(currentImageId, currentIndex + 1, mappingRange);
        } else {
          const preset = vtkColorMaps.getPresetByName(presetName);
          const { ofun, cfun } = this.volumePipeline;
          ofun.addPoint(0, 0);
          ofun.addPoint(255, 1);
          cfun.applyColorMap(preset);
          cfun.setMappingRange(mappingRange[0], mappingRange[1]);

          resetCameraToZ(this.scene.getRenderer());
          this.scene.getRenderWindow().render();
          this.scene
            .getRenderWindow()
            .captureImages()[0]
            .then((imageURL) => {
              this.$set(this.thumbnailCache, key, imageURL);
              this.thumbnailHelper(
                currentImageId,
                currentIndex + 1,
                mappingRange
              );
            });
        }
      }
    },

    resetPwfWidget() {
      unsubscribeVtkList(this.pwfSubscriptions);

      if (this.hasBaseImage && this.pwfProxy) {
        const pwf = this.pwfProxy.getPiecewiseFunction();
        const lut = this.lutProxy.getLookupTable();

        const { data, selectedBaseImage } = this.$store.state;
        const image = data.vtkCache[selectedBaseImage];
        const scalars = image.getPointData().getScalars();
        const dataRange = scalars.getRange();

        // reset pwf proxy and lut proxy ranges
        this.pwfProxy.setDataRange(...dataRange);
        this.lutProxy.setDataRange(...dataRange);

        const preset = vtkColorMaps.getPresetByName(this.baseImageColorPreset);
        if (preset.OpacityPoints) {
          const { OpacityPoints } = preset;
          const points = [];
          let xmin = Infinity;
          let xmax = -Infinity;
          for (let i = 0; i < OpacityPoints.length; i += 2) {
            xmin = Math.min(xmin, OpacityPoints[i]);
            xmax = Math.max(xmax, OpacityPoints[i]);
            points.push([OpacityPoints[i], OpacityPoints[i + 1]]);
          }

          const width = xmax - xmin;
          const pointsNormalized = points.map(([x, y]) => [
            (x - xmin) / width,
            y,
          ]);

          this.pwfProxy.setMode(Mode.Points);
          this.pwfProxy.setPoints(pointsNormalized);
          this.pwfProxy.setDataRange(xmin, xmax);

          this.pwfWidget.setPointsMode();
          this.pwfWidget.setOpacityPoints(pointsNormalized);
        } else {
          this.pwfProxy.setMode(Mode.Gaussians);
          this.pwfProxy.setGaussians(Defaults.Gaussians);

          this.pwfWidget.setGaussiansMode();
          this.pwfWidget.setGaussians(this.pwfProxy.getGaussians());
        }

        this.pwfWidget.setColorTransferFunction(lut);
        this.pwfWidget.setDataArray(scalars.getData());

        this.pwfSubscriptions.push(
          pwf.onModified(() => {
            if (this.pwfProxy) {
              if (this.recurseGuard) {
                return;
              }
              this.recurseGuard = true;

              this.pwfWidget.setGaussians(this.pwfProxy.getGaussians());

              this.recurseGuard = false;
            }
          })
        );

        this.pwfSubscriptions.push(
          lut.onModified(() => {
            if (this.pwfProxy) {
              if (this.recurseGuard) {
                return;
              }
              this.recurseGuard = true;

              if (this.mapOpacityRangeToLutRange) {
                const newColorRange = this.pwfWidget.getOpacityRange();
                this.pwfProxy
                  .getLookupTableProxy()
                  .setDataRange(...newColorRange);
                this.pwfWidget.render();
              }

              this.recurseGuard = false;
            }
          })
        );

        this.pwfWidget.render();
      }
    },

    setPwfWidgetWidth(width) {
      if (width > 0) {
        this.pwfWidget.setSize(width, WIDGET_HEIGHT);
      }
    },

    onOpacityChange() {
      if (this.pwfProxy) {
        if (this.recurseGuard) {
          return;
        }
        this.recurseGuard = true;

        if (this.pwfProxy.getMode() === Mode.Gaussians) {
          this.pwfProxy.setGaussians(
            this.pwfWidget.getReferenceByName('gaussians')
          );
        } else if (this.pwfProxy.getMode() === Mode.Points) {
          this.pwfProxy.setPoints(this.pwfWidget.getEffectiveOpacityPoints());
        }
        if (this.mapOpacityRangeToLutRange) {
          const newColorRange = this.pwfWidget.getOpacityRange();
          this.pwfProxy.getLookupTableProxy().setDataRange(...newColorRange);
        }
        this.pwfWidget.render();

        this.recurseGuard = false;
      }
    },

    ...mapActions('visualization', ['setBaseImageColorPreset']),
  },
};
</script>

<style scoped>
#volume-rendering-module {
  display: flex;
  flex-flow: column;
}
</style>
