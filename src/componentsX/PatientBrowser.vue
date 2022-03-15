<template>
  <div id="patient-module" class="mx-2 height-100">
    <div id="patient-filter-controls">
      <v-select
        v-model="selectedPatient"
        :items="patientList"
        item-text="name"
        item-value="key"
        dense
        filled
        single-line
        hide-details
        label="Patient"
        prepend-icon="mdi-account"
        no-data-text="No patients loaded"
        placeholder="Select a patient"
        class="no-select"
      />
    </div>
    <div id="patient-data-list">
      <item-group
        :value="primarySelection"
        :testFunction="testFunction"
        @change="setPrimarySelection"
      >
        <template v-if="!selectedPatient"> No patient selected </template>
        <template v-else-if="selectedPatient === NON_DICOM_IMAGES">
          <div v-if="imageList.length === 0">No non-dicom images available</div>
          <groupable-item
            v-for="image in imageList"
            :key="image.id"
            v-slot="{ active, select }"
            :value="image.selectionKey"
          >
            <avatar-list-card
              :active="active"
              :title="image.name"
              :image-url="thumbnailCache[image.cacheKey] || ''"
              :image-size="100"
              @click="select"
            >
              <div class="body-2 text-truncate">
                {{ image.name }}
              </div>
              <div class="caption">
                Dims: ({{ image.dimensions.join(', ') }})
              </div>
              <div class="caption">
                Spacing: ({{
                  image.spacing.map((s) => s.toFixed(2)).join(', ')
                }})
              </div>
              <template v-slot:menu>
                <v-list>
                  <v-list-item @click.stop="removeData(image.id)">
                    Delete
                  </v-list-item>
                </v-list>
              </template>
            </avatar-list-card>
          </groupable-item>
        </template>
        <template v-else>
          <v-expansion-panels id="patient-data-studies" accordion multiple>
            <v-expansion-panel
              v-for="study in studiesAndVolumes"
              :key="study.info.StudyInstanceUID"
              class="patient-data-study-panel"
            >
              <v-expansion-panel-header
                color="#1976fa0a"
                class="no-select"
                :title="study.info.StudyDate"
              >
                <v-icon class="ml-n3 pr-3">mdi-folder-table</v-icon>
                <div class="study-header">
                  <div class="subtitle-2 study-header-line">
                    {{
                      study.info.StudyDescription ||
                      study.info.StudyDate ||
                      study.info.StudyInstanceUID
                    }}
                  </div>
                  <div
                    v-if="study.info.StudyDescription"
                    class="caption study-header-line"
                  >
                    {{ study.info.StudyDate }}
                  </div>
                </div>
              </v-expansion-panel-header>
              <v-expansion-panel-content>
                <div class="my-2 volume-list">
                  <groupable-item
                    v-for="volume in study.volumes"
                    :key="volume.info.VolumeID"
                    v-slot:default="{ active, select }"
                    :value="volume.selectionKey"
                  >
                    <v-card
                      outlined
                      ripple
                      :color="active ? 'light-blue lighten-4' : ''"
                      class="volume-card"
                      :title="volume.info.SeriesDescription"
                      @click="select"
                    >
                      <v-img
                        contain
                        height="100px"
                        :src="thumbnailCache[volume.cacheKey] || ''"
                      />
                      <v-card-text
                        class="text--primary caption text-center series-desc mt-n3"
                      >
                        <div>[{{ volume.info.NumberOfSlices }}]</div>
                        <div class="text-ellipsis">
                          {{
                            volume.info.SeriesDescription || '(no description)'
                          }}
                        </div>
                        <div class="actions">
                          <v-btn
                            small
                            icon
                            @click.stop="
                              removeDICOMVolume(volume.info.volumeID)
                            "
                          >
                            <v-icon>mdi-delete</v-icon>
                          </v-btn>
                        </div>
                      </v-card-text>
                    </v-card>
                  </groupable-item>
                </div>
              </v-expansion-panel-content>
            </v-expansion-panel>
          </v-expansion-panels>
        </template>
      </item-group>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  ref,
  set,
  watch,
} from '@vue/composition-api';
import type { Ref } from '@vue/composition-api';
import { TypedArray } from '@kitware/vtk.js/types';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import Image from 'itk/Image';
import ItemGroup from '@/src/components/ItemGroup.vue';
import GroupableItem from '@/src/components/GroupableItem.vue';
import AvatarListCard from '@/src/components/AvatarListCard.vue';
import { useDICOMStore } from '../storex/datasets-dicom';
import {
  DataSelection,
  selectionEquals,
  useDatasetStore,
} from '../storex/datasets';
import { useImageStore } from '../storex/datasets-images';

