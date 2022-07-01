<template>
  <div id="patient-module" class="mx-2 py-2 fill-height">
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
    <div id="patient-study-controls">
      <v-container class="pa-0">
        <v-row no-gutters justify="space-between">
          <v-col cols="6" id="left-controls" align-self="center">
            <v-row no-gutters justify="start">
              <v-checkbox
                class="ml-3 align-center justify-center"
                v-model="selectAll"
              ></v-checkbox>
            </v-row>
          </v-col>
          <v-col cols="6" id="right-controls" align-self="center">
            <v-row no-gutters justify="end">
              <v-btn icon @click.stop="removeSelected">
                <v-icon>mdi-delete</v-icon>
              </v-btn>
            </v-row>
          </v-col>
        </v-row>
      </v-container>
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
            <image-list-card
              :active="active"
              :title="image.name"
              :image-url="thumbnailCache[image.cacheKey].encodedImage || ''"
              :image-size="100"
              @click="select"
              :id="image.id"
              :inputValue="image.id"
              v-model="selected"
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
            </image-list-card>
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
                class="pl-3 no-select"
                :title="study.info.StudyDate"
              >
                <v-container fluid class="pt-0">
                  <v-row align="center">
                    <v-checkbox
                      :key="study.info.StudyInstanceUID"
                      :value="study.info.StudyInstanceUID"
                      v-model="selected"
                      @click.stop
                    />
                    <v-icon class="">mdi-folder-table</v-icon>
                    <div class="mt-4 ml-4 study-header">
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
                  </v-row>

                  <v-row no-gutters align="center" justify="end">
                    <v-col cols="2">
                      <v-tooltip bottom>
                        Total series in study
                        <template v-slot:activator="{ on }">
                          <v-row align="center" justify="end" v-on="on">
                            <v-icon medium>mdi-folder-open</v-icon>
                            <span class="mr-3 text--secondary"
                              >: {{ study.volumes.length }}</span
                            >
                          </v-row>
                        </template>
                      </v-tooltip>
                    </v-col>
                    <v-col cols="2">
                      <v-tooltip bottom>
                        Total scans in study
                        <template v-slot:activator="{ on }">
                          <v-row align="center" justify="end" v-on="on">
                            <v-icon medium>mdi-image-filter-none</v-icon>
                            <span class="mr-1 text--secondary"
                              >:
                              {{
                                study.volumes.reduce(
                                  (numSlices, vol) =>
                                    numSlices + vol.info.NumberOfSlices,
                                  0
                                )
                              }}</span
                            >
                          </v-row>
                        </template>
                      </v-tooltip>
                    </v-col>
                  </v-row>
                </v-container>
              </v-expansion-panel-header>
              <v-expansion-panel-content>
                <v-container class="pa-0">
                  <v-row class="mt-1 mr-1" justify="end">
                    <v-btn icon @click="removeSelectedDICOMVolumes">
                      <v-icon>mdi-delete</v-icon>
                    </v-btn>
                  </v-row>
                  <v-row no-gutters>
                    <v-col>
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
                            <v-row no-gutters class="pa-0" justify="center">
                              <div>
                                <v-img
                                  contain
                                  :height="`${THUMBNAIL_IMAGE_HEIGHT}}px`"
                                  :width="
                                    thumbnailCache[volume.cacheKey]
                                      ? `${
                                          THUMBNAIL_IMAGE_HEIGHT /
                                          thumbnailCache[volume.cacheKey]
                                            .aspectRatio
                                        }px`
                                      : null
                                  "
                                  :src="
                                    thumbnailCache[volume.cacheKey]
                                      ? thumbnailCache[volume.cacheKey]
                                          .encodedImage
                                      : ''
                                  "
                                >
                                  <v-overlay
                                    absolute
                                    class="thumbnail-overlay"
                                    value="true"
                                    opacity="0"
                                  >
                                    <div class="d-flex flex-column fill-height">
                                      <v-row
                                        no-gutters
                                        justify="end"
                                        align-content="start"
                                      >
                                        <v-checkbox
                                          :key="volume.info.VolumeID"
                                          :value="volume.selectionKey"
                                          v-model="selectedSeries"
                                          @click.stop
                                          dense
                                        />
                                      </v-row>
                                      <div class="flex-grow-1" />
                                      <v-row
                                        no-gutters
                                        justify="start"
                                        align="end"
                                      >
                                        <div class="mb-2 ml-2">
                                          [{{ volume.info.NumberOfSlices }}]
                                        </div>
                                      </v-row>
                                    </div>
                                  </v-overlay>
                                </v-img>
                              </div>
                            </v-row>
                            <v-card-text
                              class="text--primary caption text-center series-desc mt-n3"
                            >
                              <div class="text-ellipsis">
                                {{
                                  volume.info.SeriesDescription ||
                                  '(no description)'
                                }}
                              </div>
                            </v-card-text>
                          </v-card>
                        </groupable-item>
                      </div>
                    </v-col>
                  </v-row>
                </v-container>
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
import ImageListCard from '@/src/components/ImageListCard.vue';
import { useDICOMStore } from '../store/datasets-dicom';
import {
  DataSelection,
  DICOMSelection,
  selectionEquals,
  useDatasetStore,
} from '../store/datasets';
import { useImageStore } from '../store/datasets-images';

