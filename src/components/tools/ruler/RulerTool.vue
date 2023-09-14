<script lang="ts">
import { createAnnotationToolComponent } from '@/src/components/tools/createAnnotationToolComponent';
import PlacingRulerWidget2D from '@/src/components/tools/ruler/PlacingRulerWidget2D.vue';
import RulerWidget2D from '@/src/components/tools/ruler/RulerWidget2D.vue';
import { useRulerStore } from '@/src/store/tools/rulers';
import { Tools } from '@/src/store/tools/types';

export default createAnnotationToolComponent({
  name: 'RulerTool',
  type: Tools.Ruler,
  useToolStore: useRulerStore,
  WidgetComponent: RulerWidget2D,
  PlacingWidgetComponent: PlacingRulerWidget2D,
});
</script>

<style scoped src="@/src/components/styles/vtk-view.css"></style>
