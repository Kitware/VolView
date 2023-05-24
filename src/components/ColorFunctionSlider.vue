<script>
import { VRangeSlider } from 'vuetify/lib/components';

const DEFAULT_TRACK_COLOR = 'rgba(128, 128, 128, 0.2)';
const CLASS_COLOR_FUNCTION = 'volview__color-function';
const CLASS_COLOR_FUNCTION_MIDDLE = `${CLASS_COLOR_FUNCTION}_middle`;

export default VRangeSlider.extend({
  name: 'color-function-slider',
  props: {
    rgbPoints: Array,
    range: Array,
  },
  computed: {
    startBackgroundColor() {
      if (!this.rgbPoints) {
        return DEFAULT_TRACK_COLOR;
      }
      const [r, g, b] = this.rgbPoints.slice(1, 4).map((c) => c * 255);
      return `rgb(${r}, ${g}, ${b})`;
    },
    filledBackgroundColor() {
      if (!this.rgbPoints) {
        return DEFAULT_TRACK_COLOR;
      }
      const rangeMax = this.rgbPoints[this.rgbPoints.length - 4];
      const rangeMin = this.rgbPoints[0];
      const width = rangeMax - rangeMin;
      const colorStops = [];
      for (let i = 0; i < this.rgbPoints.length; i += 4) {
        const [r, g, b] = [
          this.rgbPoints[i + 1] * 255,
          this.rgbPoints[i + 2] * 255,
          this.rgbPoints[i + 3] * 255,
        ];
        const stop = ((this.rgbPoints[i] - rangeMin) / width) * 100; // in percent
        colorStops.push(`rgba(${r}, ${g}, ${b}) ${stop.toFixed(2)}%`);
      }
      return `linear-gradient(to right, ${colorStops.join(', ')})`;
    },
    endBackgroundColor() {
      if (!this.rgbPoints) {
        return DEFAULT_TRACK_COLOR;
      }
      const end = this.rgbPoints.length;
      const [r, g, b] = this.rgbPoints.slice(end - 3).map((c) => c * 255);
      return `rgb(${r}, ${g}, ${b})`;
    },
  },
  methods: {
    // override
    onSliderMouseDown(e) {
      if (e.target.classList.contains(CLASS_COLOR_FUNCTION_MIDDLE)) {
        this._middleDragStart = this.parseMouseMove(e);
      } else {
        this._middleDragStart = null;
      }
      VRangeSlider.options.methods.onSliderMouseDown.call(this, e);
    },
    // override
    onSliderClick() {
      // do nothing on click
    },
    // override
    onMouseMove(e) {
      const value = this.parseMouseMove(e);

      if (e.type === 'mousemove') {
        this.thumbPressed = true;
      }

      if (this._middleDragStart != null) {
        const delta = value - this._middleDragStart;
        this.applyRangeDelta(delta);
      } else {
        if (this.activeThumb === null) {
          this.activeThumb = this.getIndexOfClosestValue(
            this.internalValue,
            value
          );
        }

        this.setInternalValue(value);
      }
    },
    // override
    genTrackContainer() {
      const children = [];

      const padding = this.isDisabled ? 10 : 0;
      const sections = [
        {
          class: `v-slider__track-background ${CLASS_COLOR_FUNCTION}`,
          styles: [0, this.inputWidth[0], 0, -padding],
          extraStyles: {
            background: this.startBackgroundColor,
          },
        },
        {
          class: `v-slider__track-background ${CLASS_COLOR_FUNCTION} ${CLASS_COLOR_FUNCTION_MIDDLE}`,
          styles: [
            this.inputWidth[0],
            Math.abs(this.inputWidth[1] - this.inputWidth[0]),
            padding,
            padding * -2,
          ],
          extraStyles: {
            background: this.filledBackgroundColor,
          },
        },
        {
          class: `v-slider__track-background ${CLASS_COLOR_FUNCTION}`,
          styles: [
            this.inputWidth[1],
            Math.abs(100 - this.inputWidth[1]),
            padding,
            -padding,
          ],
          extraStyles: {
            background: this.endBackgroundColor,
          },
        },
      ];

      if (this.$vuetify.rtl) sections.reverse();

      children.push(
        ...sections.map((section) =>
          this.$createElement('div', {
            ...this.setBackgroundColor(section.color, {
              staticClass: section.class,
              style: {
                ...this.getTrackStyle(...section.styles),
                ...section.extraStyles,
              },
            }),
            on: section.events,
          })
        )
      );

      return this.$createElement(
        'div',
        {
          staticClass: 'v-slider__track-container',
          ref: 'track',
        },
        children
      );
    },
    applyRangeDelta(delta) {
      // this.oldValue is from VRangeSlider::onSliderMouseDown
      let [low, high] = this.oldValue;
      // assumption: min <= low < high <= max
      if (low + delta < this.min) {
        high -= low - this.min;
        low = this.min;
      } else if (high + delta > this.max) {
        low += this.max - high;
        high = this.max;
      } else {
        low += delta;
        high += delta;
      }
      this.internalValue = [low, high];
    },
  },
});
</script>

<style scoped>
.v-slider--horizontal .v-slider__track-container {
  height: 80%;
  display: flex;
  align-items: center;
}

.volview__color-function_middle:hover {
  cursor: grab;
}
</style>