const NON_DICOM_IMAGES = Symbol('non dicom images');
const THUMBNAIL_IMAGE_HEIGHT = 150;
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

    return thumb;
  }
  return null;
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
    ImageListCard,
  },
  setup() {
    const selectedPatient: Ref<string | typeof NON_DICOM_IMAGES> = ref('');
    const selectedStudy: Ref<string> = ref('');
    const selectAll: Ref<boolean> = ref(false);
    const selected: Ref<string[]> = ref([]);
    const selectedSeries: Ref<DICOMSelection[]> = ref([]);

    // no deletion happens here, so technically a leak of sorts
    const thumbnailCacheRef = ref<Record<string, string>>({});
    const dicomStore = useDICOMStore();
    const dataStore = useDatasetStore();
    const imageStore = useImageStore();

    const primarySelection = computed(() => dataStore.primarySelection);

    if (primarySelection.value?.type === 'dicom') {
      const { volumeKey } = primarySelection.value;
      selectedStudy.value = dicomStore.volumeStudy[volumeKey];
    }

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
      const { patientStudies, studyInfo, studyVolumes, volumeInfo } =
        dicomStore;
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

    const imagesRef = computed(() =>
      imageStore.idList.filter((id) => !(id in dicomStore.imageIDToVolumeKey))
    );

    // switches the selected patient/case based on the
    // primary selection.
    watch(primarySelection, (selection) => {
      if (selection?.type === 'image') {
        selectedPatient.value = NON_DICOM_IMAGES;
      } else if (selection?.type === 'dicom') {
        const { volumeKey } = selection;
        const studyKey = dicomStore.volumeStudy[volumeKey];
        const patientKey = dicomStore.studyPatient[studyKey];
        selectedStudy.value = studyKey;
        selectedPatient.value = patientKey;
      }
    });

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
    watch(
      [studiesAndVolumesRef, imagesRef],
      () => {
        const thumbnailCache = thumbnailCacheRef.value;
        const imageIDs = imagesRef.value;
        const studiesAndVolumes = studiesAndVolumesRef.value;

        imageIDs.forEach(async (id) => {
          const cacheKey = imageCacheKey(id);
          if (!(cacheKey in thumbnailCache)) {
            const imageData = imageStore.dataIndex[id];
            const encodedImage = generateVTKImageThumbnail(imageData);
            const dims = imageData.getDimensions();
            const aspectRatio = dims[0] / dims[1];
            set(thumbnailCache, cacheKey, { encodedImage, aspectRatio });
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

              if (thumb !== null) {
                const encodedImage = itkImageToURI(thumb);
                const aspectRatio = thumb.size[0] / thumb.size[1];

                set(thumbnailCache, cacheKey, { encodedImage, aspectRatio });
              }
            }
          });
        });
      },
      { deep: true }
    );

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

    const allSelected = () => {
      if (selectedPatient.value === NON_DICOM_IMAGES) {
        return (
          selected.value.length !== 0 &&
          selected.value.length === imageList.value.length
        );
      }

      return (
        selected.value.length !== 0 &&
        selected.value.length === studiesAndVolumesRef.value.length
      );
    };

    // reset select all checkbox value when we switch patient or user changes
    // selection
    watch([selectedPatient], () => {
      selectAll.value = false;
    });

    watch([selected], () => {
      selectAll.value = allSelected();
    });

    watch([selectAll], () => {
      selected.value = [];
      if (selectAll.value) {
        if (selectedPatient.value === NON_DICOM_IMAGES) {
          selected.value = imageList.value.map((value) => value.id);
        } else {
          selected.value = studiesAndVolumesRef.value.map(
            (value) => value.info.StudyInstanceUID
          );
        }
      }
    });

    const removeSelectedStudies = () => {
      selected.value.forEach(async (study) => {
        dicomStore.deleteStudy(study);
      });

      // Handle the case where we are deleting the selected study
      if (selected.value.indexOf(selectedStudy.value) !== -1) {
        dataStore.setPrimarySelection(null);
      }
    };

    const removeSelectedDICOMVolumes = () => {
      selectedSeries.value.forEach(async (series) => {
        dicomStore.deleteVolume(series.volumeKey);
      });

      // Handle the case where we are deleting the selected volume
      if (primarySelection.value?.type === 'dicom') {
        const { volumeKey } = primarySelection.value;

        // If we are deleting the selected volume, just reset the primary selection
        if (
          selectedSeries.value
            .map((series: DICOMSelection) => series.volumeKey)
            .indexOf(volumeKey) !== -1
        ) {
          const volumes = dicomStore.studyVolumes[selectedStudy.value];
          if (volumes.length > 0) {
            dataStore.setPrimarySelection({
              type: 'dicom',
              volumeKey: volumes[0],
            });
          } else {
            dataStore.setPrimarySelection(null);
          }
        }
      }

      selectedSeries.value = [];
    };

    const removeSelectedImages = () => {
      selected.value.forEach(async (dataID) => {
        imageStore.deleteData(dataID);
      });

      // Handle the case where we are deleting the selected volume
      if (primarySelection.value?.type === 'image') {
        const { dataID } = primarySelection.value;

        // If we are deleting the selected image, just reset the primary selection
        if (selected.value.map((id: string) => id).indexOf(dataID) !== -1) {
          if (imageStore.idList.length > 0) {
            dataStore.setPrimarySelection({
              type: 'image',
              dataID: imageStore.idList[0],
            });
          } else {
            dataStore.setPrimarySelection(null);
          }
        }
      }
    };

    // remove selected images or studies
    const removeSelected = async () => {
      if (selectedPatient.value === NON_DICOM_IMAGES) {
        await removeSelectedImages();
      } else {
        await removeSelectedStudies();
      }

      selected.value = [];
      selectAll.value = false;
    };

    return {
      NON_DICOM_IMAGES,
      THUMBNAIL_IMAGE_HEIGHT,
      selectedPatient,
      selectedStudy,
      selectAll,
      selected,
      selectedSeries,
      patientList,
      imageList,
      primarySelection,
      thumbnailCache: thumbnailCacheRef,
      studiesAndVolumes: studiesAndVolumesRef,
      testFunction: selectionEquals,
      setPrimarySelection: (sel: DataSelection) => {
        dataStore.setPrimarySelection(sel);
      },
      removeSelectedDICOMVolumes,
      removeSelected,
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
  overflow-y: scroll;
}

.patient-data-study-panel {
  border: 1px solid #ddd;
}

.volume-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  grid-auto-rows: 200px;
  justify-content: center;
}

.volume-card {
  padding: 8px;
  cursor: pointer;
}

.study-header {
  overflow: hidden;
  white-space: nowrap;
}

.study-header-line {
  text-overflow: ellipsis;
  overflow: hidden;
}

.series-desc {
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}

.thumbnail-overlay >>> .v-overlay__content {
  height: 100%;
  width: 100%;
}

.volume-list >>> .theme--light.v-sheet--outlined {
  border: none;
}
</style>
