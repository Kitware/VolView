<template>
  <div id="volume-rendering-module" class="mx-2 height-100">
    <div id="preset-list">
      <item-group :value="presetName" @change="selectPreset">
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
</template>

<script>
import { mapState, mapGetters, mapActions } from 'vuex';
import vtkGenericRenderWindow from 'vtk.js/Sources/Rendering/Misc/GenericRenderWindow';
import vtkVolume from 'vtk.js/Sources/Rendering/Core/Volume';
import vtkVolumeMapper from 'vtk.js/Sources/Rendering/Core/VolumeMapper';
import vtkColorTransferFunction from 'vtk.js/Sources/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from 'vtk.js/Sources/Common/DataModel/PiecewiseFunction';
import vtkColorMaps from 'vtk.js/Sources/Rendering/Core/ColorTransferFunction/ColorMaps';

import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import AvatarListCard from '@/src/components/AvatarListCard.vue';
import { PresetNameList } from '@/src/vtk/ColorMaps';

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
      PresetNames: PresetNameList,
    };
  },

  computed: {
    ...mapState({
      baseImage: 'selectedBaseImage',
      presetName: (state) => state.visualization.baseImageColorPreset,
    }),
    ...mapGetters(['baseImagePipeline']),
  },

  watch: {
    baseImagePipeline(pipeline) {
      if (pipeline) {
        const { transformFilter } = pipeline;
        const volume = transformFilter.getDataset();
        const { actor, mapper } = this.volumePipeline;
        mapper.setInputData(volume);
        this.scene.getRenderer().addVolume(actor);
        this.doThumbnailing(volume);
      } else {
        const { actor } = this.volumePipeline;
        this.scene.getRenderer().removeVolume(actor);
      }
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
  },

  methods: {
    thumbKey,

    selectPreset(name) {
      this.setBaseImageColorPreset(name);
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

    ...mapActions(['setBaseImageColorPreset']),
  },
};
</script>

<style scoped>
#volume-rendering-module {
  display: flex;
  flex-flow: column;
}
</style>