const NON_DICOM_IMAGES = Symbol('non dicom images');
const canvas = document.createElement('canvas');

// Assume itkImage type is Uint8Array
function itkImageToURI(itkImage: Image) {
  const [width, height] = itkImage.size;
  const im = new ImageData(width, height);
  const arr32 = new Uint32Array(im.data.buffer);
  const itkBuf = itkImage.data;
  if (!itkBuf) {
    return '';
  }

  for (let i = 0; i < itkBuf.length; i += 1) {
    const byte = itkBuf[i];
    // ABGR order
    // eslint-disable-next-line no-bitwise
    arr32[i] = (255 << 24) | (byte << 16) | (byte << 8) | byte;
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.putImageData(im, 0, 0);
    return canvas.toDataURL('image/png');
  }
  return '';
}

function scalarImageToURI(
  values: TypedArray,
  width: number,
  height: number,
  scaleMin: number,
  scaleMax: number
) {
  const im = new ImageData(width, height);
  const arr32 = new Uint32Array(im.data.buffer);
  // scale to 1 unsigned byte
  const factor = 255 / (scaleMax - scaleMin);
  for (let i = 0; i < values.length; i += 1) {
    const byte = Math.floor((values[i] - scaleMin) * factor);
    // ABGR order
    // eslint-disable-next-line no-bitwise
    arr32[i] = (255 << 24) | (byte << 16) | (byte << 8) | byte;
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.putImageData(im, 0, 0);
    return canvas.toDataURL('image/png');
  }
  return '';
}

async function generateDICOMThumbnail(
  dicomStore: ReturnType<typeof useDICOMStore>,
  volumeKey: string
) {
  if (volumeKey in dicomStore.volumeInfo) {
    const info = dicomStore.volumeInfo[volumeKey];
    const middleSlice = Math.round(Number(info.NumberOfSlices));
    const thumb = (await dicomStore.getVolumeSlice(
      volumeKey,
      middleSlice,
      true
    )) as Image;

    return itkImageToURI(thumb);
  }
  return '';
}

function generateVTKImageThumbnail(imageData: vtkImageData) {
  const scalars = imageData.getPointData().getScalars();
  const dims = imageData.getDimensions();
  const length = dims[0] * dims[1];
  const sliceOffset = Math.floor(dims[2] / 2) * length;
  const data = scalars.getData();
  const dataRange = scalars.getRange();
  const slice = Array.isArray(data)
    ? data.slice(sliceOffset, sliceOffset + length)
    : data.subarray(sliceOffset, sliceOffset + length);

  return scalarImageToURI(slice, dims[0], dims[1], dataRange[0], dataRange[1]);
}

function imageCacheKey(dataID: string) {
  return `image-${dataID}`;
}

function dicomCacheKey(volKey: string) {
  return `dicom-${volKey}`;
}

