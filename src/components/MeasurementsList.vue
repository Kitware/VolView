<template>
  <v-list dense v-if="measurements.length">
    <v-list-item v-for="mm in measurements" :key="mm.id" two-line>
      <v-menu offset-x :close-on-content-click="false">
        <template v-slot:activator="{ on, attrs }">
          <div
            class="color-dot clickable mr-3"
            :style="{ backgroundColor: mm.data.color }"
            v-on="on"
            v-bind="attrs"
          />
        </template>
        <v-color-picker
          :value="mm.data.color"
          @input="updateColor(mm.type, mm.id, $event)"
          hide-inputs
        />
      </v-menu>
      <v-list-item-content>
        <v-list-item-title class="capitalize"
          >{{ mm.type }} (ID = {{ mm.id }})</v-list-item-title
        >
        <v-list-item-subtitle v-if="mm.type === 'ruler'">
          Length: {{ mm.data.length.toFixed(2) }}mm
        </v-list-item-subtitle>
      </v-list-item-content>
      <v-list-item-action>
        <v-row no-gutters>
          <v-tooltip top>
            Reveal slice
            <template v-slot:activator="{ on }">
              <v-btn
                class="mr-2"
                icon
                @click="jumpTo(mm.type, mm.id)"
                v-on="on"
              >
                <v-icon>mdi-target</v-icon>
              </v-btn>
            </template>
          </v-tooltip>
          <v-tooltip top>
            Delete
            <template v-slot:activator="{ on }">
              <v-btn icon @click="remove(mm.type, mm.id)" v-on="on">
                <v-icon>mdi-delete</v-icon>
              </v-btn>
            </template>
          </v-tooltip>
        </v-row>
      </v-list-item-action>
    </v-list-item>
  </v-list>
  <div v-else class="caption empty-state">No measurements yet</div>
</template>

<style src="@/src/components/styles/utils.css"></style>

<style scoped>
.empty-state {
  text-align: center;
}

.color-dot {
  width: 24px;
  height: 24px;
  background: yellow;
  border-radius: 16px;
}

.capitalize::first-letter {
  text-transform: capitalize;
}
</style>

<script lang="ts">
import { computed, defineComponent } from '@vue/composition-api';
import { useCurrentImage } from '../composables/useCurrentImage';
import { useRulerStore } from '../store/tools/rulers';
import { useRectangleStore } from '../store/tools/rectangles';
import { RectangleID } from '../types/rectangle';

interface Measurement {
  id: string;
  type: 'ruler' | 'rectangle';
  imageID: string | null;
  data: any;
}

export default defineComponent({
  name: 'MeasurementsList',
  setup() {
    const rulerStore = useRulerStore();
    const rectangleStore = useRectangleStore();
    const { currentImageID } = useCurrentImage();

    const measurements = computed(() => {
      const selectedImageID = currentImageID.value;
      const rulers = rulerStore.tools.map((tool) => ({
        type: 'ruler',
        data: {
          length: rulerStore.lengthByID[tool.id],
        },
        tool,
      }));

      const rectangles = rectangleStore.tools.map((tool) => ({
        type: 'rectangle',
        data: {},
        tool,
      }));

      return [...rulers, ...rectangles]
        .filter(({ tool }) => tool.imageID === selectedImageID && !tool.placing)
        .map(
          ({ tool: { id, imageID, color }, type, data }) =>
            ({
              id,
              type,
              imageID,
              data: {
                ...data,
                color,
              },
            } as Measurement)
        );
    });

    function remove(type: Measurement['type'], id: string) {
      if (type === 'ruler') {
        return rulerStore.removeTool(id);
      }
      if (type === 'rectangle') {
        return rectangleStore.removeTool(id as RectangleID);
      }
      const _exhaustiveCheck: never = type;
      throw new Error(`invalid Measurement type ${_exhaustiveCheck}`);
    }

    function jumpTo(type: Measurement['type'], id: string) {
      if (type === 'ruler') {
        return rulerStore.jumpToTool(id);
      }
      if (type === 'rectangle') {
        return rectangleStore.jumpToTool(id as RectangleID);
      }
      const _exhaustiveCheck: never = type;
      throw new Error(`invalid Measurement type ${_exhaustiveCheck}`);
    }

    function updateColor(type: Measurement['type'], id: string, color: string) {
      if (type === 'ruler') {
        return rulerStore.updateTool(id, { color });
      }
      if (type === 'rectangle') {
        return rectangleStore.updateTool(id as RectangleID, { color });
      }
      const _exhaustiveCheck: never = type;
      throw new Error(`invalid Measurement type ${_exhaustiveCheck}`);
    }

    return {
      measurements,
      remove,
      jumpTo,
      updateColor,
    };
  },
});
</script>