export default defineComponent({
  name: 'PatientBrowser',
  components: {
    ItemGroup,
    GroupableItem,
    AvatarListCard,
  },
  setup() {
    const selectedPatient: Ref<string | typeof NON_DICOM_IMAGES> = ref('');
    // no deletion happens here, so technically a leak of sorts
    const thumbnailCacheRef = ref<Record<string, string>>({});
    const dicomStore = useDICOMStore();
    const dataStore = useDatasetStore();
    const imageStore = useImageStore();

    const primarySelection = computed(() => dataStore.primarySelection);

    // TODO show patient ID in parens if there is a name conflict
    const patients = computed(() =>
      Object.entries(dicomStore.patientInfo)
        .map(([key, info]) => ({
          key,
          name: info.PatientName,
          info,
        }))
        .sort((a, b) => (a.name < b.name ? -1 : 1))
    );

    const studiesAndVolumesRef = computed(() => {
      const selPatient = selectedPatient.value;
      const {
        patientStudies,
        studyInfo,
        studyVolumes,
        volumeInfo,
      } = dicomStore;
      return patients.value
        .filter((patient) => patient.key === selPatient)
        .flatMap((patient) =>
          patientStudies[patient.key].map((studyKey) => {
            const info = studyInfo[studyKey];
            const volumes = studyVolumes[studyKey].map((volumeKey) => ({
              // for thumbnailing
              cacheKey: dicomCacheKey(volumeKey),
              info: volumeInfo[volumeKey],
              // for UI selection
              selectionKey: {
                type: 'dicom',
                volumeKey,
              } as DataSelection,
            }));
            return {
              info,
              volumes,
            };
          })
        );
    });

    const imagesRef = computed(() => imageStore.idList);

    // switches the selected patient/case based on the
    // primary selection.
    watch(
      () => primarySelection.value,
      (selection) => {
        if (selection?.type === 'image') {
          selectedPatient.value = NON_DICOM_IMAGES;
        } else if (selection?.type === 'dicom') {
          const { volumeKey } = selection;
          const patientKey =
            dicomStore.studyPatient[dicomStore.volumeStudy[volumeKey]];
          selectedPatient.value = patientKey;
        }
      }
    );

    // switches the selected patient/case if
    // (1) no selection, and (2) just loaded patients
    watch(
      patients,
      () => {
        if (!selectedPatient.value && patients.value.length) {
          selectedPatient.value = patients.value[0].key;
        }
      },
      { immediate: true }
    );

    // generates and caches thumbnails
    // FYI this won't update if an image's pixels change
    watch([studiesAndVolumesRef, imagesRef], () => {
      const thumbnailCache = thumbnailCacheRef.value;
      const imageIDs = imagesRef.value;
      const studiesAndVolumes = studiesAndVolumesRef.value;

      imageIDs.forEach(async (id) => {
        const cacheKey = imageCacheKey(id);
        if (!(cacheKey in thumbnailCache)) {
          const thumb = generateVTKImageThumbnail(imageStore.dataIndex[id]);
          set(thumbnailCache, cacheKey, thumb);
        }
      });

      studiesAndVolumes.forEach(({ volumes }) => {
        volumes.forEach(async (volumeInfo) => {
          const cacheKey = dicomCacheKey(volumeInfo.info.VolumeID);
          if (!(cacheKey in thumbnailCache)) {
            const thumb = await generateDICOMThumbnail(
              dicomStore,
              volumeInfo.info.VolumeID
            );
            set(thumbnailCache, cacheKey, thumb);
          }
        });
      });
    });

    const patientList = computed(() => [
      {
        key: NON_DICOM_IMAGES,
        name: 'Non-DICOM Images',
        info: null,
      },
      ...patients.value,
    ]);

    const imageList = computed(() => {
      const { metadata } = imageStore;
      return imagesRef.value.map((id) => ({
        id,
        cacheKey: imageCacheKey(id),
        // for UI selection
        selectionKey: {
          type: 'image',
          dataID: id,
        } as DataSelection,
        name: metadata[id].name,
        dimensions: metadata[id].dimensions,
        spacing: metadata[id].spacing,
      }));
    });

    return {
      NON_DICOM_IMAGES,
      selectedPatient,
      patientList,
      imageList,
      primarySelection,
      thumbnailCache: thumbnailCacheRef,
      studiesAndVolumes: studiesAndVolumesRef,
      testFunction: selectionEquals,
      setPrimarySelection: () => {},
      removeImage: (imageID: string) => {
        console.log('removeImage', imageID);
      },
      removeDICOMVolume: (volumeKey: string) => {
        console.log('removeDICOM', volumeKey);
      },
    };
  },
});
</script>

<style>
#patient-data-studies .v-expansion-panel--active > .v-expansion-panel-header {
  min-height: unset;
}

#patient-data-studies .v-expansion-panel-content__wrap {
  padding: 0 8px;
}

#patient-data-studies .v-expansion-panel::before {
  box-shadow: none;
}
</style>

<style scoped>
#patient-module {
  display: flex;
  flex-flow: column;
}

#patient-filter-controls {
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
  padding-bottom: 12px;
}

#patient-data-list {
  flex: 2;
  margin-top: 12px;
  overflow-y: scroll;
}

.patient-data-study-panel {
  border: 1px solid #ddd;
}

.volume-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  grid-template-rows: 180px;
  justify-content: center;
}

.volume-card {
  padding: 8px;
  cursor: pointer;
}

.study-header {
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
}

.study-header-line {
  width: 100%;
  text-overflow: ellipsis;
  overflow: hidden;
}

.series-desc {
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
</style>
